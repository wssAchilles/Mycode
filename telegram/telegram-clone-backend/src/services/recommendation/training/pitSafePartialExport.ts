import crypto from 'crypto';

import type { OutcomeContractV1 } from '../outcomes/outcomeContractV1';
import { buildSocialPhoenixFeatureMapAt } from '../socialPhoenix/featureEngineering';
import { summarizeActionsInWindow } from '../utils/actionLabels';

export type TimeValue = Date | string | number;

export type PointInTimeEvidence = {
    featureAt?: TimeValue;
    immutable?: boolean;
    version?: string | number;
};

export type PointInTimeEvidenceSet = {
    contacts?: PointInTimeEvidence;
    embedding?: PointInTimeEvidence;
    snapshot?: PointInTimeEvidence;
};

export type PitSafeAction = Record<string, unknown> & {
    action: string;
    timestamp: TimeValue;
    dwellTimeMs?: number;
};

export type PitSafePartialCandidate = {
    sampleId: string;
    eventTime: TimeValue;
    row: Record<string, unknown>;
    evidence: PointInTimeEvidenceSet;
    labelObservedThrough?: TimeValue;
    presetQuarantineReasons?: string[];
};

type PartialExportImpression = {
    sampleId?: string;
    userId: string;
    postId: string;
    targetAuthorId?: string;
    requestId?: string;
    rank?: number;
    timestamp: TimeValue;
    inNetwork?: boolean;
    isNews?: boolean;
    score?: number;
    weightedScore?: number;
    selectionPool?: string;
    selectionReason?: string;
    modelPostId?: string;
    recallSource?: string;
    secondaryRecallSources?: string[];
    experimentKeys?: string[];
    productSurface?: string;
};

type PartialExportEmbedding = Record<string, unknown> & {
    interestedInClusters?: Array<{ clusterId: number; score: number }>;
    producerEmbedding?: Array<{ clusterId: number; score: number }>;
    knownForCluster?: number;
    knownForScore?: number;
    qualityScore?: number;
    computedAt?: TimeValue;
    version?: string | number;
};

type PartialExportSnapshot = Record<string, unknown> & {
    computedAt?: TimeValue;
    snapshotVersion?: string | number;
    postCreatedAt?: TimeValue;
    dominantClusterIds?: number[];
    clusterScores?: Array<{ clusterId: number; score: number }>;
    keywords?: string[];
    keywordScores?: Array<{ keyword: string; weight: number }>;
    engagementBucket?: string;
    freshnessBucket?: string;
    qualityScore?: number;
    authorKnownForCluster?: number;
    mediaTypes?: string[];
};

type PartialExportTrace = Record<string, unknown> & {
    pipeline?: string;
    pipelineVersion?: string;
    traceVersion?: string;
    owner?: string;
    fallbackMode?: string;
    degradedReasons?: string[];
    selectedCount?: number;
    inNetworkCount?: number;
    outOfNetworkCount?: number;
    sourceCounts?: Array<{ source: string; count: number }>;
    authorDiversity?: number;
    replyRatio?: number;
    averageScore?: number;
    topScore?: number;
    bottomScore?: number;
    freshness?: {
        newestAgeSeconds?: number;
        oldestAgeSeconds?: number;
        timeRangeSeconds?: number;
    };
    shadowComparison?: {
        overlapRatio?: number;
        selectedCount?: number;
        baselineCount?: number;
    };
};

export type PitSafePartialSampleInput = {
    impression: PartialExportImpression;
    decisionAt?: TimeValue;
    outcomeContractV1?: OutcomeContractV1;
    historyActions: PitSafeAction[];
    labelActions: PitSafeAction[];
    labelObservedThrough: TimeValue;
    windowMs: number;
    surface?: string;
    user?: { createdAt?: TimeValue };
    contacts: { followedUserIds: string[]; evidence?: PointInTimeEvidence };
    embedding?: PartialExportEmbedding;
    snapshot?: PartialExportSnapshot;
    trace?: PartialExportTrace;
};

