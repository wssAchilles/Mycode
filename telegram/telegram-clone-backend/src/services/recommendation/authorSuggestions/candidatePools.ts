import type {
    AuthorSuggestionCandidate,
    AuthorSuggestionSource,
    ViewerSuggestionProfile,
} from './types';

interface CandidateSignalPatch {
    sourceScore?: number;
    recentPosts?: number;
    engagementScore?: number;
    graphProximity?: number;
    embeddingAffinity?: number;
    clusterProducerPrior?: number;
    qualityScore?: number;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function uniqueSources(sources: AuthorSuggestionSource[]): AuthorSuggestionSource[] {
    return Array.from(new Set(sources));
}

export function buildExcludedAuthorIds(
    userId: string,
    followedUserIds: Iterable<string>,
    blockedUserIds: Iterable<string>,
    mutedUserIds: Iterable<string>,
): Set<string> {
    return new Set([
        userId,
        ...Array.from(followedUserIds),
        ...Array.from(blockedUserIds),
        ...Array.from(mutedUserIds),
    ]);
}

export function deriveViewerSuggestionProfile(
    followedCount: number,
    recentPositiveActionCount: number,
    hasEmbedding: boolean,
): ViewerSuggestionProfile {
    if (followedCount === 0 && recentPositiveActionCount < 3) {
        return {
            state: 'cold_start',
            followedCount,
            recentPositiveActionCount,
            hasEmbedding,
        };
    }

    if (followedCount < 5 || recentPositiveActionCount < 6 || !hasEmbedding) {
        return {
            state: 'sparse',
            followedCount,
            recentPositiveActionCount,
            hasEmbedding,
        };
    }

    return {
        state: 'engaged',
        followedCount,
        recentPositiveActionCount,
        hasEmbedding,
    };
}

export function upsertAuthorSuggestionCandidate(
    candidates: Map<string, AuthorSuggestionCandidate>,
    userId: string,
    source: AuthorSuggestionSource,
    patch: CandidateSignalPatch = {},
): void {
    const current = candidates.get(userId);
    if (!current) {
        candidates.set(userId, {
            userId,
            sources: [source],
            sourceScores: patch.sourceScore !== undefined ? { [source]: clamp01(patch.sourceScore) } : {},
            recentPosts: patch.recentPosts || 0,
            engagementScore: patch.engagementScore || 0,
            graphProximity: clamp01(patch.graphProximity || 0),
            embeddingAffinity: clamp01(patch.embeddingAffinity || 0),
            clusterProducerPrior: clamp01(patch.clusterProducerPrior || 0),
            qualityScore: clamp01(patch.qualityScore || 0),
            recentActivityPrior: 0,
            engagementPrior: 0,
            noveltyBonus: 0,
            lowQualityDamping: 1,
            authorSuggestionPrior: 0,
            score: 0,
        });
        return;
    }

    current.sources = uniqueSources([...current.sources, source]);
    if (patch.sourceScore !== undefined) {
        current.sourceScores[source] = Math.max(
            current.sourceScores[source] || 0,
            clamp01(patch.sourceScore),
        );
    }
    current.recentPosts = Math.max(current.recentPosts, patch.recentPosts || 0);
    current.engagementScore = Math.max(current.engagementScore, patch.engagementScore || 0);
    current.graphProximity = Math.max(current.graphProximity, clamp01(patch.graphProximity || 0));
    current.embeddingAffinity = Math.max(
        current.embeddingAffinity,
        clamp01(patch.embeddingAffinity || 0),
    );
    current.clusterProducerPrior = Math.max(
        current.clusterProducerPrior,
        clamp01(patch.clusterProducerPrior || 0),
    );
    current.qualityScore = Math.max(current.qualityScore, clamp01(patch.qualityScore || 0));
}
