import { describe, expect, it } from 'vitest';

import { evaluateReplayRequests } from '../../src/services/recommendation/replay/evaluator';
import { rerankReplayCandidates } from '../../src/services/recommendation/replay/variantScorer';
import type { ReplayRequestSnapshot } from '../../src/services/recommendation/replay/contracts';

function buildRequest(overrides?: Partial<ReplayRequestSnapshot>): ReplayRequestSnapshot {
    return {
        requestId: 'req-replay-1',
        userId: 'user-1',
        requestAt: new Date().toISOString(),
        productSurface: 'space_feed',
        pipeline: 'rust_primary',
        pipelineVersion: 'xalgo_candidate_pipeline_v6',
        traceVersion: 'rust_candidate_trace_v1',
        owner: 'rust',
        fallbackMode: 'none',
        degradedReasons: [],
        selectedCount: 2,
        inNetworkCount: 1,
        outOfNetworkCount: 1,
        sourceCounts: [
            { source: 'PopularSource', count: 1 },
            { source: 'EmbeddingAuthorSource', count: 1 },
        ],
        authorDiversity: 1,
        replyRatio: 0,
        averageScore: 0.8,
        topScore: 0.9,
        bottomScore: 0.7,
        experimentKeys: [],
        userState: 'warm',
        embeddingQualityScore: 0.82,
        candidateSetKind: 'pre_selector_scored_topk_v1',
        candidateSetTotalCount: 8,
        candidateSetTruncated: true,
        candidates: [
            {
                postId: '507f191e810c19729de87071',
                modelPostId: '507f191e810c19729de87071',
                authorId: 'popular-author',
                baselineRank: 1,
                recallSource: 'PopularSource',
                inNetwork: false,
                isNews: false,
                score: 0.92,
                weightedScore: 0.88,
                pipelineScore: 0.84,
                recommendationDetail: '当前热门内容',
                sourceReason: 'popular_fallback',
                evidence: ['popular_fallback'],
                explainSignals: {
                    retrievalEngagementPrior: 0.92,
                },
                labels: {
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
                },
            },
            {
                postId: '507f191e810c19729de87072',
                modelPostId: '507f191e810c19729de87072',
                authorId: 'embedding-author',
                baselineRank: 2,
                recallSource: 'EmbeddingAuthorSource',
                inNetwork: true,
                isNews: false,
                score: 0.79,
                weightedScore: 0.77,
                pipelineScore: 0.75,
                recommendationDetail: '匹配你的作者兴趣画像',
                sourceReason: 'embedding_author_retrieval',
                evidence: ['author_cluster', 'author_affinity'],
                explainSignals: {
                    retrievalAuthorClusterScore: 0.85,
                    retrievalEmbeddingScore: 0.74,
                    authorAffinityScore: 0.42,
                },
                labels: {
                    click: true,
                    like: true,
                    reply: false,
                    repost: false,
                    quote: false,
                    share: false,
                    dismiss: false,
                    blockAuthor: false,
                    report: false,
                    engagement: true,
                    negative: false,
                    dwellTimeMs: 0,
                },
            },
        ],
        ...overrides,
    };
}

describe('recommendation replay evaluator', () => {
    it('hybrid replay variant promotes embedding-matched engaged candidates over popular fallback', () => {
        const ranked = rerankReplayCandidates(buildRequest(), 'hybrid_signal_blend_v1');

        expect(ranked[0].postId).toBe('507f191e810c19729de87072');
        expect(ranked[0].replayRank).toBe(1);
        expect(ranked[0].replayScore).toBeGreaterThan(ranked[1].replayScore);
    });

    it('reports positive ranking deltas when replay variant lifts engaged content', () => {
        const summary = evaluateReplayRequests([buildRequest()], 2, 'hybrid_signal_blend_v1');

        expect(summary.requests).toBe(1);
        expect(summary.variantMetrics.averageNdcgAtK).toBeGreaterThan(summary.baseline.averageNdcgAtK);
        expect(summary.variantMetrics.averageMrrAtK).toBeGreaterThan(summary.baseline.averageMrrAtK);
        expect(summary.averageEngagedRankLift).toBeGreaterThan(0);
        expect(summary.candidateSet.averageObservedCandidates).toBe(2);
        expect(summary.candidateSet.averageTotalCandidates).toBe(8);
        expect(summary.candidateSet.truncationRate).toBe(1);
        expect(summary.byCandidateSetKind.pre_selector_scored_topk_v1).toMatchObject({
            requests: 1,
            averageObservedCandidates: 2,
            averageTotalCandidates: 8,
            truncationRate: 1,
        });
        expect(summary.bySelectedSource.EmbeddingAuthorSource.variantShareAtK).toBeGreaterThan(0);
        expect(summary.requestDiffLeaders.improved[0]?.requestId).toBe('req-replay-1');
    });

    it('industrial guardrail variant demotes negative repeats and promotes trend-linked news', () => {
        const base = buildRequest();
        const request = buildRequest({
            strategyVersion: 'strategy_policy_v2',
            candidates: [
                {
                    ...base.candidates[0],
                    postId: '507f191e810c19729de87073',
                    modelPostId: '507f191e810c19729de87073',
                    baselineRank: 1,
                    score: 0.96,
                    weightedScore: 0.92,
                    pipelineScore: 0.9,
                    evidence: ['popular_fallback', 'negative_feedback_guardrail'],
                    explainSignals: {
                        retrievalEngagementPrior: 0.92,
                        negativeFeedbackStrength: 0.88,
                        fatigueStrength: 0.42,
                        sessionSuppressionStrength: 0.36,
                        explorationRisk: 0.74,
                    },
                },
                {
                    ...base.candidates[1],
                    postId: '507f191e810c19729de87074',
                    modelPostId: '507f191e810c19729de87074',
                    baselineRank: 2,
                    recallSource: 'NewsAnnSource',
                    inNetwork: false,
                    isNews: true,
                    score: 0.78,
                    weightedScore: 0.76,
                    pipelineScore: 0.75,
                    evidence: ['news_trend_link', 'trend_affinity'],
                    explainSignals: {
                        retrievalKeywordScore: 0.34,
                        trendAffinityStrength: 0.42,
                        newsTrendLinkStrength: 0.88,
                        strategyVersionHash: 0.5,
                    },
                    labels: {
                        ...base.candidates[1].labels,
                        engagement: true,
                        click: true,
                    },
                },
            ],
        });

        const ranked = rerankReplayCandidates(request, 'industrial_guardrail_blend_v1');

        expect(ranked[0].postId).toBe('507f191e810c19729de87074');
        expect(ranked[0].replayScore).toBeGreaterThan(ranked[1].replayScore);
    });
});