export const PIT_QUARANTINE_REASONS = {
    labelWindowIncomplete: 'label_window_incomplete',
    exposureMissing: 'exposure_missing',
    censored: 'censored',
    invalidAttribution: 'invalid_attribution',
    contactsEvidenceMissing: 'contacts_point_in_time_evidence_missing',
    contactsAfterEvent: 'contacts_computed_after_event',
    embeddingEvidenceMissing: 'embedding_point_in_time_evidence_missing',
    embeddingAfterEvent: 'embedding_computed_after_event',
    snapshotEvidenceMissing: 'snapshot_point_in_time_evidence_missing',
    snapshotAfterEvent: 'snapshot_computed_after_event',
} as const;

export type PitSafePartialManifest = {
    manifestVersion: 'pit-safe-partial';
    trainingReady: false;
    cutoff: string;
    counts: { input: number; valid: number; quarantine: number };
    reasonCounts: Record<string, number>;
    pitCoverage: number;
    files: {
        valid: { path: string; sha256: string };
        quarantine: { path: string; sha256: string };
    };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_WINDOW_MS = 7 * DAY_MS;
const POSITIVE_ACTIONS = new Set([
    'click',
    'like',
    'reply',
    'repost',
    'quote',
    'share',
    'profile_click',
    'dwell',
    'video_quality_view',
]);

function toMs(value: TimeValue | undefined): number {
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    return value ? new Date(value).getTime() : Number.NaN;
}

function toIso(value: TimeValue): string {
    const timestamp = toMs(value);
    if (!Number.isFinite(timestamp)) throw new Error('invalid_timestamp');
    return new Date(timestamp).toISOString();
}

export function parseRequiredCutoff(value: string | undefined): Date {
    if (!value?.trim()) throw new Error('cutoff_required');
    const normalized = value.trim();
    const cutoff = new Date(normalized);
    if (!Number.isFinite(cutoff.getTime())) throw new Error('invalid_cutoff');
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
        throw new Error('cutoff_timezone_required');
    }
    return cutoff;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSparseEntries(
    entries: Array<{ clusterId: number; score: number }> | undefined,
): Array<{ clusterId: number; score: number }> {
    if (!Array.isArray(entries)) return [];
    return entries
        .filter((entry) => Number.isFinite(entry?.clusterId) && Number.isFinite(entry?.score))
        .sort((left, right) => right.score - left.score || left.clusterId - right.clusterId)
        .slice(0, 12)
        .map((entry) => ({ clusterId: entry.clusterId, score: entry.score }));
}

function normalizeEmbedding(embedding: PartialExportEmbedding | undefined, eventMs: number) {
    if (!embedding) return undefined;
    const computedAtMs = toMs(embedding.computedAt);
    const interestedInClusters = normalizeSparseEntries(embedding.interestedInClusters);
    const producerEmbedding = normalizeSparseEntries(embedding.producerEmbedding);
    const stale = !Number.isFinite(computedAtMs) || eventMs - computedAtMs > 30 * DAY_MS;
    const qualityScore = typeof embedding.qualityScore === 'number' ? embedding.qualityScore : 0;

    return {
        interestedInClusters,
        producerEmbedding,
        knownForCluster: embedding.knownForCluster,
        knownForScore: embedding.knownForScore,
        qualityScore,
        computedAt: Number.isFinite(computedAtMs) ? new Date(computedAtMs) : undefined,
        version: embedding.version,
        usable: !stale && qualityScore >= 0.04 && interestedInClusters.length > 0,
        stale,
    };
}

function partitionActions(
    eventMs: number,
    historyActions: PitSafeAction[],
    labelActions: PitSafeAction[],
    windowMs: number,
) {
    const sortActions = (left: PitSafeAction, right: PitSafeAction) => (
        toMs(left.timestamp) - toMs(right.timestamp)
        || compareText(String(left.action), String(right.action))
    );
    const featureHistory = historyActions
        .filter((action) => {
            const timestamp = toMs(action.timestamp);
            return Number.isFinite(timestamp)
                && timestamp <= eventMs
                && timestamp >= eventMs - HISTORY_WINDOW_MS;
        })
        .slice()
        .sort(sortActions);
    const labelWindow = labelActions
        .filter((action) => {
            const timestamp = toMs(action.timestamp);
            return Number.isFinite(timestamp)
                && timestamp > eventMs
                && timestamp <= eventMs + Math.max(0, windowMs);
        })
        .slice()
        .sort(sortActions);
    return { featureHistory, labelWindow };
}

function userStateAtEvent(input: {
    eventMs: number;
    followedCount: number;
    featureHistory: PitSafeAction[];
    embeddingUsable: boolean;
    accountCreatedAt?: TimeValue;
}) {
    const recentActionCount = input.featureHistory.length;
    const recentPositiveActionCount = input.featureHistory.filter((action) => (
        POSITIVE_ACTIONS.has(String(action.action))
    )).length;
    const accountCreatedAtMs = toMs(input.accountCreatedAt);
    const accountAgeDays = Number.isFinite(accountCreatedAtMs)
        ? Math.max(0, Math.floor((input.eventMs - accountCreatedAtMs) / DAY_MS))
        : undefined;
    let state: 'cold_start' | 'sparse' | 'warm' | 'heavy' = 'heavy';
    let reason = 'dense_recent_activity';
    if (input.followedCount === 0 && recentPositiveActionCount < 3) {
        state = 'cold_start';
        reason = 'no_follow_graph_low_recent_engagement';
    } else if (!input.embeddingUsable || recentPositiveActionCount < 8 || recentActionCount < 12) {
        state = 'sparse';
        reason = !input.embeddingUsable ? 'embedding_unusable' : 'insufficient_recent_actions';
    } else if (recentPositiveActionCount < 30) {
        state = 'warm';
        reason = 'stable_but_not_dense';
    }
    return {
        state,
        reason,
        followedCount: input.followedCount,
        recentActionCount,
        recentPositiveActionCount,
        usableEmbedding: input.embeddingUsable,
        accountAgeDays,
    };
}

function engagementBucketPrior(bucket?: string): number {
    if (bucket === 'viral') return 0.85;
    if (bucket === 'high') return 0.6;
    if (bucket === 'medium') return 0.35;
    if (bucket === 'low') return 0.12;
    return 0;
}

function feedbackLabel(
    labels: ReturnType<typeof summarizeActionsInWindow>,
): 'positive' | 'negative' | null {
    if (labels.negative) return 'negative';
    if (labels.engagement || labels.click || labels.dwellTimeMs > 0) return 'positive';
    return null;
}

function projectClusterScores(
    value: unknown,
): Array<{ clusterId: number; score: number }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const source = entry as Record<string, unknown>;
        return typeof source.clusterId === 'number'
            && Number.isFinite(source.clusterId)
            && typeof source.score === 'number'
            && Number.isFinite(source.score)
            ? [{ clusterId: source.clusterId, score: source.score }]
            : [];
    });
}

