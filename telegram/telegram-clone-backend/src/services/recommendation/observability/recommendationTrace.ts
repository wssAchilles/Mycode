import mongoose from 'mongoose';
import RecommendationTrace from '../../../models/RecommendationTrace';
import { FeedCandidate } from '../types/FeedCandidate';
import { FeedQuery } from '../types/FeedQuery';
import type { RecommendationTracePayload } from '../rust/contracts';
import { extractExperimentKeys } from '../utils/experimentKeys';

const MAX_TRACE_CANDIDATES = Math.max(
    1,
    parseInt(String(process.env.RECOMMENDATION_TRACE_MAX_CANDIDATES || '60'), 10) || 60,
);
const MAX_TRACE_REPLAY_POOL_CANDIDATES = Math.max(
    MAX_TRACE_CANDIDATES,
    parseInt(String(process.env.RECOMMENDATION_TRACE_MAX_REPLAY_POOL_CANDIDATES || '120'), 10) || 120,
);

export interface RecommendationTraceShadowComparisonInput {
    overlapCount: number;
    overlapRatio: number;
    selectedCount: number;
    baselineCount: number;
}

export interface RecommendationTraceServingInput {
    servingVersion?: string;
    stableOrderKey?: string;
    cursor?: string;
    nextCursor?: string;
    servedStateVersion?: string;
    hasMore?: boolean;
}

export interface RecommendationTraceRuntimeInput {
    productSurface?: string;
    pipeline?: string;
    owner?: string;
    fallbackMode?: string;
    degradedReasons?: string[];
    shadowComparison?: RecommendationTraceShadowComparisonInput;
    serving?: RecommendationTraceServingInput;
    rustTrace?: RecommendationTracePayload;
}

type StoredTraceCandidate = {
    postId?: mongoose.Types.ObjectId;
    modelPostId?: string;
    authorId?: string;
    rank?: number;
    recallSource?: string;
    inNetwork?: boolean;
    isNews?: boolean;
    score?: number;
    weightedScore?: number;
    pipelineScore?: number;
    scoreBreakdown?: Record<string, number>;
    recommendationDetail?: string;
    sourceReason?: string;
    evidence?: string[];
    explainSignals?: Record<string, number>;
    createdAt?: Date | string;
};

type StoredTraceReplayPool = {
    poolKind?: string;
    totalCount?: number;
    truncated?: boolean;
    fingerprint?: string;
    candidates?: StoredTraceCandidate[];
};

export async function recordRecommendationTrace(
    query: FeedQuery,
    selectedCandidates: FeedCandidate[],
    runtime: RecommendationTraceRuntimeInput = {},
): Promise<void> {
    if (!isTraceEnabled() || !query.requestId || selectedCandidates.length === 0) {
        return;
    }

    const now = Date.now();
    const sourceCounts = buildSourceCounts(selectedCandidates);
    const scores = selectedCandidates
        .map((candidate) => candidate.score)
        .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
    const inNetworkCount = selectedCandidates.filter((candidate) => candidate.inNetwork === true).length;
    const replyCount = selectedCandidates.filter((candidate) => candidate.isReply).length;
    const uniqueAuthors = new Set(selectedCandidates.map((candidate) => candidate.authorId).filter(Boolean));

    const update: Record<string, unknown> = {
        requestId: query.requestId,
        userId: query.userId,
        productSurface: runtime.productSurface || 'space_feed',
        selectedCount: selectedCandidates.length,
        inNetworkCount,
        outOfNetworkCount: Math.max(selectedCandidates.length - inNetworkCount, 0),
        sourceCounts,
        authorDiversity: uniqueAuthors.size / Math.max(1, selectedCandidates.length),
        replyRatio: replyCount / Math.max(1, selectedCandidates.length),
        averageScore: scores.length > 0
            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
            : 0,
        topScore: scores.length > 0 ? Math.max(...scores) : undefined,
        bottomScore: scores.length > 0 ? Math.min(...scores) : undefined,
        freshness: buildFreshnessStats(now, selectedCandidates),
        candidates: selectedCandidates
            .slice(0, MAX_TRACE_CANDIDATES)
            .map((candidate, index) => traceCandidate(candidate, index + 1)),
        experimentKeys: extractExperimentKeys(query),
        createdAt: new Date(now),
    };

    setIfDefined(update, 'pipeline', runtime.pipeline);
    setIfDefined(update, 'owner', runtime.owner);
    setIfDefined(update, 'fallbackMode', runtime.fallbackMode);
    setIfDefined(update, 'degradedReasons', runtime.degradedReasons);
    setIfDefined(update, 'shadowComparison', sanitizeShadowComparison(runtime.shadowComparison));
    setIfDefined(update, 'serving', sanitizeServing(runtime.serving));
    setIfDefined(update, 'userState', query.userStateContext?.state);
    setIfDefined(update, 'embeddingQualityScore', query.embeddingContext?.qualityScore);
    applyRustTrace(update, runtime.rustTrace);

    await RecommendationTrace.findOneAndUpdate(
        { requestId: query.requestId },
        { $set: update },
        { upsert: true },
    );
}

