import type {
    ReplayCandidateSetKindSummary,
    ReplayBucketSummary,
    ReplayCandidateSnapshot,
    ReplayEvaluationSummary,
    LoggingReadinessSummary,
    ReplayMetricEligibilitySummary,
    ReplayRankingCandidate,
    ReplayRankingMetrics,
    ReplayRequestDelta,
    ReplayRequestSnapshot,
    ReplayScoreProvenance,
    ReplayScoreProvenanceSummary,
    ReplayVariantName,
} from './contracts';
import { REPLAY_SCORE_PROVENANCE_NAMES } from './contracts';
import { hasNativeReplayScore, rerankReplayCandidates } from './variantScorer';

type RankingSummary = {
    hasCompleteAttribution: boolean;
    candidateSetComplete: boolean;
    candidateSetReason: ReplayMetricEligibilitySummary['reasons'][number] | null;
    scoreProvenanceComplete: boolean;
    strictMetricsEligible: boolean;
    candidateCount: number;
    clickHit: number;
    engagementHit: number;
    negativeHit: number;
    authorDiversity: number;
    oonRatio: number;
    ndcgAtK: number;
    mrrAtK: number;
    recallAtK: number;
    negativeRateAtK: number;
    sourceCounts: Record<string, number>;
    engagedAverageRank: number | null;
    clickedAverageRank: number | null;
};

type BucketAccumulator = {
    requests: number;
    baseline: MetricAccumulator;
    variant: MetricAccumulator;
};

type MetricAccumulator = {
    requests: number;
    candidates: number;
    feedbackRequests: number;
    feedbackCandidates: number;
    missingFeedbackRequests: number;
    missingFeedbackCandidates: number;
    scoreProvenanceUnavailableRequests: number;
    truncatedRequests: number;
    truncatedCandidates: number;
    candidateSetReasons: Set<ReplayMetricEligibilitySummary['reasons'][number]>;
    clickHit: number;
    engagementHit: number;
    negativeHit: number;
    authorDiversity: number;
    oonRatio: number;
    ndcgAtK: number;
    mrrAtK: number;
    recallAtK: number;
    negativeRateAtK: number;
};

type CandidateSetAccumulator = {
    requests: number;
    observedCandidates: number;
    totalCandidates: number;
    truncatedRequests: number;
};

type CandidateSetAssessment = {
    complete: boolean;
    reason: ReplayMetricEligibilitySummary['reasons'][number] | null;
};

type ScoreProvenanceAccumulator = {
    variant: ReplayVariantName;
    requests: number;
    candidates: number;
    requestsWithFallback: number;
    requestsMissingNativeScore: number;
    scoreSourceCounts: Record<ReplayScoreProvenance, number>;
};