function projectKeywordScores(
    value: unknown,
): Array<{ keyword: string; weight: number }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const source = entry as Record<string, unknown>;
        return typeof source.keyword === 'string'
            && typeof source.weight === 'number'
            && Number.isFinite(source.weight)
            ? [{ keyword: source.keyword, weight: source.weight }]
            : [];
    });
}

function projectSnapshot(value: unknown): PartialExportSnapshot | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const document = value as {
        toObject?: (options?: Record<string, unknown>) => unknown;
    };
    const raw = typeof document.toObject === 'function'
        ? document.toObject({
            depopulate: true,
            flattenMaps: true,
            getters: false,
            virtuals: false,
            versionKey: false,
        })
        : value;
    if (!raw || typeof raw !== 'object') return undefined;
    const source = raw as Record<string, unknown>;
    const dominantClusterIds = Array.isArray(source.dominantClusterIds)
        ? source.dominantClusterIds.filter((entry): entry is number => (
            typeof entry === 'number' && Number.isFinite(entry)
        ))
        : [];
    const keywords = Array.isArray(source.keywords)
        ? source.keywords.filter((entry): entry is string => typeof entry === 'string')
        : [];
    const mediaTypes = Array.isArray(source.mediaTypes)
        ? source.mediaTypes.filter((entry): entry is string => typeof entry === 'string')
        : [];

    return {
        computedAt: source.computedAt as TimeValue | undefined,
        snapshotVersion: source.snapshotVersion as string | number | undefined,
        postCreatedAt: source.postCreatedAt as TimeValue | undefined,
        dominantClusterIds,
        clusterScores: projectClusterScores(source.clusterScores),
        keywords,
        keywordScores: projectKeywordScores(source.keywordScores),
        engagementBucket: typeof source.engagementBucket === 'string'
            ? source.engagementBucket
            : undefined,
        freshnessBucket: typeof source.freshnessBucket === 'string'
            ? source.freshnessBucket
            : undefined,
        qualityScore: typeof source.qualityScore === 'number' ? source.qualityScore : undefined,
        authorKnownForCluster: typeof source.authorKnownForCluster === 'number'
            ? source.authorKnownForCluster
            : undefined,
        mediaTypes,
    };
}

