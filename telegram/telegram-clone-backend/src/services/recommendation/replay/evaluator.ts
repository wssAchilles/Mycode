import type {
    ReplayCandidateSetKindSummary,
    ReplayBucketSummary,
    ReplayCandidateSnapshot,
    ReplayEvaluationSummary,
    ReplayRankingCandidate,
    ReplayRankingMetrics,
    ReplayRequestDelta,
    ReplayRequestSnapshot,
    ReplayVariantName,
} from './contracts';
import { rerankReplayCandidates } from './variantScorer';

type RankingSummary = {
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

export function evaluateReplayRequests(
    requests: ReplayRequestSnapshot[],
    topK: number,
    variant: ReplayVariantName,
): ReplayEvaluationSummary {
    const requestCount = requests.length;
    const candidateCount = requests.reduce((sum, request) => sum + request.candidates.length, 0);

    const baselineTotals = createMetricAccumulator();
    const variantTotals = createMetricAccumulator();
    const byUserState: Record<string, BucketAccumulator> = {};
    const byPipeline: Record<string, BucketAccumulator> = {};
    const byCandidateSetKind: Record<string, CandidateSetAccumulator> = {};
    const sourceSelection = new Map<string, { baseline: number; variant: number }>();
    const requestDiffs: ReplayRequestDelta[] = [];
    let overlapAtKSum = 0;
    let baselineSelectedTotal = 0;
    let variantSelectedTotal = 0;
    let engagedRankLiftSum = 0;
    let engagedRankLiftCount = 0;
    let clickedRankLiftSum = 0;
    let clickedRankLiftCount = 0;
    let observedCandidateSum = 0;
    let totalCandidateSum = 0;
    let truncatedRequestCount = 0;

    for (const request of requests) {
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
            }));
        const variantRanking = rerankReplayCandidates(request, variant);

        const baselineSummary = summarizeRanking(baselineRanking, request.candidates, topK);
        const variantSummary = summarizeRanking(variantRanking, request.candidates, topK);
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
        if (request.candidateSetTruncated === true) {
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

        const engagedLift = rankLift(
            request.candidates.filter((candidate) => candidate.labels.engagement),
            baselineRanking,
            variantRanking,
        );
        if (engagedLift.count > 0) {
            engagedRankLiftSum += engagedLift.totalLift / engagedLift.count;
            engagedRankLiftCount += 1;
        }

        const clickedLift = rankLift(
            request.candidates.filter((candidate) => candidate.labels.click),
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

    const baseline = finalizeMetrics(baselineTotals, requestCount);
    const variantMetrics = finalizeMetrics(variantTotals, requestCount);

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
        baseline,
        variantMetrics,
        delta: diffMetrics(variantMetrics, baseline),
        averageOverlapAtK: overlapAtKSum / Math.max(1, requestCount),
        averageEngagedRankLift: engagedRankLiftSum / Math.max(1, engagedRankLiftCount),
        averageClickedRankLift: clickedRankLiftSum / Math.max(1, clickedRankLiftCount),
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

function summarizeRanking(
    ranking: ReplayRankingCandidate[],
    allCandidates: ReplayCandidateSnapshot[],
    topK: number,
): RankingSummary {
    const rows = ranking.slice(0, topK);
    const uniqueAuthors = new Set(rows.map((candidate) => candidate.authorId).filter(Boolean));
    const sourceCounts = rows.reduce<Record<string, number>>((acc, candidate) => {
        acc[candidate.recallSource] = (acc[candidate.recallSource] || 0) + 1;
        return acc;
    }, {});
    const totalRelevant = allCandidates.filter((candidate) => candidate.labels.engagement).length;
    const engagedRanks = rows
        .filter((candidate) => candidate.labels.engagement)
        .map((candidate) => candidate.replayRank);
    const clickedRanks = rows
        .filter((candidate) => candidate.labels.click)
        .map((candidate) => candidate.replayRank);

    return {
        clickHit: rows.some((candidate) => candidate.labels.click) ? 1 : 0,
        engagementHit: rows.some((candidate) => candidate.labels.engagement) ? 1 : 0,
        negativeHit: rows.some((candidate) => candidate.labels.negative) ? 1 : 0,
        authorDiversity: uniqueAuthors.size / Math.max(1, rows.length),
        oonRatio: rows.filter((candidate) => candidate.inNetwork === false).length / Math.max(1, rows.length),
        ndcgAtK: ndcgAtK(rows, allCandidates, topK),
        mrrAtK: mrrAtK(rows),
        recallAtK: totalRelevant > 0
            ? rows.filter((candidate) => candidate.labels.engagement).length / totalRelevant
            : 0,
        negativeRateAtK: rows.filter((candidate) => candidate.labels.negative).length / Math.max(1, rows.length),
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
    if (candidate.labels.engagement) return 1;
    if (candidate.labels.click) return 0.35;
    return 0;
}

function mrrAtK(rows: ReplayCandidateSnapshot[]): number {
    const firstRelevantIndex = rows.findIndex((row) => row.labels.engagement);
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

function createMetricAccumulator(): MetricAccumulator {
    return {
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
    target.clickHit += summary.clickHit;
    target.engagementHit += summary.engagementHit;
    target.negativeHit += summary.negativeHit;
    target.authorDiversity += summary.authorDiversity;
    target.oonRatio += summary.oonRatio;
    target.ndcgAtK += summary.ndcgAtK;
    target.mrrAtK += summary.mrrAtK;
    target.recallAtK += summary.recallAtK;
    target.negativeRateAtK += summary.negativeRateAtK;
}

function finalizeMetrics(
    totals: MetricAccumulator,
    requests: number,
): ReplayRankingMetrics {
    return {
        clickHitRateAtK: totals.clickHit / Math.max(1, requests),
        engagementHitRateAtK: totals.engagementHit / Math.max(1, requests),
        negativeHitRateAtK: totals.negativeHit / Math.max(1, requests),
        averageAuthorDiversityAtK: totals.authorDiversity / Math.max(1, requests),
        averageOonRatioAtK: totals.oonRatio / Math.max(1, requests),
        averageNdcgAtK: totals.ndcgAtK / Math.max(1, requests),
        averageMrrAtK: totals.mrrAtK / Math.max(1, requests),
        averageRecallAtK: totals.recallAtK / Math.max(1, requests),
        averageNegativeRateAtK: totals.negativeRateAtK / Math.max(1, requests),
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
                const baseline = finalizeMetrics(bucket.baseline, bucket.requests);
                const variant = finalizeMetrics(bucket.variant, bucket.requests);
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