export function evaluateReplayRequests(
    requests: ReplayRequestSnapshot[],
    topK: number,
    variant: ReplayVariantName,
): ReplayEvaluationSummary {
    const requestCount = requests.length;
    const candidateCount = requests.reduce((sum, request) => sum + request.candidates.length, 0);

    const baselineTotals = createMetricAccumulator();
    const variantTotals = createMetricAccumulator();
    const scoreProvenance = createScoreProvenanceAccumulator(variant);
    const byUserState = Object.create(null) as Record<string, BucketAccumulator>;
    const byPipeline = Object.create(null) as Record<string, BucketAccumulator>;
    const byCandidateSetKind = Object.create(null) as Record<string, CandidateSetAccumulator>;
    const sourceSelection = new Map<string, { baseline: number; variant: number }>();
    const requestDiffs: ReplayRequestDelta[] = [];
    let overlapAtKSum = 0;
    let baselineSelectedTotal = 0;
    let variantSelectedTotal = 0;
    let engagedRankLiftSum = 0;
    let engagedRankLiftCount = 0;
    let clickedRankLiftSum = 0;
    let clickedRankLiftCount = 0;
    let eligibleRankLiftRequestCount = 0;
    let observedCandidateSum = 0;
    let totalCandidateSum = 0;
    let truncatedRequestCount = 0;
    let candidatesWithRank = 0;
    let candidatesWithFeedback = 0;
    let attributedFeedbackCandidates = 0;
    const loggingReadiness = createLoggingReadinessSummary(requestCount);

    for (const request of requests) {
        addLoggingReadinessRequest(loggingReadiness, request);
        for (const candidate of request.candidates) {
            const hasRank = typeof candidate.rank === 'number' || Number.isFinite(candidate.baselineRank);
            const hasFeedback = candidateHasFeedback(candidate);
            if (hasRank) candidatesWithRank += 1;
            if (hasFeedback) candidatesWithFeedback += 1;
            if (request.requestId && candidate.postId && hasRank && hasFeedback) {
                attributedFeedbackCandidates += 1;
            }
        }

        const baselineRanking = request.candidates
            .slice()
            .sort((left, right) =>
                left.baselineRank - right.baselineRank
                || left.postId.localeCompare(right.postId),
            )
            .map((candidate, index) => ({
                ...candidate,
                replayScore: -candidate.baselineRank,
                replayRank: index + 1,
                replayScoreProvenance: 'baseline_rank_v1' as const,
            }));
        const variantRanking = rerankReplayCandidates(request, variant);
        const scoreProvenanceComplete = request.candidates.every((candidate) => (
            hasNativeReplayScore(candidate, variant)
        ));
        addScoreProvenance(scoreProvenance, variantRanking, scoreProvenanceComplete);

        const candidateSetAssessment = assessCandidateSet(request);
        const baselineSummary = summarizeRanking(
            baselineRanking,
            request.candidates,
            topK,
            candidateSetAssessment,
            true,
        );
        const variantSummary = summarizeRanking(
            variantRanking,
            request.candidates,
            topK,
            candidateSetAssessment,
            scoreProvenanceComplete,
        );
        baselineSelectedTotal += Math.min(topK, baselineRanking.length);
        variantSelectedTotal += Math.min(topK, variantRanking.length);

        addRankingSummary(baselineTotals, baselineSummary);
        addRankingSummary(variantTotals, variantSummary);

        const userStateKey = request.userState || '__unknown__';
        const pipelineKey = request.pipelineVersion || request.pipeline || '__unknown__';
        const candidateSetKind = request.candidateSetKind || '__unknown__';
        addBucketSummary(byUserState, userStateKey, baselineSummary, variantSummary);
        addBucketSummary(byPipeline, pipelineKey, baselineSummary, variantSummary);
        addCandidateSetSummary(byCandidateSetKind, candidateSetKind, request);

        observedCandidateSum += request.candidates.length;
        totalCandidateSum += request.candidateSetTotalCount ?? request.candidates.length;
        if (candidateSetAssessment.reason === 'candidate_set_truncated') {
            truncatedRequestCount += 1;
        }

        for (const [source, count] of Object.entries(baselineSummary.sourceCounts)) {
            const entry = sourceSelection.get(source) || { baseline: 0, variant: 0 };
            entry.baseline += count;
            sourceSelection.set(source, entry);
        }
        for (const [source, count] of Object.entries(variantSummary.sourceCounts)) {
            const entry = sourceSelection.get(source) || { baseline: 0, variant: 0 };
            entry.variant += count;
            sourceSelection.set(source, entry);
        }

        overlapAtKSum += overlapAtK(baselineRanking, variantRanking, topK);

        if (baselineSummary.strictMetricsEligible && variantSummary.strictMetricsEligible) {
            eligibleRankLiftRequestCount += 1;
            const engagedLift = rankLift(
                request.candidates.filter((candidate) => attributedLabels(candidate)?.engagement),
                baselineRanking,
                variantRanking,
            );
            if (engagedLift.count > 0) {
                engagedRankLiftSum += engagedLift.totalLift / engagedLift.count;
                engagedRankLiftCount += 1;
            }

            const clickedLift = rankLift(
                request.candidates.filter((candidate) => attributedLabels(candidate)?.click),
                baselineRanking,
                variantRanking,
            );
            if (clickedLift.count > 0) {
                clickedRankLiftSum += clickedLift.totalLift / clickedLift.count;
                clickedRankLiftCount += 1;
            }

            requestDiffs.push({
                requestId: request.requestId,
                userState: request.userState,
                pipeline: pipelineKey,
                baselineNdcgAtK: baselineSummary.ndcgAtK,
                variantNdcgAtK: variantSummary.ndcgAtK,
                deltaNdcgAtK: variantSummary.ndcgAtK - baselineSummary.ndcgAtK,
                baselineRecallAtK: baselineSummary.recallAtK,
                variantRecallAtK: variantSummary.recallAtK,
            });
        }
    }

    const baseline = finalizeMetrics(baselineTotals);
    const variantMetrics = finalizeMetrics(variantTotals);

    const bySelectedSource = Object.fromEntries(
        Array.from(sourceSelection.entries())
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([source, counts]) => [
                source,
                {
                    baselineShareAtK: counts.baseline / Math.max(1, baselineSelectedTotal),
                    variantShareAtK: counts.variant / Math.max(1, variantSelectedTotal),
                    deltaShareAtK:
                        (counts.variant / Math.max(1, variantSelectedTotal))
                        - (counts.baseline / Math.max(1, baselineSelectedTotal)),
                },
            ]),
    );

    const sortedDiffs = requestDiffs
        .slice()
        .sort((left, right) =>
            right.deltaNdcgAtK - left.deltaNdcgAtK
            || right.variantRecallAtK - left.variantRecallAtK
            || left.requestId.localeCompare(right.requestId),
        );

    return {
        requests: requestCount,
        candidates: candidateCount,
        topK,
        variant,
        candidateSet: {
            averageObservedCandidates: observedCandidateSum / Math.max(1, requestCount),
            averageTotalCandidates: totalCandidateSum / Math.max(1, requestCount),
            truncationRate: truncatedRequestCount / Math.max(1, requestCount),
        },
        attributionCoverage: {
            candidatesWithRankRate: candidatesWithRank / Math.max(1, candidateCount),
            candidatesWithFeedbackRate: candidatesWithFeedback / Math.max(1, candidateCount),
            attributedFeedbackRate: attributedFeedbackCandidates / Math.max(1, candidatesWithFeedback),
        },
        loggingReadiness,
        scoreProvenance: finalizeScoreProvenance(scoreProvenance),
        baseline,
        variantMetrics,
        delta: diffMetrics(variantMetrics, baseline),
        averageOverlapAtK: overlapAtKSum / Math.max(1, requestCount),
        averageEngagedRankLift: engagedRankLiftSum / Math.max(1, engagedRankLiftCount),
        averageClickedRankLift: clickedRankLiftSum / Math.max(1, clickedRankLiftCount),
        eligibleRankLiftRequestDenominator: eligibleRankLiftRequestCount,
        engagedRankLiftRequestDenominator: engagedRankLiftCount,
        clickedRankLiftRequestDenominator: clickedRankLiftCount,
        byUserState: finalizeBuckets(byUserState),
        byPipeline: finalizeBuckets(byPipeline),
        byCandidateSetKind: finalizeCandidateSetBuckets(byCandidateSetKind),
        bySelectedSource,
        requestDiffLeaders: {
            improved: sortedDiffs.filter((request) => request.deltaNdcgAtK > 0).slice(0, 5),
            regressed: sortedDiffs
                .filter((request) => request.deltaNdcgAtK < 0)
                .slice()
                .reverse()
                .slice(0, 5),
        },
    };
}