function applyRustTrace(update: Record<string, unknown>, trace?: RecommendationTracePayload): void {
    if (!trace) return;

    const localCandidates = Array.isArray(update.candidates)
        ? (update.candidates as StoredTraceCandidate[])
        : [];

    setIfDefined(update, 'traceVersion', trace.traceVersion);
    setIfDefined(update, 'pipelineVersion', trace.pipelineVersion);
    setIfDefined(update, 'strategyVersion', trace.strategyVersion);
    setIfDefined(update, 'selectedFingerprint', trace.selectedFingerprint);
    setIfDefined(update, 'replayPoolFingerprint', trace.replayPoolFingerprint);
    setIfDefined(update, 'owner', trace.owner);
    setIfDefined(update, 'fallbackMode', trace.fallbackMode);
    update.selectedCount = Math.max(0, Math.round(trace.selectedCount));
    update.inNetworkCount = Math.max(0, Math.round(trace.inNetworkCount));
    update.outOfNetworkCount = Math.max(0, Math.round(trace.outOfNetworkCount));
    update.sourceCounts = sanitizeRustSourceCounts(trace.sourceCounts);
    update.authorDiversity = clamp01(trace.authorDiversity);
    update.replyRatio = clamp01(trace.replyRatio);
    update.averageScore = toFiniteNumber(trace.averageScore) ?? 0;
    setIfDefined(update, 'topScore', toFiniteNumber(trace.topScore));
    setIfDefined(update, 'bottomScore', toFiniteNumber(trace.bottomScore));
    update.freshness = sanitizeRustFreshness(trace.freshness);
    const candidates = sanitizeRustCandidates(trace.candidates, localCandidates);
    if (candidates.length > 0) {
        update.candidates = candidates;
    }
    if (trace.experimentKeys.length > 0) {
        update.experimentKeys = trace.experimentKeys;
    }
    setIfDefined(update, 'userState', trace.userState);
    setIfDefined(update, 'embeddingQualityScore', toFiniteNumber(trace.embeddingQualityScore));
    setIfDefined(update, 'replayPool', sanitizeRustReplayPool(trace.replayPool));
}

function sanitizeRustSourceCounts(value: RecommendationTracePayload['sourceCounts']) {
    return value
        .filter((entry) => entry.source && Number.isFinite(entry.count))
        .map((entry) => ({
            source: entry.source,
            count: Math.max(0, Math.round(entry.count)),
        }))
        .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source));
}

function sanitizeRustFreshness(value: RecommendationTracePayload['freshness']) {
    return {
        newestAgeSeconds: toNonNegativeInteger(value.newestAgeSeconds),
        oldestAgeSeconds: toNonNegativeInteger(value.oldestAgeSeconds),
        timeRangeSeconds: toNonNegativeInteger(value.timeRangeSeconds),
    };
}

function sanitizeRustCandidates(
    value: RecommendationTracePayload['candidates'],
    localCandidates: StoredTraceCandidate[] = [],
    maxCandidates = MAX_TRACE_CANDIDATES,
) {
    const localCandidatesByKey = new Map(
        localCandidates
            .map((candidate) => [
                traceCandidateKey(
                    candidate.postId ? String(candidate.postId) : undefined,
                    candidate.rank,
                ),
                candidate,
            ] as const),
    );

    return value
        .slice(0, maxCandidates)
        .map((candidate) => {
            const postId = parseObjectId(candidate.postId);
            if (!postId) return undefined;
            const local = localCandidatesByKey.get(traceCandidateKey(candidate.postId, candidate.rank));
            return {
                postId,
                modelPostId: candidate.modelPostId || candidate.postId,
                authorId: candidate.authorId,
                rank: Math.max(1, Math.round(candidate.rank)),
                recallSource: candidate.recallSource || 'unknown',
                inNetwork: candidate.inNetwork === true,
                isNews: candidate.isNews === true,
                score: toFiniteNumber(candidate.score),
                weightedScore: toFiniteNumber(candidate.weightedScore),
                pipelineScore: toFiniteNumber(candidate.pipelineScore),
                scoreBreakdown: finiteBreakdown(candidate.scoreBreakdown)
                    ?? finiteBreakdown(local?.scoreBreakdown),
                recommendationDetail: local?.recommendationDetail,
                sourceReason: local?.sourceReason,
                evidence: Array.isArray(local?.evidence) && local.evidence.length > 0
                    ? local.evidence
                    : undefined,
                explainSignals: finiteBreakdown(local?.explainSignals),
                createdAt: candidate.createdAt ? new Date(candidate.createdAt) : undefined,
            };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
}

function sanitizeRustReplayPool(
    replayPool?: RecommendationTracePayload['replayPool'],
): StoredTraceReplayPool | undefined {
    if (!replayPool) return undefined;
    return {
        poolKind: replayPool.poolKind,
        totalCount: Math.max(0, Math.round(replayPool.totalCount || 0)),
        truncated: replayPool.truncated === true,
        fingerprint: replayPool.fingerprint,
        candidates: sanitizeRustCandidates(
            replayPool.candidates,
            [],
            MAX_TRACE_REPLAY_POOL_CANDIDATES,
        ),
    };
}

function isTraceEnabled(): boolean {
    return String(process.env.RECOMMENDATION_TRACE_ENABLED || 'true').toLowerCase() !== 'false';
}

function buildSourceCounts(candidates: FeedCandidate[]) {
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
        const source = candidate.recallSource || 'unknown';
        counts.set(source, (counts.get(source) || 0) + 1);
    }
    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([source, count]) => ({ source, count }));
}

