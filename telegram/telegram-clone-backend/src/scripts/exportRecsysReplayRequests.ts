/**
 * 导出 request 级 replay 样本（基于 recommendation_traces + 行为窗口）。
 *
 * 用法：
 *   RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX=<64-lowercase-hex> npx ts-node src/scripts/exportRecsysReplayRequests.ts \
 *     --keyVersion local-v1 --captureEpochId 2026-08 --days 14 --windowHours 24 \
 *     --output ./tmp/replay_requests.ndjson
 */

import fs from 'fs';
import path from 'path';

import mongoose from 'mongoose';
import dotenv from 'dotenv';

import RecommendationTrace from '../models/RecommendationTrace';
import UserAction, { ActionType } from '../models/UserAction';
import {
    type RecommendationDecisionLogV1,
    decisionLogSha256,
    recommendationDecisionLogSchema,
} from '../services/recommendation/decisionLog/contracts';
import { buildRecommendationViewerPseudonymV1 } from '../services/recommendation/evidenceCapture/privacy';
import {
    createCanonicalSpoolWriterV2,
    readCanonicalSpoolRecordsV2,
} from '../services/recommendation/offlinePrediction/predictionV2/spool';
import { publishAtomicCanonicalNdjsonV1 } from '../services/recommendation/offlinePrediction/snapshotV2/atomicSink';
import { attributeOutcomeV1 } from '../services/recommendation/outcomes/outcomeContractV1';
import type { ReplayCandidateLabelSummary, ReplayRequestSnapshot } from '../services/recommendation/replay/contracts';
import { RUST_CANONICAL_REPLAY_POOL_KIND } from '../services/recommendation/rust/contracts';
import { connectReadOnlyMongo, disconnectReadOnlyMongo } from '../services/recommendation/training/readOnlyMongo';
import { LABEL_ACTION_TYPES } from '../services/recommendation/utils/actionLabels';

dotenv.config();

type Args = {
    days: number;
    windowHours: number;
    surface?: string;
    experimentKey?: string;
    pipeline?: string;
    output: string;
    limit: number;
    keyVersion: string;
    captureEpochId: string;
};

const DEFAULT_EXPORT_REQUESTS = 2_000;
const MAX_EXPORT_REQUESTS = 8_192;
const MAX_CANDIDATES_PER_REQUEST = 2_048;
const MAX_TOTAL_CANDIDATES = 65_536;
const MAX_OUTCOME_ACTIONS_PER_REQUEST = 4_096;
const MAX_OUTCOME_ACTIONS = 131_072;
const EXPORT_SPOOL_LIMITS = Object.freeze({
    maxLineBytes: 1 << 20,
    maxFileBytes: 32 * 1024 * 1024,
    maxRecords: MAX_EXPORT_REQUESTS,
});
const PSEUDONYM_KEY_HEX = /^[0-9a-f]{64}$/;
const TRACE_PROJECTION = Object.freeze({
    _id: 0,
    requestId: 1,
    decisionId: 1,
    decisionLogV1: 1,
    decisionLogV1Sha256: 1,
    userId: 1,
    productSurface: 1,
    pipeline: 1,
    pipelineVersion: 1,
    traceVersion: 1,
    owner: 1,
    fallbackMode: 1,
    degradedReasons: 1,
    selectedCount: 1,
    inNetworkCount: 1,
    outOfNetworkCount: 1,
    sourceCounts: 1,
    authorDiversity: 1,
    replyRatio: 1,
    averageScore: 1,
    topScore: 1,
    bottomScore: 1,
    experimentKeys: 1,
    userState: 1,
    embeddingQualityScore: 1,
    shadowComparison: 1,
    candidates: 1,
    replayPool: 1,
});

function parseArgs(): Args {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = value;
    }

    return {
        days: Math.max(1, parseInt(kv.days || '14', 10) || 14),
        windowHours: Math.max(1, parseInt(kv.windowHours || '24', 10) || 24),
        surface: kv.surface || 'space_feed',
        experimentKey: kv.experimentKey || undefined,
        pipeline: kv.pipeline || undefined,
        output: kv.output || './tmp/replay_requests.ndjson',
        limit: boundedPositiveInteger(kv.limit, DEFAULT_EXPORT_REQUESTS, MAX_EXPORT_REQUESTS),
        keyVersion: kv.keyVersion || '',
        captureEpochId: kv.captureEpochId || '',
    };
}

function boundedPositiveInteger(raw: string | undefined, fallback: number, maximum: number): number {
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new Error('replay_export_argument_invalid');
    }
    return value;
}