function createLoggingReadinessSummary(totalRequests: number): LoggingReadinessSummary {
    return {
        totalRequests,
        requestsMissingRank: 0,
        requestsMissingRecallSource: 0,
        requestsMissingScore: 0,
        requestsMissingExperimentKeys: 0,
        requestsMissingFeedbackJoinKey: 0,
    };
}

function addLoggingReadinessRequest(
    summary: LoggingReadinessSummary,
    request: ReplayRequestSnapshot,
): void {
    if (request.candidates.some((candidate) => !hasReplayRank(candidate))) {
        summary.requestsMissingRank += 1;
    }
    if (request.candidates.some((candidate) => !String(candidate.recallSource || '').trim())) {
        summary.requestsMissingRecallSource += 1;
    }
    if (request.candidates.some((candidate) => !hasReplayScore(candidate))) {
        summary.requestsMissingScore += 1;
    }
    if (!Array.isArray(request.experimentKeys) || request.experimentKeys.filter(Boolean).length === 0) {
        summary.requestsMissingExperimentKeys += 1;
    }
    if (!String(request.requestId || '').trim() || request.candidates.some((candidate) => !hasFeedbackJoinKey(candidate))) {
        summary.requestsMissingFeedbackJoinKey += 1;
    }
}

function hasReplayRank(candidate: ReplayCandidateSnapshot): boolean {
    return Number.isFinite(candidate.rank) || Number.isFinite(candidate.baselineRank);
}

