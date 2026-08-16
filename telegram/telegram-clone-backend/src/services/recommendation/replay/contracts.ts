import type { OutcomeContractV1 } from '../outcomes/outcomeContractV1';

export type ReplayVariantName =
    | 'baseline_rank_v1'
    | 'trace_final_score_v1'
    | 'trace_weighted_score_v1'
    | 'hybrid_signal_blend_v1'
    | 'industrial_guardrail_blend_v1';

export interface ReplayCandidateLabelSummary {
    click: boolean;
    like: boolean;
    reply: boolean;
    repost: boolean;
    quote: boolean;
    share: boolean;
    dismiss: boolean;
    blockAuthor: boolean;
    report: boolean;
    engagement: boolean;
    negative: boolean;
    dwellTimeMs: number;
}

export interface ReplayCandidateSnapshot {
    requestId?: string;
    postId: string;
    modelPostId?: string;
    authorId: string;
    rank?: number;
    baselineRank: number;
    recallSource: string;
    secondaryRecallSources?: string[];
    selectionPool?: string;
    selectionReason?: string;
    experimentKeys?: string[];
    productSurface?: string;
    feedbackLabel?: 'positive' | 'negative' | null;
    inNetwork: boolean;
    isNews: boolean;
    score?: number | null;
    weightedScore?: number | null;
    pipelineScore?: number | null;
    scoreBreakdown?: Record<string, number>;
    recommendationDetail?: string;
    sourceReason?: string;
    evidence?: string[];
    explainSignals?: Record<string, number>;
    createdAt?: string;
    outcomeContractV1?: OutcomeContractV1;
    labels?: ReplayCandidateLabelSummary;
}

export interface ReplayRequestSnapshot {
    requestId: string;
    decisionId?: string;
    userId: string;
    requestAt: string;
    productSurface: string;
    pipeline?: string;
    pipelineVersion?: string;
    strategyVersion?: string;
    selectedFingerprint?: string;
    replayPoolFingerprint?: string;
    traceVersion?: string;
    owner?: string;
    fallbackMode?: string;
    degradedReasons: string[];
    selectedCount: number;
    inNetworkCount: number;
    outOfNetworkCount: number;
    sourceCounts: Array<{ source: string; count: number }>;
    authorDiversity: number;
    replyRatio: number;
    averageScore: number;
    topScore?: number | null;
    bottomScore?: number | null;
    experimentKeys: string[];
    userState?: string;
    embeddingQualityScore?: number | null;
    candidateSetKind?: string;
    candidateSetTotalCount?: number;
    candidateSetTruncated?: boolean;
    candidateSetCompleteness?: 'complete_v1' | 'unverified_v1';
    shadowComparison?: {
        overlapCount: number;
        overlapRatio: number;
        selectedCount: number;
        baselineCount: number;
    };
    candidates: ReplayCandidateSnapshot[];
}

export interface ReplayRankingCandidate extends ReplayCandidateSnapshot {
    replayScore: number;
    replayRank: number;
}

export type ReplayMetricEligibilityStatus = 'complete' | 'partial' | 'not_evaluable';

export type ReplayMetricEligibilityReason =
    | 'missing_feedback'
    | 'candidate_set_truncated'
    | 'candidate_set_completeness_unverified';

export interface ReplayMetricEligibilitySummary {
    contractVersion: 'replay_metric_eligibility_v1';
    status: ReplayMetricEligibilityStatus;
    reasons: ReplayMetricEligibilityReason[];
    eligibleRequestDenominator: number;
    eligibleCandidateDenominator: number;
    observedRequestDenominator: number;
    observedCandidateDenominator: number;
    excludedRequestCount: number;
    excludedObservedCandidateCount: number;
    observedCandidateSetOnly: boolean;
}

export interface ReplayRankingMetrics {
    clickHitRateAtK: number;
    engagementHitRateAtK: number;
    negativeHitRateAtK: number;
    averageAuthorDiversityAtK: number;
    averageOonRatioAtK: number;
    averageNdcgAtK: number;
    averageMrrAtK: number;
    averageRecallAtK: number;
    averageNegativeRateAtK: number;
    metricEligibility: ReplayMetricEligibilitySummary;
}

export interface ReplayBucketSummary {
    requests: number;
    baseline: ReplayRankingMetrics;
    variant: ReplayRankingMetrics;
    delta: ReplayRankingMetrics;
}

export interface ReplayRequestDelta {
    requestId: string;
    userState?: string;
    pipeline?: string;
    baselineNdcgAtK: number;
    variantNdcgAtK: number;
    deltaNdcgAtK: number;
    baselineRecallAtK: number;
    variantRecallAtK: number;
}

export interface ReplayCandidateSetSummary {
    averageObservedCandidates: number;
    averageTotalCandidates: number;
    truncationRate: number;
}

export interface ReplayAttributionCoverageSummary {
    candidatesWithRankRate: number;
    candidatesWithFeedbackRate: number;
    attributedFeedbackRate: number;
}

export interface LoggingReadinessSummary {
    totalRequests: number;
    requestsMissingRank: number;
    requestsMissingRecallSource: number;
    requestsMissingScore: number;
    requestsMissingExperimentKeys: number;
    requestsMissingFeedbackJoinKey: number;
}

export interface ReplayCandidateSetKindSummary {
    requests: number;
    averageObservedCandidates: number;
    averageTotalCandidates: number;
    truncationRate: number;
}

export interface ReplayEvaluationSummary {
    requests: number;
    candidates: number;
    topK: number;
    variant: ReplayVariantName;
    candidateSet: ReplayCandidateSetSummary;
    attributionCoverage: ReplayAttributionCoverageSummary;
    loggingReadiness: LoggingReadinessSummary;
    baseline: ReplayRankingMetrics;
    variantMetrics: ReplayRankingMetrics;
    delta: ReplayRankingMetrics;
    averageOverlapAtK: number;
    averageEngagedRankLift: number;
    averageClickedRankLift: number;
    eligibleRankLiftRequestDenominator: number;
    engagedRankLiftRequestDenominator: number;
    clickedRankLiftRequestDenominator: number;
    byUserState: Record<string, ReplayBucketSummary>;
    byPipeline: Record<string, ReplayBucketSummary>;
    byCandidateSetKind: Record<string, ReplayCandidateSetKindSummary>;
    bySelectedSource: Record<string, {
        baselineShareAtK: number;
        variantShareAtK: number;
        deltaShareAtK: number;
    }>;
    requestDiffLeaders: {
        improved: ReplayRequestDelta[];
        regressed: ReplayRequestDelta[];
    };
}
