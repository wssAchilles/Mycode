import { describe, expect, it } from 'vitest';

import { evaluateReplayRequests } from '../../src/services/recommendation/replay/evaluator';
import type {
    ReplayCandidateLabelSummary,
    ReplayCandidateSnapshot,
    ReplayRequestSnapshot,
} from '../../src/services/recommendation/replay/contracts';

const emptyLabels: ReplayCandidateLabelSummary = {
    click: false,
    like: false,
    reply: false,
    repost: false,
    quote: false,
    share: false,
    dismiss: false,
    blockAuthor: false,
    report: false,
    engagement: false,
    negative: false,
    dwellTimeMs: 0,
};

function candidate(
    index: number,
    labels: ReplayCandidateLabelSummary | undefined = emptyLabels,
): ReplayCandidateSnapshot {
    return {
        postId: `post-${index}`,
        authorId: `author-${index}`,
        rank: index,
        baselineRank: index,
        recallSource: 'GraphSource',
        inNetwork: index % 2 === 0,
        isNews: false,
        score: 1 - index / 10,
        labels,
    };
}

function candidateWithoutFeedback(index: number): ReplayCandidateSnapshot {
    const { labels: _labels, ...withoutLabels } = candidate(index);
    return withoutLabels;
}

function request(
    requestId: string,
    candidates: ReplayCandidateSnapshot[],
    overrides: Partial<ReplayRequestSnapshot> = {},
): ReplayRequestSnapshot {
    return {
        requestId,
        userId: `user-${requestId}`,
        requestAt: '2026-04-23T00:00:00.000Z',
        productSurface: 'space_feed',
        pipeline: 'rust_primary',
        pipelineVersion: 'replay_metric_test_v1',
        degradedReasons: [],
        selectedCount: candidates.length,
        inNetworkCount: candidates.filter((item) => item.inNetwork).length,
        outOfNetworkCount: candidates.filter((item) => !item.inNetwork).length,
        sourceCounts: [{ source: 'GraphSource', count: candidates.length }],
        authorDiversity: candidates.length,
        replyRatio: 0,
        averageScore: 0.5,
        experimentKeys: ['replay_metric_test_v1'],
        candidateSetKind: 'complete_candidate_set_v1',
        candidateSetTotalCount: candidates.length,
        candidateSetTruncated: false,
        candidateSetCompleteness: 'complete_v1',
        candidates,
        ...overrides,
    };
}

function eligibleLabels(): ReplayCandidateLabelSummary {
    return {
        ...emptyLabels,
        click: true,
        engagement: true,
        dwellTimeMs: 1_000,
    };
}