function hasReplayScore(candidate: ReplayCandidateSnapshot): boolean {
    return Number.isFinite(candidate.score)
        || Number.isFinite(candidate.weightedScore)
        || Number.isFinite(candidate.pipelineScore);
}

function hasFeedbackJoinKey(candidate: ReplayCandidateSnapshot): boolean {
    return Boolean(
        String(candidate.postId || '').trim()
        || String(candidate.modelPostId || '').trim(),
    );
}

function attributedLabels(candidate: ReplayCandidateSnapshot) {
    if (!candidate.outcomeContractV1) return candidate.labels;
    return candidate.outcomeContractV1.status === 'observed'
        ? candidate.outcomeContractV1.labels
        : undefined;
}

function candidateHasFeedback(candidate: ReplayCandidateSnapshot): boolean {
    const labels = attributedLabels(candidate);
    return Boolean(labels && (
        labels.click
        || labels.like
        || labels.reply
        || labels.repost
        || labels.quote
        || labels.share
        || labels.dismiss
        || labels.blockAuthor
        || labels.report
        || labels.dwellTimeMs > 0
    ));
}

function assessCandidateSet(request: ReplayRequestSnapshot): CandidateSetAssessment {
    if (request.candidateSetCompleteness !== 'complete_v1') {
        return {
            complete: false,
            reason: 'candidate_set_completeness_unverified',
        };
    }
    if (request.candidateSetTruncated === true) {
        return {
            complete: false,
            reason: 'candidate_set_truncated',
        };
    }
    const totalCount = request.candidateSetTotalCount;
    if (
        typeof totalCount !== 'number'
        || !Number.isInteger(totalCount)
        || totalCount < 0
        || totalCount !== request.candidates.length
    ) {
        return {
            complete: false,
            reason: 'candidate_set_truncated',
        };
    }
    return { complete: true, reason: null };
}