function loadPseudonymMasterKey(args: Args): Buffer {
    const encoded = process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX || '';
    delete process.env.RECOMMENDATION_REPLAY_PSEUDONYM_KEY_HEX;
    if (!PSEUDONYM_KEY_HEX.test(encoded)) {
        throw new Error('replay_export_pseudonym_key_invalid');
    }
    const masterKey = Buffer.from(encoded, 'hex');
    const preflight = buildRecommendationViewerPseudonymV1({
        masterKey,
        viewerId: 'phase30-export-preflight',
        keyVersion: args.keyVersion,
        captureEpochId: args.captureEpochId,
    });
    if (preflight.status !== 'verified') {
        masterKey.fill(0);
        throw new Error(preflight.blocker);
    }
    return masterKey;
}

function pseudonymizeIdentity(
    domain: 'viewer' | 'author',
    value: unknown,
    masterKey: Buffer,
    args: Pick<Args, 'keyVersion' | 'captureEpochId'>,
    cache: Map<string, string>,
): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error('replay_export_identity_invalid');
    }
    const cacheKey = `${domain}\0${value}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const result = buildRecommendationViewerPseudonymV1({
        masterKey,
        viewerId: `${domain}:${value}`,
        keyVersion: args.keyVersion,
        captureEpochId: args.captureEpochId,
    });
    if (result.status !== 'verified') throw new Error(result.blocker);
    cache.set(cacheKey, result.pseudonym.viewerAccountPseudonym);
    return result.pseudonym.viewerAccountPseudonym;
}

function idToString(id: any): string {
    if (!id) return '';
    if (typeof id === 'string') return id;
    if (id instanceof mongoose.Types.ObjectId) return id.toString();
    if (typeof id.toString === 'function') return id.toString();
    return '';
}

function normalizeStringArray(value?: string[]): string[] {
    return Array.isArray(value) ? value.map((entry) => entry.trim()).filter(Boolean) : [];
}

function feedbackLabel(labels: ReplayCandidateLabelSummary): 'positive' | 'negative' | null {
    if (labels.negative) return 'negative';
    if (labels.engagement || labels.click || labels.dwellTimeMs > 0) return 'positive';
    return null;
}

type DecisionAction = RecommendationDecisionLogV1['actions'][number];

function candidateMatchesAction(candidate: any, action: DecisionAction): boolean {
    return action.actionKey.candidateNamespace === 'serving_post_id'
        ? idToString(candidate.postId) === action.actionKey.candidateId
        : candidate.modelPostId === action.actionKey.candidateId;
}

function actionKey(action: DecisionAction): string {
    return [action.actionKey.candidateNamespace, action.actionKey.candidateId, action.actionKey.servedPosition].join(
        ':',
    );
}

let pseudonymMasterKeyForCleanup: Buffer | undefined;
let snapshotSessionForCleanup: mongoose.ClientSession | undefined;
let spoolWriterForCleanup: { abort: () => Promise<void> } | undefined;
let spoolForCleanup: { cleanup: () => Promise<void> } | undefined;

async function main() {
    const args = parseArgs();
    const pseudonymMasterKey = loadPseudonymMasterKey(args);
    pseudonymMasterKeyForCleanup = pseudonymMasterKey;
    const outputPath = path.resolve(process.cwd(), args.output);
    const now = new Date();
    const since = new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000);
    const windowMs = args.windowHours * 60 * 60 * 1000;

    if (fs.existsSync(outputPath)) throw new Error('atomic_artifact_target_exists');
    await connectReadOnlyMongo();
    const snapshotSession = await mongoose.startSession({
        snapshot: true,
        causalConsistency: false,
    });
    snapshotSessionForCleanup = snapshotSession;

    let exportedRequests = 0;
    let exportedCandidates = 0;
    let observedOutcomeActions = 0;
    let plannedCandidates = 0;
    const traceQuery: Record<string, unknown> = {
        'decisionLogV1.decisionAt': {
            $gte: since.toISOString(),
            $lte: now.toISOString(),
        },
    };
    if (args.surface) traceQuery.productSurface = args.surface;
    if (args.experimentKey) traceQuery.experimentKeys = args.experimentKey;
    if (args.pipeline) traceQuery.pipeline = args.pipeline;

    const traceCursor = RecommendationTrace.aggregate([
        { $match: traceQuery },
        { $sort: { 'decisionLogV1.decisionAt': -1, _id: -1 } },
        { $limit: args.limit },
        { $sort: { 'decisionLogV1.decisionAt': 1, _id: 1 } },
        { $project: TRACE_PROJECTION },
    ])
        .session(snapshotSession)
        .cursor({ batchSize: 1 });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const spoolWriter = await createCanonicalSpoolWriterV2(EXPORT_SPOOL_LIMITS);
    spoolWriterForCleanup = spoolWriter;
    const identityPseudonyms = new Map<string, string>();

    for await (const trace of traceCursor as AsyncIterable<any>) {
        const parsed = recommendationDecisionLogSchema.safeParse(trace.decisionLogV1);
        if (!parsed.success) throw new Error('replay_export_source_contract_invalid');
        const decision = parsed.data;
        const decisionAtMs = Date.parse(decision.decisionAt);
        if (
            decisionAtMs < since.getTime() ||
            decisionAtMs > now.getTime() ||
            trace.requestId !== decision.requestId ||
            trace.decisionId !== decision.decisionId ||
            trace.decisionLogV1Sha256 !== decisionLogSha256(decision)
        )
            throw new Error('replay_export_source_binding_invalid');

        const traceCandidates = trace.replayPool?.candidates ?? trace.candidates;
        if (!Array.isArray(traceCandidates)) {
            throw new Error('replay_export_source_contract_invalid');
        }
        if (traceCandidates.length > MAX_CANDIDATES_PER_REQUEST) {
            throw new Error('replay_export_resource_limit_exceeded');
        }
        plannedCandidates += traceCandidates.length;
        if (plannedCandidates > MAX_TOTAL_CANDIDATES) {
            throw new Error('replay_export_resource_limit_exceeded');
        }

        const remainingOutcomeActions = MAX_OUTCOME_ACTIONS - observedOutcomeActions;
        const outcomeActions = await UserAction.find({
            'metadata.decisionId': decision.decisionId,
            action: { $in: [ActionType.IMPRESSION, ...LABEL_ACTION_TYPES] },
            timestamp: { $gte: since, $lte: now },
        })
            .select('metadata rank requestId userId action timestamp dwellTimeMs')
            .sort({ timestamp: 1, _id: 1 })
            .limit(Math.min(MAX_OUTCOME_ACTIONS_PER_REQUEST, remainingOutcomeActions) + 1)
            .session(snapshotSession)
            .lean();
        if (outcomeActions.length > MAX_OUTCOME_ACTIONS_PER_REQUEST || outcomeActions.length > remainingOutcomeActions)
            throw new Error('replay_export_resource_limit_exceeded');
        observedOutcomeActions += outcomeActions.length;

        const outcomesByActionKey = new Map(
            decision.actions.map((servedAction) => [
                actionKey(servedAction),
                attributeOutcomeV1({
                    decisionLog: decision,
                    servedAction,
                    traceUserId: trace.userId,
                    events: outcomeActions,
                    observedThrough: now,
                    horizonMs: windowMs,
                }),
            ]),
        );
        const replayCandidates = traceCandidates.reduce<ReplayRequestSnapshot['candidates']>((acc, candidate: any) => {
            const postId = idToString(candidate.postId);
            if (!postId) return acc;
            const servedAction = decision.actions.find((action) => candidateMatchesAction(candidate, action));
            const outcomeContractV1 = servedAction ? outcomesByActionKey.get(actionKey(servedAction)) : undefined;
            const labels = outcomeContractV1?.status === 'observed' ? outcomeContractV1.labels : undefined;
            const rank = finiteRank(candidate.rank);
            const replayCandidate = {
                requestId: decision.requestId,
                postId,
                modelPostId: candidate.modelPostId || '',
                authorId: pseudonymizeIdentity(
                    'author',
                    candidate.authorId,
                    pseudonymMasterKey,
                    args,
                    identityPseudonyms,
                ),
                rank,
                baselineRank: rank,
                recallSource: candidate.recallSource || '',
                secondaryRecallSources: normalizeStringArray(candidate.secondaryRecallSources),
                selectionPool: candidate.selectionPool || '',
                selectionReason: candidate.selectionReason || '',
                inNetwork: candidate.inNetwork === true,
                isNews: candidate.isNews === true,
                score: finiteNumberOrNull(candidate.score),
                weightedScore: finiteNumberOrNull(candidate.weightedScore),
                experimentKeys: normalizeStringArray(candidate.experimentKeys || trace.experimentKeys),
                productSurface: trace.productSurface || 'space_feed',
                pipelineScore: finiteNumberOrNull(candidate.pipelineScore),
                scoreBreakdown: candidate.scoreBreakdown || undefined,
                recommendationDetail: candidate.recommendationDetail || undefined,
                sourceReason: candidate.sourceReason || undefined,
                evidence: Array.isArray(candidate.evidence) ? candidate.evidence : undefined,
                explainSignals: candidate.explainSignals || undefined,
                createdAt: candidate.createdAt ? new Date(candidate.createdAt).toISOString() : undefined,
                ...(outcomeContractV1 ? { outcomeContractV1 } : {}),
                ...(labels
                    ? {
                          feedbackLabel: feedbackLabel(labels),
                          labels,
                      }
                    : {}),
            };
            acc.push(replayCandidate);
            return acc;
        }, []);
        const replayRequest: ReplayRequestSnapshot = {
            requestId: decision.requestId,
            decisionId: decision.decisionId,
            userId: pseudonymizeIdentity('viewer', trace.userId, pseudonymMasterKey, args, identityPseudonyms),
            requestAt: decision.decisionAt,
            productSurface: trace.productSurface || 'space_feed',
            pipeline: trace.pipeline || undefined,
            pipelineVersion: trace.pipelineVersion || undefined,
            traceVersion: trace.traceVersion || undefined,
            owner: trace.owner || undefined,
            fallbackMode: trace.fallbackMode || undefined,
            degradedReasons: trace.degradedReasons || [],
            selectedCount: trace.selectedCount || 0,
            inNetworkCount: trace.inNetworkCount || 0,
            outOfNetworkCount: trace.outOfNetworkCount || 0,
            sourceCounts: trace.sourceCounts || [],
            authorDiversity: trace.authorDiversity || 0,
            replyRatio: trace.replyRatio || 0,
            averageScore: trace.averageScore || 0,
            topScore: finiteNumberOrNull(trace.topScore),
            bottomScore: finiteNumberOrNull(trace.bottomScore),
            experimentKeys: trace.experimentKeys || [],
            userState: trace.userState || undefined,
            embeddingQualityScore: finiteNumberOrNull(trace.embeddingQualityScore),
            candidateSetKind: trace.replayPool?.poolKind || 'served_candidates_v1',
            candidateSetTotalCount: trace.replayPool?.totalCount ?? trace.candidates?.length ?? 0,
            candidateSetTruncated: trace.replayPool?.truncated === true,
            candidateSetCompleteness: trace.replayPool?.poolKind === RUST_CANONICAL_REPLAY_POOL_KIND
                && trace.replayPool.truncated !== true
                && trace.replayPool.totalCount === traceCandidates.length
                ? 'complete_v1'
                : 'unverified_v1',
            shadowComparison: trace.shadowComparison || undefined,
            candidates: replayCandidates,
        };

        await spoolWriter.write(replayRequest);
        exportedRequests += 1;
        exportedCandidates += replayRequest.candidates.length;
    }

    if (exportedRequests === 0) {
        console.log('[ExportRecsysReplay] no traces found for filters');
        return;
    }
    const completedSpool = await spoolWriter.finish();
    spoolWriterForCleanup = undefined;
    spoolForCleanup = completedSpool;
    await snapshotSession.endSession();
    snapshotSessionForCleanup = undefined;
    const publishResult = await publishAtomicCanonicalNdjsonV1({
        targetPath: outputPath,
        records: (async function* () {
            for await (const record of readCanonicalSpoolRecordsV2(completedSpool.stream, EXPORT_SPOOL_LIMITS)) {
                yield record.value;
            }
        })(),
        expectedSha256: completedSpool.sha256,
        expectedRecordCount: completedSpool.recordCount,
    });
    if (publishResult.status === 'published_durability_unconfirmed') {
        console.error('[ExportRecsysReplay] reconciliation_required:', {
            targetPath: outputPath,
            finalPathMayBeVisible: true,
            sha256: publishResult.sha256,
            recordCount: publishResult.recordCount,
            reason: publishResult.reason,
        });
        throw new Error(
            `replay_export_published_durability_unconfirmed_reconciliation_required:${publishResult.reason}`,
        );
    }

    console.log(`[ExportRecsysReplay] requests=${exportedRequests}`);
    console.log(`[ExportRecsysReplay] candidates=${exportedCandidates}`);
    console.log(`[ExportRecsysReplay] outcomeActions=${observedOutcomeActions}`);
    console.log('[ExportRecsysReplay] sourceRead=mongodb_snapshot_session_v1');
    console.log('[ExportRecsysReplay] evidenceStatus=diagnostic_only_unverified_source');
    console.log(`[ExportRecsysReplay] sha256=${publishResult.sha256}`);
    console.log(`[ExportRecsysReplay] wrote ${outputPath}`);
}

function finiteRank(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('replay_export_candidate_rank_invalid');
    }
    return value;
}

function finiteNumberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

main()
    .catch((error) => {
        console.error('[ExportRecsysReplay] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        pseudonymMasterKeyForCleanup?.fill(0);
        try {
            await snapshotSessionForCleanup?.endSession();
        } catch (error) {
            console.error('[ExportRecsysReplay] snapshot_session_cleanup_failed:', error);
            process.exitCode = 1;
        }
        try {
            if (spoolForCleanup) {
                await spoolForCleanup.cleanup();
            } else {
                await spoolWriterForCleanup?.abort();
            }
        } catch (error) {
            console.error('[ExportRecsysReplay] spool_cleanup_failed:', error);
            process.exitCode = 1;
        }
        try {
            await disconnectReadOnlyMongo();
        } catch {
            // ignore
        }
    });
