import type { FeedCandidate } from '../types/FeedCandidate';

export const RETRIEVAL_SIGNAL_KEYS = [
    'retrievalEmbeddingScore',
    'retrievalAuthorClusterScore',
    'retrievalCandidateClusterScore',
    'retrievalDenseVectorScore',
    'retrievalKeywordScore',
    'retrievalEngagementPrior',
    'retrievalAuthorPrior',
    'retrievalSnapshotQuality',
    'retrievalGraphScore',
    'retrievalGraphAggregateScore',
    'retrievalGraphViewerSignal',
    'retrievalGraphMultiSignalBonus',
    'retrievalGraphSocialNeighborScore',
    'retrievalGraphRecentEngagerScore',
    'retrievalGraphBridgeScore',
    'retrievalGraphCoEngagerScore',
    'retrievalGraphContentAffinityScore',
    'retrievalPoolDense',
    'retrievalPoolCluster',
    'retrievalPoolLegacy',
    'annRetrievalScore',
] as const;

export const RANKING_SIGNAL_KEYS = [
    'weightedRawScore',
    'weightedPositiveScore',
    'weightedNegativeScore',
    'weightedHeuristicFallbackUsed',
    'normalizedWeightedScore',
    'calibrationSourceMultiplier',
    'calibrationEmbeddingQualityMultiplier',
    'calibrationFreshnessMultiplier',
    'calibrationEngagementMultiplier',
    'calibrationEvidenceMultiplier',
    'calibrationUserStateMultiplier',
    'contentQuality',
    'authorAffinityScore',
    'authorAffinityBoost',
    'authorAffinityMultiplier',
    'recencyMultiplier',
    'ageHours',
    'diversityMultiplier',
    'baseScore',
    'oonFactor',
    'weightedScore',
    'finalScore',
    'pipelineScore',
] as const;

export const DISTRIBUTION_SIGNAL_KEYS = [
    'retrievalSecondarySourceCount',
    'retrievalMultiSourceBonus',
] as const;

export const EXPLAIN_SIGNAL_KEYS = [
    ...RETRIEVAL_SIGNAL_KEYS,
    ...RANKING_SIGNAL_KEYS,
    ...DISTRIBUTION_SIGNAL_KEYS,
] as const;

export type FeedSignalKey = (typeof EXPLAIN_SIGNAL_KEYS)[number];
type FeedSignalMap = Record<string, number> | undefined;

type SignalInput = {
    scoreBreakdown?: FeedSignalMap;
    explainSignals?: FeedSignalMap;
    candidate?: Pick<FeedCandidate, 'authorAffinityScore' | 'weightedScore' | 'score' | '_pipelineScore'>;
};

const SIGNAL_ALIASES: Partial<Record<FeedSignalKey, readonly string[]>> = {
    weightedRawScore: ['rawWeightedScore'],
    authorAffinityScore: ['authorAffinity'],
    authorAffinityBoost: ['affinityBoost'],
};

function finite(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readMapSignal(map: FeedSignalMap, key: string): number | undefined {
    if (!map) return undefined;
    return finite(map[key]);
}

export function readFeedSignalValue(input: SignalInput, key: FeedSignalKey | string): number | undefined {
    if (key === 'authorAffinityScore') {
        const topLevelAffinity = finite(input.candidate?.authorAffinityScore);
        if (typeof topLevelAffinity === 'number') {
            return topLevelAffinity;
        }
    }
    if (key === 'weightedScore') {
        const weightedScore = finite(input.candidate?.weightedScore);
        if (typeof weightedScore === 'number') {
            return weightedScore;
        }
    }
    if (key === 'finalScore') {
        const finalScore = finite(input.candidate?.score);
        if (typeof finalScore === 'number') {
            return finalScore;
        }
    }
    if (key === 'pipelineScore') {
        const pipelineScore = finite(input.candidate?._pipelineScore);
        if (typeof pipelineScore === 'number') {
            return pipelineScore;
        }
    }

    const aliases =
        typeof key === 'string'
            ? (SIGNAL_ALIASES[key as FeedSignalKey] || [])
            : [];
    const keys = [key, ...aliases];
    for (const currentKey of keys) {
        const explainValue = readMapSignal(input.explainSignals, currentKey);
        if (typeof explainValue === 'number') {
            return explainValue;
        }
        const breakdownValue = readMapSignal(input.scoreBreakdown, currentKey);
        if (typeof breakdownValue === 'number') {
            return breakdownValue;
        }
    }

    return undefined;
}

export function pickFeedSignals(
    input: SignalInput,
    keys: readonly FeedSignalKey[] = EXPLAIN_SIGNAL_KEYS,
): Record<string, number> | undefined {
    const entries = keys
        .map((key) => [key, readFeedSignalValue(input, key)] as const)
        .filter((entry): entry is readonly [FeedSignalKey, number] => typeof entry[1] === 'number');
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function pickFeedSignalGroup(
    input: SignalInput,
    group: 'retrieval' | 'ranking' | 'distribution',
): Record<string, number> | undefined {
    switch (group) {
        case 'retrieval':
            return pickFeedSignals(input, RETRIEVAL_SIGNAL_KEYS);
        case 'ranking':
            return pickFeedSignals(input, RANKING_SIGNAL_KEYS);
        case 'distribution':
            return pickFeedSignals(input, DISTRIBUTION_SIGNAL_KEYS);
        default:
            return undefined;
    }
}

export function buildCandidateSignalSnapshot(candidate: FeedCandidate): Record<string, number> | undefined {
    return pickFeedSignals({
        candidate,
        scoreBreakdown: candidate._scoreBreakdown,
    });
}