function summarizeRanking(
    ranking: ReplayRankingCandidate[],
    allCandidates: ReplayCandidateSnapshot[],
    topK: number,
    candidateSetAssessment: CandidateSetAssessment,
    scoreProvenanceComplete: boolean,
): RankingSummary {
    const rows = ranking.slice(0, topK);
    const hasCompleteAttribution = allCandidates.length > 0
        && allCandidates.every((candidate) => attributedLabels(candidate) !== undefined);
    const strictMetricsEligible = hasCompleteAttribution
        && candidateSetAssessment.complete
        && scoreProvenanceComplete;
    const feedbackCandidates = strictMetricsEligible ? allCandidates : [];
    const feedbackRows = strictMetricsEligible ? rows : [];
    const uniqueAuthors = new Set(rows.map((candidate) => candidate.authorId).filter(Boolean));
    const sourceCounts = rows.reduce<Record<string, number>>((acc, candidate) => {
        acc[candidate.recallSource] = (acc[candidate.recallSource] || 0) + 1;
        return acc;
    }, Object.create(null) as Record<string, number>);
    const totalRelevant = feedbackCandidates.filter((candidate) => (
        attributedLabels(candidate)?.engagement
    )).length;
    const engagedRanks = feedbackRows
        .filter((candidate) => attributedLabels(candidate)?.engagement)
        .map((candidate) => candidate.replayRank);
    const clickedRanks = feedbackRows
        .filter((candidate) => attributedLabels(candidate)?.click)
        .map((candidate) => candidate.replayRank);

    return {
        hasCompleteAttribution,
        candidateSetComplete: candidateSetAssessment.complete,
        candidateSetReason: candidateSetAssessment.reason,
        scoreProvenanceComplete,
        strictMetricsEligible,
        candidateCount: allCandidates.length,
        clickHit: feedbackRows.some((candidate) => attributedLabels(candidate)?.click) ? 1 : 0,
        engagementHit: feedbackRows.some((candidate) => attributedLabels(candidate)?.engagement) ? 1 : 0,
        negativeHit: feedbackRows.some((candidate) => attributedLabels(candidate)?.negative) ? 1 : 0,
        authorDiversity: uniqueAuthors.size / Math.max(1, rows.length),
        oonRatio: rows.filter((candidate) => candidate.inNetwork === false).length / Math.max(1, rows.length),
        ndcgAtK: ndcgAtK(feedbackRows, feedbackCandidates, topK),
        mrrAtK: mrrAtK(feedbackRows),
        recallAtK: totalRelevant > 0
            ? feedbackRows.filter((candidate) => attributedLabels(candidate)?.engagement).length / totalRelevant
            : 0,
        negativeRateAtK: feedbackRows.filter((candidate) => (
            attributedLabels(candidate)?.negative
        )).length / Math.max(1, feedbackRows.length),
        sourceCounts,
        engagedAverageRank: averageRank(engagedRanks),
        clickedAverageRank: averageRank(clickedRanks),
    };
}

function ndcgAtK(
    rows: ReplayCandidateSnapshot[],
    allCandidates: ReplayCandidateSnapshot[],
    topK: number,
): number {
    const dcg = discountedGain(rows.slice(0, topK));
    const idealRows = allCandidates
        .slice()
        .sort((left, right) =>
            relevance(right) - relevance(left)
            || left.baselineRank - right.baselineRank,
        )
        .slice(0, topK);
    const idcg = discountedGain(idealRows);
    return idcg > 0 ? dcg / idcg : 0;
}

function discountedGain(rows: ReplayCandidateSnapshot[]): number {
    return rows.reduce((sum, row, index) => sum + (relevance(row) / Math.log2(index + 2)), 0);
}

function relevance(candidate: ReplayCandidateSnapshot): number {
    const labels = attributedLabels(candidate);
    if (labels?.engagement) return 1;
    if (labels?.click) return 0.35;
    return 0;
}

function mrrAtK(rows: ReplayCandidateSnapshot[]): number {
    const firstRelevantIndex = rows.findIndex((row) => attributedLabels(row)?.engagement);
    return firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0;
}

function averageRank(ranks: number[]): number | null {
    if (ranks.length === 0) return null;
    return ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
}

function overlapAtK(
    baseline: ReplayRankingCandidate[],
    variant: ReplayRankingCandidate[],
    topK: number,
): number {
    const baselineKeys = new Set(baseline.slice(0, topK).map((candidate) => candidate.postId));
    const variantKeys = new Set(variant.slice(0, topK).map((candidate) => candidate.postId));
    let overlap = 0;
    for (const key of baselineKeys) {
        if (variantKeys.has(key)) overlap += 1;
    }
    return overlap / Math.max(1, Math.min(baselineKeys.size, variantKeys.size));
}