function buildFreshnessStats(now: number, candidates: FeedCandidate[]) {
    const timestamps = candidates
        .map((candidate) => new Date(candidate.createdAt).getTime())
        .filter((timestamp) => Number.isFinite(timestamp));
    if (timestamps.length === 0) {
        return {};
    }

    const newest = Math.max(...timestamps);
    const oldest = Math.min(...timestamps);
    return {
        newestAgeSeconds: Math.max(0, Math.round((now - newest) / 1000)),
        oldestAgeSeconds: Math.max(0, Math.round((now - oldest) / 1000)),
        timeRangeSeconds: Math.max(0, Math.round((newest - oldest) / 1000)),
    };
}

function traceCandidate(candidate: FeedCandidate, rank: number) {
    return {
        postId: candidate.postId,
        modelPostId: candidate.modelPostId || candidate.newsMetadata?.externalId || candidate.postId.toString(),
        authorId: candidate.authorId,
        rank,
        recallSource: candidate.recallSource || 'unknown',
        inNetwork: candidate.inNetwork === true,
        isNews: candidate.isNews === true,
        score: toFiniteNumber(candidate.score),
        weightedScore: toFiniteNumber(candidate.weightedScore),
        pipelineScore: toFiniteNumber(candidate._pipelineScore),
        scoreBreakdown: finiteBreakdown(candidate._scoreBreakdown),
        recommendationDetail: candidate.recommendationExplain?.detail,
        sourceReason: candidate.recommendationExplain?.sourceReason,
        evidence: candidate.recommendationExplain?.evidence,
        explainSignals: finiteBreakdown(candidate.recommendationExplain?.signals),
        createdAt: candidate.createdAt,
    };
}

function finiteBreakdown(value?: Record<string, number>): Record<string, number> | undefined {
    if (!value) return undefined;
    const entries = Object.entries(value).filter((entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toFiniteNumber(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toNonNegativeInteger(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.round(value));
}

function parseObjectId(value?: string): mongoose.Types.ObjectId | undefined {
    if (!value || !/^[0-9a-fA-F]{24}$/.test(value)) return undefined;
    return new mongoose.Types.ObjectId(value);
}

function traceCandidateKey(postId?: string, rank?: number): string {
    return `${postId || ''}:${Math.max(0, Math.round(rank || 0))}`;
}

function setIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
    if (typeof value !== 'undefined') {
        target[key] = value;
    }
}

function sanitizeShadowComparison(
    value?: RecommendationTraceShadowComparisonInput,
): RecommendationTraceShadowComparisonInput | undefined {
    if (!value) return undefined;
    return {
        overlapCount: Math.max(0, Math.round(value.overlapCount || 0)),
        overlapRatio: clamp01(value.overlapRatio),
        selectedCount: Math.max(0, Math.round(value.selectedCount || 0)),
        baselineCount: Math.max(0, Math.round(value.baselineCount || 0)),
    };
}

function sanitizeServing(value?: RecommendationTraceServingInput): RecommendationTraceServingInput | undefined {
    if (!value) return undefined;
    const serving: RecommendationTraceServingInput = {};
    setIfDefined(serving as Record<string, unknown>, 'servingVersion', value.servingVersion);
    setIfDefined(serving as Record<string, unknown>, 'stableOrderKey', value.stableOrderKey);
    setIfDefined(serving as Record<string, unknown>, 'cursor', value.cursor);
    setIfDefined(serving as Record<string, unknown>, 'nextCursor', value.nextCursor);
    setIfDefined(serving as Record<string, unknown>, 'servedStateVersion', value.servedStateVersion);
    setIfDefined(serving as Record<string, unknown>, 'hasMore', value.hasMore);
    return Object.keys(serving).length > 0 ? serving : undefined;
}

function clamp01(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}