describe('replay metric eligibility', () => {
    it('marks complete attribution over a full candidate set as evaluable', () => {
        const summary = evaluateReplayRequests(
            [request('complete', [candidate(1, eligibleLabels()), candidate(2)])],
            2,
            'baseline_rank_v1',
        );

        expect(summary.baseline.metricEligibility).toEqual({
            contractVersion: 'replay_metric_eligibility_v1',
            status: 'complete',
            reasons: [],
            eligibleRequestDenominator: 1,
            eligibleCandidateDenominator: 2,
            observedRequestDenominator: 1,
            observedCandidateDenominator: 2,
            excludedRequestCount: 0,
            excludedObservedCandidateCount: 0,
            observedCandidateSetOnly: false,
        });
        expect(summary.variantMetrics.metricEligibility.status).toBe('complete');
        expect(summary.baseline.averageNdcgAtK).toBeGreaterThan(0);
        expect(summary.eligibleRankLiftRequestDenominator).toBe(1);
        expect(summary.requestDiffLeaders.improved.length + summary.requestDiffLeaders.regressed.length)
            .toBeLessThanOrEqual(1);
    });

    it('separates missing feedback from a valid full candidate set', () => {
        const summary = evaluateReplayRequests(
            [request('missing-feedback', [candidateWithoutFeedback(1), candidateWithoutFeedback(2)])],
            2,
            'baseline_rank_v1',
        );

        expect(summary.baseline.metricEligibility).toEqual({
            contractVersion: 'replay_metric_eligibility_v1',
            status: 'not_evaluable',
            reasons: ['missing_feedback'],
            eligibleRequestDenominator: 0,
            eligibleCandidateDenominator: 0,
            observedRequestDenominator: 1,
            observedCandidateDenominator: 2,
            excludedRequestCount: 1,
            excludedObservedCandidateCount: 2,
            observedCandidateSetOnly: false,
        });
        expect(summary.baseline.clickHitRateAtK).toBe(0);
        expect(summary.baseline.averageNdcgAtK).toBe(0);
        expect(summary.baseline.averageAuthorDiversityAtK).toBe(1);
        expect(summary.eligibleRankLiftRequestDenominator).toBe(0);
        expect(summary.requestDiffLeaders).toEqual({ improved: [], regressed: [] });
    });

    it('does not infer full-set eligibility when completeness metadata is absent', () => {
        const incomplete = request(
            'metadata-missing',
            [candidate(1, eligibleLabels()), candidate(2)],
            { candidateSetCompleteness: undefined },
        );
        const summary = evaluateReplayRequests([incomplete], 2, 'baseline_rank_v1');

        expect(summary.baseline.metricEligibility).toMatchObject({
            status: 'not_evaluable',
            reasons: ['candidate_set_completeness_unverified'],
            eligibleRequestDenominator: 0,
            observedRequestDenominator: 1,
        });
        expect(summary.baseline.averageNdcgAtK).toBe(0);
        expect(summary.baseline.averageAuthorDiversityAtK).toBe(1);
    });

    it('excludes truncated candidate sets from full-set feedback metrics', () => {
        const summary = evaluateReplayRequests(
            [request(
                'truncated',
                [candidate(1, eligibleLabels()), candidate(2)],
                {
                    candidateSetKind: 'observed_topk_v1',
                    candidateSetTotalCount: 5,
                    candidateSetTruncated: true,
                },
            )],
            2,
            'baseline_rank_v1',
        );

        expect(summary.baseline.metricEligibility).toEqual({
            contractVersion: 'replay_metric_eligibility_v1',
            status: 'not_evaluable',
            reasons: ['candidate_set_truncated'],
            eligibleRequestDenominator: 0,
            eligibleCandidateDenominator: 0,
            observedRequestDenominator: 1,
            observedCandidateDenominator: 2,
            excludedRequestCount: 1,
            excludedObservedCandidateCount: 2,
            observedCandidateSetOnly: true,
        });
        expect(summary.baseline.averageNdcgAtK).toBe(0);
        expect(summary.baseline.averageAuthorDiversityAtK).toBe(1);
        expect(summary.candidateSet.truncationRate).toBe(1);
        expect(summary.eligibleRankLiftRequestDenominator).toBe(0);
    });

    it('uses only complete, attributed requests in mixed denominators and preserves reason order', () => {
        const summary = evaluateReplayRequests(
            [
                request('complete', [candidate(1, eligibleLabels()), candidate(2)]),
                request('missing-feedback', [candidateWithoutFeedback(3), candidateWithoutFeedback(4)]),
                request(
                    'truncated',
                    [candidate(5, eligibleLabels()), candidate(6)],
                    {
                        candidateSetTotalCount: 4,
                        candidateSetTruncated: true,
                    },
                ),
            ],
            2,
            'baseline_rank_v1',
        );

        expect(summary.baseline.metricEligibility).toEqual({
            contractVersion: 'replay_metric_eligibility_v1',
            status: 'partial',
            reasons: ['missing_feedback', 'candidate_set_truncated'],
            eligibleRequestDenominator: 1,
            eligibleCandidateDenominator: 2,
            observedRequestDenominator: 3,
            observedCandidateDenominator: 6,
            excludedRequestCount: 2,
            excludedObservedCandidateCount: 4,
            observedCandidateSetOnly: true,
        });
        expect(summary.variantMetrics.metricEligibility).toEqual(summary.baseline.metricEligibility);
        expect(summary.eligibleRankLiftRequestDenominator).toBe(1);
        expect(summary.engagedRankLiftRequestDenominator).toBe(1);
        expect(summary.clickedRankLiftRequestDenominator).toBe(1);
        expect(summary.requestDiffLeaders.improved.length + summary.requestDiffLeaders.regressed.length)
            .toBeLessThanOrEqual(1);
        expect(summary.baseline.averageNdcgAtK).toBeGreaterThan(0);
    });
});