function rankLift(
    targets: ReplayCandidateSnapshot[],
    baseline: ReplayRankingCandidate[],
    variant: ReplayRankingCandidate[],
): { totalLift: number; count: number } {
    const baselineRanks = new Map(baseline.map((candidate) => [candidate.postId, candidate.replayRank]));
    const variantRanks = new Map(variant.map((candidate) => [candidate.postId, candidate.replayRank]));
    let totalLift = 0;
    let count = 0;

    for (const target of targets) {
        const baselineRank = baselineRanks.get(target.postId);
        const variantRank = variantRanks.get(target.postId);
        if (!baselineRank || !variantRank) continue;
        totalLift += baselineRank - variantRank;
        count += 1;
    }

    return { totalLift, count };
}

function createScoreProvenanceAccumulator(variant: ReplayVariantName): ScoreProvenanceAccumulator {
    return {
        variant,
        requests: 0,
        candidates: 0,
        requestsWithFallback: 0,
        requestsMissingNativeScore: 0,
        scoreSourceCounts: Object.fromEntries(
            REPLAY_SCORE_PROVENANCE_NAMES.map((name) => [name, 0]),
        ) as Record<ReplayScoreProvenance, number>,
    };
}

function addScoreProvenance(
    target: ScoreProvenanceAccumulator,
    ranking: ReplayRankingCandidate[],
    nativeScoreComplete: boolean,
): void {
    target.requests += 1;
    target.candidates += ranking.length;
    if (!nativeScoreComplete) target.requestsMissingNativeScore += 1;
    let requestHasFallback = false;
    for (const candidate of ranking) {
        target.scoreSourceCounts[candidate.replayScoreProvenance] += 1;
        if (candidate.replayScoreProvenance.startsWith('fallback_')) {
            requestHasFallback = true;
        }
    }
    if (requestHasFallback) target.requestsWithFallback += 1;
}

function finalizeScoreProvenance(
    totals: ScoreProvenanceAccumulator,
): ReplayScoreProvenanceSummary {
    return {
        contractVersion: 'replay_score_provenance_v1',
        variant: totals.variant,
        requests: totals.requests,
        candidates: totals.candidates,
        requestsWithFallback: totals.requestsWithFallback,
        requestsMissingNativeScore: totals.requestsMissingNativeScore,
        scoreSourceCounts: totals.scoreSourceCounts,
    };
}

function createMetricAccumulator(): MetricAccumulator {
    return {
        requests: 0,
        candidates: 0,
        feedbackRequests: 0,
        feedbackCandidates: 0,
        missingFeedbackRequests: 0,
        missingFeedbackCandidates: 0,
        scoreProvenanceUnavailableRequests: 0,
        truncatedRequests: 0,
        truncatedCandidates: 0,
        candidateSetReasons: new Set(),
        clickHit: 0,
        engagementHit: 0,
        negativeHit: 0,
        authorDiversity: 0,
        oonRatio: 0,
        ndcgAtK: 0,
        mrrAtK: 0,
        recallAtK: 0,
        negativeRateAtK: 0,
    };
}

function addRankingSummary(target: MetricAccumulator, summary: RankingSummary): void {
    target.requests += 1;
    target.candidates += summary.candidateCount;
    target.authorDiversity += summary.authorDiversity;
    target.oonRatio += summary.oonRatio;
    if (!summary.hasCompleteAttribution) {
        target.missingFeedbackRequests += 1;
        target.missingFeedbackCandidates += summary.candidateCount;
    }
    if (!summary.scoreProvenanceComplete) {
        target.scoreProvenanceUnavailableRequests += 1;
    }
    if (!summary.candidateSetComplete) {
        target.truncatedRequests += 1;
        target.truncatedCandidates += summary.candidateCount;
        if (summary.candidateSetReason) target.candidateSetReasons.add(summary.candidateSetReason);
    }
    if (summary.strictMetricsEligible) {
        target.feedbackRequests += 1;
        target.feedbackCandidates += summary.candidateCount;
        target.clickHit += summary.clickHit;
        target.engagementHit += summary.engagementHit;
        target.negativeHit += summary.negativeHit;
        target.ndcgAtK += summary.ndcgAtK;
        target.mrrAtK += summary.mrrAtK;
        target.recallAtK += summary.recallAtK;
        target.negativeRateAtK += summary.negativeRateAtK;
    }
}