export function projectPitSafeSnapshotMap(
    snapshots: ReadonlyMap<string, unknown>,
): Map<string, PartialExportSnapshot> {
    const projected = new Map<string, PartialExportSnapshot>();
    for (const [postId, snapshot] of snapshots) {
        const value = projectSnapshot(snapshot);
        if (value) projected.set(postId, value);
    }
    return projected;
}

export function buildPitSafePartialSample(
    input: PitSafePartialSampleInput,
): PitSafePartialCandidate {
    const eventMs = toMs(
        input.decisionAt
        ?? input.outcomeContractV1?.decisionAt
        ?? input.impression.timestamp,
    );
    if (!Number.isFinite(eventMs)) throw new Error('invalid_event_timestamp');
    const labelObservedThroughMs = toMs(
        input.outcomeContractV1?.observedThrough
        ?? input.labelObservedThrough,
    );
    if (!Number.isFinite(labelObservedThroughMs)) {
        throw new Error('invalid_label_observed_through');
    }
    const { featureHistory, labelWindow } = partitionActions(
        eventMs,
        input.historyActions,
        input.labelActions,
        input.windowMs,
    );
    const legacyLabels = summarizeActionsInWindow(
        eventMs,
        labelWindow.map((action) => ({
            action: action.action,
            timestamp: action.timestamp,
            dwellTimeMs: action.dwellTimeMs,
        })),
        input.windowMs,
    );
    const labels = input.outcomeContractV1?.status === 'observed'
        ? input.outcomeContractV1.labels
        : input.outcomeContractV1
            ? undefined
            : legacyLabels;
    const embedding = normalizeEmbedding(input.embedding, eventMs);
    const userState = userStateAtEvent({
        eventMs,
        followedCount: input.contacts.followedUserIds.length,
        featureHistory,
        embeddingUsable: embedding?.usable === true,
        accountCreatedAt: input.user?.createdAt,
    });
    const snapshot = projectSnapshot(input.snapshot);
    const trace = input.trace;
    const mediaTypes = snapshot?.mediaTypes || [];
    const trainingFeatures = buildSocialPhoenixFeatureMapAt({
        userState: userState.state,
        embeddingQualityScore: embedding?.qualityScore ?? 0,
        recallSource: input.impression.recallSource || 'unknown',
        inNetwork: input.impression.inNetwork === true,
        retrievalEmbeddingScore: input.impression.weightedScore ?? input.impression.score ?? 0,
        retrievalDenseVectorScore: 0,
        retrievalAuthorClusterScore: 0,
        retrievalCandidateClusterScore: 0,
        retrievalKeywordScore: 0,
        retrievalEngagementPrior: engagementBucketPrior(snapshot?.engagementBucket),
        retrievalSnapshotQuality: snapshot?.qualityScore ?? 0,
        createdAt: snapshot?.postCreatedAt as Date | string | undefined,
        hasImage: mediaTypes.includes('image'),
        hasVideo: mediaTypes.includes('video'),
    }, eventMs);
    const sampleId = input.impression.sampleId || [
        input.impression.userId,
        input.impression.postId,
        toIso(eventMs),
        input.impression.requestId || '',
    ].join(':');
    const outcomeQuarantineReason = input.outcomeContractV1?.status === 'observed'
        ? undefined
        : input.outcomeContractV1?.status;
    const presetQuarantineReasons = outcomeQuarantineReason
        ? [outcomeQuarantineReason]
        : input.outcomeContractV1
            ? []
            : labelObservedThroughMs < eventMs + Math.max(0, input.windowMs)
                ? [PIT_QUARANTINE_REASONS.labelWindowIncomplete]
                : [];
    const impressionAt = input.outcomeContractV1
        ? 'impressionAt' in input.outcomeContractV1
            ? input.outcomeContractV1.impressionAt ?? null
            : null
        : toIso(input.impression.timestamp);
    const labelFields = labels ? {
        feedbackLabel: feedbackLabel(labels),
        labelClick: labels.click ? 1 : 0,
        labelLike: labels.like ? 1 : 0,
        labelReply: labels.reply ? 1 : 0,
        labelRepost: labels.repost ? 1 : 0,
        labelQuote: labels.quote ? 1 : 0,
        labelShare: labels.share ? 1 : 0,
        labelDismiss: labels.dismiss ? 1 : 0,
        labelBlockAuthor: labels.blockAuthor ? 1 : 0,
        labelReport: labels.report ? 1 : 0,
        labelEngagement: labels.engagement ? 1 : 0,
        labelNegative: labels.negative ? 1 : 0,
        labelDwellTimeMs: labels.dwellTimeMs,
    } : {
        feedbackLabel: null,
        labelClick: null,
        labelLike: null,
        labelReply: null,
        labelRepost: null,
        labelQuote: null,
        labelShare: null,
        labelDismiss: null,
        labelBlockAuthor: null,
        labelReport: null,
        labelEngagement: null,
        labelNegative: null,
        labelDwellTimeMs: null,
    };

    return {
        sampleId,
        eventTime: eventMs,
        labelObservedThrough: labelObservedThroughMs,
        presetQuarantineReasons,
        evidence: {
            contacts: input.contacts.evidence,
            embedding: input.embedding ? {
                featureAt: input.embedding.computedAt,
                version: input.embedding.version,
            } : undefined,
            snapshot: snapshot ? {
                featureAt: snapshot.computedAt,
                version: snapshot.snapshotVersion,
            } : undefined,
        },
        row: {
            userId: input.impression.userId,
            requestId: input.impression.requestId || '',
            postId: input.impression.postId,
            targetAuthorId: input.impression.targetAuthorId || '',
            impressionAt,
            rank: input.impression.rank ?? null,
            inNetwork: input.impression.inNetwork === true,
            isNews: input.impression.isNews === true,
            score: input.impression.score ?? null,
            weightedScore: input.impression.weightedScore ?? null,
            secondaryRecallSources: (input.impression.secondaryRecallSources || [])
                .map((entry) => entry.trim())
                .filter(Boolean)
                .sort(compareText),
            selectionPool: input.impression.selectionPool || '',
            selectionReason: input.impression.selectionReason || '',
            modelPostId: input.impression.modelPostId || '',
            recallSource: input.impression.recallSource || null,
            experimentKeys: (input.impression.experimentKeys || []).slice().sort(compareText),
            productSurface: input.impression.productSurface || input.surface || null,
            windowHours: input.windowMs / (60 * 60 * 1000),
            featureHistoryActionCount: featureHistory.length,
            labelWindowActionCount: input.outcomeContractV1 ? null : labelWindow.length,
            outcomeContractV1: input.outcomeContractV1,
            ...labelFields,
            userState: userState.state,
            userStateReason: userState.reason,
            userFollowedCount: userState.followedCount,
            userRecentActionCount: userState.recentActionCount,
            userRecentPositiveActionCount: userState.recentPositiveActionCount,
            embeddingUsable: userState.usableEmbedding,
            embeddingQualityScore: embedding?.qualityScore ?? null,
            embeddingInterestedClusters: embedding?.interestedInClusters || [],
            embeddingProducerClusters: embedding?.producerEmbedding || [],
            snapshotDominantClusters: snapshot?.dominantClusterIds || [],
            snapshotClusterScores: snapshot?.clusterScores || [],
            snapshotKeywords: snapshot?.keywords || [],
            snapshotKeywordScores: snapshot?.keywordScores || [],
            snapshotEngagementBucket: snapshot?.engagementBucket || null,
            snapshotFreshnessBucket: snapshot?.freshnessBucket || null,
            snapshotQualityScore: snapshot?.qualityScore ?? null,
            snapshotAuthorKnownForCluster: snapshot?.authorKnownForCluster ?? null,
            retrievalAuthorClusterScore: 0,
            retrievalCandidateClusterScore: 0,
            retrievalKeywordScore: 0,
            retrievalDenseVectorScore: 0,
            trainingFeatures,
            requestSelectedCount: trace?.selectedCount ?? null,
            requestPipeline: trace?.pipeline || '',
            requestPipelineVersion: trace?.pipelineVersion || '',
            requestTraceVersion: trace?.traceVersion || '',
            requestOwner: trace?.owner || '',
            requestFallbackMode: trace?.fallbackMode || '',
            requestDegradedReasons: (trace?.degradedReasons || []).slice().sort(compareText),
            requestInNetworkCount: trace?.inNetworkCount ?? null,
            requestOutOfNetworkCount: trace?.outOfNetworkCount ?? null,
            requestSourceCounts: (trace?.sourceCounts || []).slice().sort((left, right) => (
                compareText(left.source, right.source)
            )),
            requestAuthorDiversity: trace?.authorDiversity ?? null,
            requestReplyRatio: trace?.replyRatio ?? null,
            requestAverageScore: trace?.averageScore ?? null,
            requestTopScore: trace?.topScore ?? null,
            requestBottomScore: trace?.bottomScore ?? null,
            requestNewestAgeSeconds: trace?.freshness?.newestAgeSeconds ?? null,
            requestOldestAgeSeconds: trace?.freshness?.oldestAgeSeconds ?? null,
            requestTimeRangeSeconds: trace?.freshness?.timeRangeSeconds ?? null,
            requestShadowOverlapRatio: trace?.shadowComparison?.overlapRatio ?? null,
            requestShadowSelectedCount: trace?.shadowComparison?.selectedCount ?? null,
            requestShadowBaselineCount: trace?.shadowComparison?.baselineCount ?? null,
        },
    };
}

