import type { AuthorSuggestionCandidate, ViewerSuggestionProfile } from './types';
import { computeAuthorSuggestionPrior } from '../signals/authorSemantics';

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function logNormalize(value: number, maxReference: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return clamp01(Math.log1p(value) / Math.log1p(maxReference));
}

function computeRecentActivityPrior(recentPosts: number): number {
    return clamp01(logNormalize(recentPosts, 8));
}

function computeEngagementPrior(engagementScore: number): number {
    return clamp01(logNormalize(engagementScore, 180));
}

function computeNoveltyBonus(candidate: AuthorSuggestionCandidate): number {
    if (candidate.sources.includes('graph') && candidate.sources.includes('embedding')) {
        return 0.1;
    }
    if (candidate.sources.includes('embedding')) {
        return 0.085;
    }
    if (candidate.sources.includes('graph')) {
        return 0.075;
    }
    if (candidate.sources.includes('fallback')) {
        return 0.03;
    }
    return 0.055;
}

function computeLowQualityDamping(candidate: AuthorSuggestionCandidate): number {
    if (candidate.qualityScore >= 0.55) {
        return 1;
    }
    if (candidate.recentPosts >= 3 || candidate.engagementScore >= 24) {
        return 0.94;
    }
    if (candidate.qualityScore >= 0.25) {
        return 0.88;
    }
    return candidate.sources.includes('fallback') ? 0.82 : 0.78;
}

function viewerWeights(profile: ViewerSuggestionProfile) {
    if (profile.state === 'cold_start') {
        return {
            recentActivity: 0.3,
            engagement: 0.22,
            graph: 0.12,
            embedding: 0.16,
            cluster: 0.12,
            novelty: 0.08,
        };
    }

    if (profile.state === 'sparse') {
        return {
            recentActivity: 0.22,
            engagement: 0.14,
            graph: 0.18,
            embedding: 0.27,
            cluster: 0.11,
            novelty: 0.08,
        };
    }

    return {
        recentActivity: 0.18,
        engagement: 0.14,
        graph: 0.24,
        embedding: 0.24,
        cluster: 0.12,
        novelty: 0.08,
    };
}

export function buildAuthorSuggestionReason(candidate: AuthorSuggestionCandidate): string {
    if (candidate.embeddingAffinity >= 0.24 && candidate.graphProximity >= 0.2) {
        return '兴趣相近 · 社交桥接';
    }
    if (candidate.embeddingAffinity >= 0.22 || candidate.clusterProducerPrior >= 0.18) {
        return '兴趣相近作者';
    }
    if (candidate.graphProximity >= 0.2) {
        return '社交桥接作者';
    }
    if (candidate.recentPosts >= 2 || candidate.engagementScore >= 12) {
        return '近期活跃作者';
    }
    return '新加入作者';
}

export function scoreAuthorSuggestionCandidate(
    candidate: AuthorSuggestionCandidate,
    profile: ViewerSuggestionProfile,
): AuthorSuggestionCandidate {
    const weights = viewerWeights(profile);
    const recentActivityPrior = computeRecentActivityPrior(candidate.recentPosts);
    const engagementPrior = computeEngagementPrior(candidate.engagementScore);
    const noveltyBonus = computeNoveltyBonus(candidate);
    const lowQualityDamping = computeLowQualityDamping(candidate);
    const crossSourceBonus =
        candidate.sources.length >= 3 ? 0.05 : candidate.sources.length === 2 ? 0.025 : 0;
    const authorSuggestionPrior = computeAuthorSuggestionPrior({
        graphProximity: candidate.graphProximity,
        embeddingAffinity: candidate.embeddingAffinity,
        clusterProducerPrior: candidate.clusterProducerPrior,
        recentPosts: candidate.recentPosts,
        engagementScore: candidate.engagementScore,
        qualityScore: candidate.qualityScore,
        sourceCount: candidate.sources.length,
    });

    const rawScore =
        recentActivityPrior * weights.recentActivity +
        engagementPrior * weights.engagement +
        clamp01(candidate.graphProximity) * weights.graph +
        clamp01(candidate.embeddingAffinity) * weights.embedding +
        clamp01(candidate.clusterProducerPrior) * weights.cluster +
        noveltyBonus * weights.novelty +
        authorSuggestionPrior * 0.04 +
        crossSourceBonus;

    return {
        ...candidate,
        recentActivityPrior,
        engagementPrior,
        noveltyBonus,
        lowQualityDamping,
        authorSuggestionPrior,
        score: clamp01(rawScore * lowQualityDamping),
        reason: buildAuthorSuggestionReason(candidate),
    };
}

export function rankAuthorSuggestionCandidates(
    candidates: AuthorSuggestionCandidate[],
    profile: ViewerSuggestionProfile,
    limit: number,
): AuthorSuggestionCandidate[] {
    return candidates
        .map((candidate) => scoreAuthorSuggestionCandidate(candidate, profile))
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            if (right.engagementScore !== left.engagementScore) {
                return right.engagementScore - left.engagementScore;
            }
            if (right.authorSuggestionPrior !== left.authorSuggestionPrior) {
                return right.authorSuggestionPrior - left.authorSuggestionPrior;
            }
            return right.recentPosts - left.recentPosts;
        })
        .slice(0, limit);
}
