import type { FeedCandidate } from '../types/FeedCandidate';
import type { RecommendationShadowComparison } from '../rust/runtimeMetrics';

export interface SpaceFeedDebugInfo {
    requestId?: string;
    pipeline: string;
    owner?: string;
    fallbackMode?: string;
    selectedSourceCounts: Record<string, number>;
    inNetworkCount: number;
    outOfNetworkCount: number;
    degradedReasons: string[];
    shadowComparison?: RecommendationShadowComparison;
}

export function buildRecommendationShadowComparison(
    baseline: FeedCandidate[],
    rustCandidates: FeedCandidate[],
): RecommendationShadowComparison {
    const baselineIds = new Set(baseline.map((candidate) => candidate.postId.toString()));
    const overlapCount = rustCandidates.filter((candidate) =>
        baselineIds.has(candidate.postId.toString()),
    ).length;

    return {
        overlapCount,
        overlapRatio:
            rustCandidates.length > 0 ? overlapCount / rustCandidates.length : 0,
        selectedCount: rustCandidates.length,
        baselineCount: baseline.length,
    };
}

export function buildSpaceFeedDebugInfo(
    candidates: FeedCandidate[],
    options: {
        requestId?: string;
        pipeline: string;
        owner?: string;
        fallbackMode?: string;
        degradedReasons?: string[];
        shadowComparison?: RecommendationShadowComparison;
    },
): SpaceFeedDebugInfo {
    const inNetworkCount = candidates.filter((candidate) => Boolean(candidate.inNetwork)).length;
    return {
        requestId: options.requestId,
        pipeline: options.pipeline,
        owner: options.owner,
        fallbackMode: options.fallbackMode,
        selectedSourceCounts: summarizeSelectedSourceCounts(candidates),
        inNetworkCount,
        outOfNetworkCount: Math.max(candidates.length - inNetworkCount, 0),
        degradedReasons: options.degradedReasons ?? [],
        shadowComparison: options.shadowComparison,
    };
}

function summarizeSelectedSourceCounts(candidates: FeedCandidate[]): Record<string, number> {
    return candidates.reduce<Record<string, number>>((acc, candidate) => {
        const key = typeof candidate.recallSource === 'string' && candidate.recallSource
            ? candidate.recallSource
            : 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}