function hasVersion(evidence: PointInTimeEvidence): boolean {
    return typeof evidence.version === 'number'
        ? Number.isFinite(evidence.version) && evidence.version > 0
        : typeof evidence.version === 'string' && evidence.version.trim().length > 0;
}

function evidenceReason(
    eventMs: number,
    evidence: PointInTimeEvidence | undefined,
    missingReason: string,
    afterReason: string,
): string | undefined {
    const featureAtMs = toMs(evidence?.featureAt);
    if (!evidence || !Number.isFinite(featureAtMs)) return missingReason;
    if (featureAtMs > eventMs) return afterReason;
    if (evidence.immutable !== true && !hasVersion(evidence)) return missingReason;
    return undefined;
}

function quarantineReasons(candidate: PitSafePartialCandidate): string[] {
    const eventMs = toMs(candidate.eventTime);
    if (!Number.isFinite(eventMs)) throw new Error('invalid_candidate_event_time');
    return Array.from(new Set([
        ...(candidate.presetQuarantineReasons || []),
        evidenceReason(
            eventMs,
            candidate.evidence.contacts,
            PIT_QUARANTINE_REASONS.contactsEvidenceMissing,
            PIT_QUARANTINE_REASONS.contactsAfterEvent,
        ),
        evidenceReason(
            eventMs,
            candidate.evidence.embedding,
            PIT_QUARANTINE_REASONS.embeddingEvidenceMissing,
            PIT_QUARANTINE_REASONS.embeddingAfterEvent,
        ),
        evidenceReason(
            eventMs,
            candidate.evidence.snapshot,
            PIT_QUARANTINE_REASONS.snapshotEvidenceMissing,
            PIT_QUARANTINE_REASONS.snapshotAfterEvent,
        ),
    ].filter((reason): reason is string => Boolean(reason)))).sort(compareText);
}