function finalizeMetrics(
    totals: MetricAccumulator,
): ReplayRankingMetrics {
    const feedbackRequests = Math.max(1, totals.feedbackRequests);
    return {
        clickHitRateAtK: totals.clickHit / feedbackRequests,
        engagementHitRateAtK: totals.engagementHit / feedbackRequests,
        negativeHitRateAtK: totals.negativeHit / feedbackRequests,
        averageAuthorDiversityAtK: totals.authorDiversity / Math.max(1, totals.requests),
        averageOonRatioAtK: totals.oonRatio / Math.max(1, totals.requests),
        averageNdcgAtK: totals.ndcgAtK / feedbackRequests,
        averageMrrAtK: totals.mrrAtK / feedbackRequests,
        averageRecallAtK: totals.recallAtK / feedbackRequests,
        averageNegativeRateAtK: totals.negativeRateAtK / feedbackRequests,
        metricEligibility: buildMetricEligibility(totals),
    };
}

function buildMetricEligibility(totals: MetricAccumulator): ReplayMetricEligibilitySummary {
    const reasons: ReplayMetricEligibilitySummary['reasons'] = [];
    if (totals.missingFeedbackRequests > 0) reasons.push('missing_feedback');
    for (const reason of [
        'candidate_set_truncated',
        'candidate_set_completeness_unverified',
    ] as const) {
        if (totals.candidateSetReasons.has(reason)) reasons.push(reason);
    }
    if (totals.scoreProvenanceUnavailableRequests > 0) {
        reasons.push('score_provenance_unavailable');
    }
    const eligibleRequestDenominator = totals.feedbackRequests;
    return {
        contractVersion: 'replay_metric_eligibility_v2',
        status: totals.requests === 0 || eligibleRequestDenominator === 0
            ? 'not_evaluable'
            : eligibleRequestDenominator === totals.requests
                ? 'complete'
                : 'partial',
        reasons,
        eligibleRequestDenominator,
        eligibleCandidateDenominator: totals.feedbackCandidates,
        observedRequestDenominator: totals.requests,
        observedCandidateDenominator: totals.candidates,
        excludedRequestCount: totals.requests - eligibleRequestDenominator,
        excludedObservedCandidateCount: totals.candidates - totals.feedbackCandidates,
        observedCandidateSetOnly: totals.truncatedRequests > 0,
    };
}

function diffMetrics(
    left: ReplayRankingMetrics,
    right: ReplayRankingMetrics,
): ReplayRankingMetrics {
    return {
        clickHitRateAtK: left.clickHitRateAtK - right.clickHitRateAtK,
        engagementHitRateAtK: left.engagementHitRateAtK - right.engagementHitRateAtK,
        negativeHitRateAtK: left.negativeHitRateAtK - right.negativeHitRateAtK,
        averageAuthorDiversityAtK: left.averageAuthorDiversityAtK - right.averageAuthorDiversityAtK,
        averageOonRatioAtK: left.averageOonRatioAtK - right.averageOonRatioAtK,
        averageNdcgAtK: left.averageNdcgAtK - right.averageNdcgAtK,
        averageMrrAtK: left.averageMrrAtK - right.averageMrrAtK,
        averageRecallAtK: left.averageRecallAtK - right.averageRecallAtK,
        averageNegativeRateAtK: left.averageNegativeRateAtK - right.averageNegativeRateAtK,
        metricEligibility: mergeMetricEligibility(left.metricEligibility, right.metricEligibility),
    };
}

