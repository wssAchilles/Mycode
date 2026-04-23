import type {
    ReplayCandidateSnapshot,
    ReplayRankingCandidate,
    ReplayRequestSnapshot,
    ReplayVariantName,
} from './contracts';

const SOURCE_PRIORS: Record<string, number> = {
    FollowingSource: 0.16,
    GraphSource: 0.12,
    GraphKernelSource: 0.12,
    EmbeddingAuthorSource: 0.11,
    TwoTowerSource: 0.09,
    NewsAnnSource: 0.05,
    ColdStartSource: 0.03,
    PopularSource: -0.02,
};

export function rerankReplayCandidates(
    request: ReplayRequestSnapshot,
    variant: ReplayVariantName,
): ReplayRankingCandidate[] {
    const ranked = request.candidates
        .slice()
        .map((candidate) => ({
            ...candidate,
            replayScore: scoreReplayCandidate(request, candidate, variant),
            replayRank: 0,
        }))
        .sort((left, right) =>
            right.replayScore - left.replayScore
            || left.baselineRank - right.baselineRank
            || left.postId.localeCompare(right.postId),
        );

    return ranked.map((candidate, index) => ({
        ...candidate,
        replayRank: index + 1,
    }));
}

export function scoreReplayCandidate(
    request: ReplayRequestSnapshot,
    candidate: ReplayCandidateSnapshot,
    variant: ReplayVariantName,
): number {
    switch (variant) {
        case 'baseline_rank_v1':
            return -candidate.baselineRank;
        case 'trace_final_score_v1':
            return finite(candidate.score)
                ?? finite(candidate.weightedScore)
                ?? finite(candidate.pipelineScore)
                ?? -candidate.baselineRank;
        case 'trace_weighted_score_v1':
            return finite(candidate.weightedScore)
                ?? finite(candidate.score)
                ?? finite(candidate.pipelineScore)
                ?? -candidate.baselineRank;
        case 'hybrid_signal_blend_v1':
            return hybridSignalBlendScore(request, candidate);
        default:
            return -candidate.baselineRank;
    }
}

function hybridSignalBlendScore(
    request: ReplayRequestSnapshot,
    candidate: ReplayCandidateSnapshot,
): number {
    const baseScore = finite(candidate.score) ?? 0;
    const weightedScore = finite(candidate.weightedScore) ?? baseScore;
    const pipelineScore = finite(candidate.pipelineScore) ?? weightedScore;
    const sourcePrior = SOURCE_PRIORS[candidate.recallSource] ?? 0;
    const embeddingScore = signal(candidate, 'retrievalEmbeddingScore');
    const authorClusterScore = signal(candidate, 'retrievalAuthorClusterScore');
    const candidateClusterScore = signal(candidate, 'retrievalCandidateClusterScore');
    const denseVectorScore = signal(candidate, 'retrievalDenseVectorScore');
    const keywordScore = signal(candidate, 'retrievalKeywordScore');
    const engagementPrior = signal(candidate, 'retrievalEngagementPrior');
    const affinityScore =
        signal(candidate, 'authorAffinityScore')
        || signal(candidate, 'authorAffinity')
        || signal(candidate, 'affinityBoost');
    const calibrationSource = signal(candidate, 'calibrationSourceMultiplier');
    const calibrationEmbeddingQuality = signal(candidate, 'calibrationEmbeddingQualityMultiplier');
    const diversityMultiplier = signal(candidate, 'diversityMultiplier');
    const oonFactor = signal(candidate, 'oonFactor');
    const recencyBoost = freshnessBoost(candidate.createdAt);
    const embeddingQualityBoost = clamp01(request.embeddingQualityScore) * 0.04;

    let replayScore =
        baseScore * 0.42 +
        weightedScore * 0.24 +
        pipelineScore * 0.12 +
        sourcePrior +
        embeddingScore * 0.08 +
        authorClusterScore * 0.08 +
        candidateClusterScore * 0.06 +
        denseVectorScore * 0.05 +
        keywordScore * 0.04 +
        engagementPrior * 0.05 +
        affinityScore * 0.07 +
        recencyBoost +
        embeddingQualityBoost;

    if (candidate.inNetwork) {
        replayScore += 0.03;
    }
    if (candidate.evidence?.includes('graph_match')) {
        replayScore += 0.03;
    }
    if (candidate.evidence?.includes('author_affinity')) {
        replayScore += 0.02;
    }
    if (candidate.evidence?.includes('popular_fallback')) {
        replayScore -= 0.04;
    }
    if (candidate.evidence?.includes('diversity_adjusted')) {
        replayScore -= 0.01;
    }
    if (calibrationSource > 0) {
        replayScore += (calibrationSource - 1) * 0.06;
    }
    if (calibrationEmbeddingQuality > 0) {
        replayScore += (calibrationEmbeddingQuality - 1) * 0.05;
    }
    if (diversityMultiplier > 0 && diversityMultiplier < 1) {
        replayScore += (diversityMultiplier - 1) * 0.08;
    }
    if (!candidate.inNetwork && oonFactor > 0) {
        replayScore += oonFactor * 0.03;
    }

    return replayScore;
}

function signal(candidate: ReplayCandidateSnapshot, key: string): number {
    const explainSignal = finite(candidate.explainSignals?.[key]);
    if (typeof explainSignal === 'number') return explainSignal;
    return finite(candidate.scoreBreakdown?.[key]) ?? 0;
}

function freshnessBoost(createdAt?: string): number {
    if (!createdAt) return 0;
    const ageMs = Date.now() - Date.parse(createdAt);
    if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
    const ageHours = ageMs / (60 * 60 * 1000);
    if (ageHours <= 6) return 0.05;
    if (ageHours <= 24) return 0.035;
    if (ageHours <= 72) return 0.02;
    return 0;
}

function finite(value: number | null | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