function canonicalize(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const output: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort(compareText)) {
            const normalized = canonicalize((value as Record<string, unknown>)[key]);
            if (typeof normalized !== 'undefined') output[key] = normalized;
        }
        return output;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
}

export function stableStringify(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

export function sha256(content: string | Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function toNdjson(records: Record<string, unknown>[]): string {
    if (records.length === 0) return '';
    return `${records.map(stableStringify).join('\n')}\n`;
}

export function buildPitSafePartialArtifacts(input: {
    candidates: PitSafePartialCandidate[];
    cutoff: TimeValue;
    validFile: string;
    quarantineFile: string;
}): {
    validNdjson: string;
    quarantineNdjson: string;
    manifest: PitSafePartialManifest;
    manifestJson: string;
} {
    const ordered = input.candidates.slice().sort((left, right) => (
        compareText(left.sampleId, right.sampleId)
        || compareText(toIso(left.eventTime), toIso(right.eventTime))
        || compareText(stableStringify(left.row), stableStringify(right.row))
        || compareText(stableStringify(left.evidence), stableStringify(right.evidence))
        || compareText(
            left.labelObservedThrough === undefined ? '' : toIso(left.labelObservedThrough),
            right.labelObservedThrough === undefined ? '' : toIso(right.labelObservedThrough),
        )
        || compareText(
            stableStringify((left.presetQuarantineReasons || []).slice().sort(compareText)),
            stableStringify((right.presetQuarantineReasons || []).slice().sort(compareText)),
        )
    ));
    const valid: Record<string, unknown>[] = [];
    const quarantine: Record<string, unknown>[] = [];
    const reasonCounts = new Map<string, number>();

    for (const candidate of ordered) {
        const reasons = quarantineReasons(candidate);
        const record = {
            ...candidate.row,
            featureProvenance: candidate.evidence,
            pitSampleId: candidate.sampleId,
            pitEventTime: toIso(candidate.eventTime),
        };
        if (reasons.length === 0) {
            valid.push(record);
            continue;
        }
        quarantine.push({ ...record, quarantineReasons: reasons });
        for (const reason of reasons) {
            reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
        }
    }

    const validNdjson = toNdjson(valid);
    const quarantineNdjson = toNdjson(quarantine);
    const counts = {
        input: ordered.length,
        valid: valid.length,
        quarantine: quarantine.length,
    };
    const manifest: PitSafePartialManifest = {
        manifestVersion: 'pit-safe-partial',
        trainingReady: false,
        cutoff: toIso(input.cutoff),
        counts,
        reasonCounts: Object.fromEntries(
            Array.from(reasonCounts.entries()).sort(([left], [right]) => compareText(left, right)),
        ),
        pitCoverage: counts.input === 0 ? 0 : counts.valid / counts.input,
        files: {
            valid: { path: input.validFile, sha256: sha256(validNdjson) },
            quarantine: { path: input.quarantineFile, sha256: sha256(quarantineNdjson) },
        },
    };
    return {
        validNdjson,
        quarantineNdjson,
        manifest,
        manifestJson: `${stableStringify(manifest)}\n`,
    };
}