function mergeMetricEligibility(
    left: ReplayMetricEligibilitySummary,
    right: ReplayMetricEligibilitySummary,
): ReplayMetricEligibilitySummary {
    const reasons: ReplayMetricEligibilitySummary['reasons'] = [];
    for (const reason of [
        'missing_feedback',
        'candidate_set_truncated',
        'candidate_set_completeness_unverified',
        'score_provenance_unavailable',
    ] as const) {
        if (left.reasons.includes(reason) || right.reasons.includes(reason)) reasons.push(reason);
    }
    const eligibleRequestDenominator = Math.min(
        left.eligibleRequestDenominator,
        right.eligibleRequestDenominator,
    );
    const observedRequestDenominator = Math.max(
        left.observedRequestDenominator,
        right.observedRequestDenominator,
    );
    const excludedRequestCount = Math.max(left.excludedRequestCount, right.excludedRequestCount);
    return {
        contractVersion: 'replay_metric_eligibility_v2',
        status: eligibleRequestDenominator === 0
            ? 'not_evaluable'
            : eligibleRequestDenominator === observedRequestDenominator
                ? 'complete'
                : 'partial',
        reasons,
        eligibleRequestDenominator,
        eligibleCandidateDenominator: Math.min(
            left.eligibleCandidateDenominator,
            right.eligibleCandidateDenominator,
        ),
        observedRequestDenominator,
        observedCandidateDenominator: Math.max(
            left.observedCandidateDenominator,
            right.observedCandidateDenominator,
        ),
        excludedRequestCount,
        excludedObservedCandidateCount: Math.max(
            left.excludedObservedCandidateCount,
            right.excludedObservedCandidateCount,
        ),
        observedCandidateSetOnly: left.observedCandidateSetOnly || right.observedCandidateSetOnly,
    };
}

function addBucketSummary(
    target: Record<string, BucketAccumulator>,
    key: string,
    baseline: RankingSummary,
    variant: RankingSummary,
): void {
    const bucket = target[key] || {
        requests: 0,
        baseline: createMetricAccumulator(),
        variant: createMetricAccumulator(),
    };
    bucket.requests += 1;
    addRankingSummary(bucket.baseline, baseline);
    addRankingSummary(bucket.variant, variant);
    target[key] = bucket;
}

function addCandidateSetSummary(
    target: Record<string, CandidateSetAccumulator>,
    key: string,
    request: ReplayRequestSnapshot,
): void {
    const bucket = target[key] || {
        requests: 0,
        observedCandidates: 0,
        totalCandidates: 0,
        truncatedRequests: 0,
    };
    bucket.requests += 1;
    bucket.observedCandidates += request.candidates.length;
    bucket.totalCandidates += request.candidateSetTotalCount ?? request.candidates.length;
    if (request.candidateSetTruncated === true) {
        bucket.truncatedRequests += 1;
    }
    target[key] = bucket;
}

function finalizeBuckets(
    buckets: Record<string, BucketAccumulator>,
): Record<string, ReplayBucketSummary> {
    return Object.fromEntries(
        Object.entries(buckets)
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([key, bucket]) => {
                const baseline = finalizeMetrics(bucket.baseline);
                const variant = finalizeMetrics(bucket.variant);
                return [
                    key,
                    {
                        requests: bucket.requests,
                        baseline,
                        variant,
                        delta: diffMetrics(variant, baseline),
                    },
                ];
            }),
    );
}

function finalizeCandidateSetBuckets(
    buckets: Record<string, CandidateSetAccumulator>,
): Record<string, ReplayCandidateSetKindSummary> {
    return Object.fromEntries(
        Object.entries(buckets)
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([key, bucket]) => [
                key,
                {
                    requests: bucket.requests,
                    averageObservedCandidates: bucket.observedCandidates / Math.max(1, bucket.requests),
                    averageTotalCandidates: bucket.totalCandidates / Math.max(1, bucket.requests),
                    truncationRate: bucket.truncatedRequests / Math.max(1, bucket.requests),
                },
            ]),
    );
}
