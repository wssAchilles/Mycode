import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import RecommendationTrace from '../../src/models/RecommendationTrace';
import { recordRecommendationTrace } from '../../src/services/recommendation/observability/recommendationTrace';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { RecommendationTraceLogger } from '../../src/services/recommendation/sideeffects/RecommendationTraceLogger';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

const makeCandidate = (postId: mongoose.Types.ObjectId, overrides?: Partial<any>) => ({
    postId,
    modelPostId: postId.toString(),
    authorId: 'author-1',
    content: 'trace candidate',
    createdAt: new Date('2026-04-23T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    inNetwork: true,
    isNews: false,
    recallSource: 'FollowingSource',
    score: 1.2,
    weightedScore: 1.5,
    _pipelineScore: 1.4,
    _scoreBreakdown: {
        weightedScore: 1.5,
        calibrationSourceMultiplier: 1.02,
    },
    ...overrides,
});

describe('RecommendationTraceLogger', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('persists request-level source mix and candidate trace', async () => {
        const spy = vi.spyOn(RecommendationTrace, 'findOneAndUpdate').mockResolvedValue(null as any);
        const query = createFeedQuery('trace-user', 20, false, {
            requestId: 'req-trace-contract',
        });
        query.userStateContext = {
            state: 'warm',
            reason: 'test',
            followedCount: 8,
            recentActionCount: 30,
            recentPositiveActionCount: 9,
            usableEmbedding: true,
        };
        query.embeddingContext = {
            interestedInClusters: [{ clusterId: 9101, score: 0.8 }],
            producerEmbedding: [],
            qualityScore: 0.7,
            usable: true,
        };

        await new RecommendationTraceLogger().run(query, [
            makeCandidate(oid('507f191e810c19729de87071'), {
                authorId: 'author-a',
                recallSource: 'FollowingSource',
                inNetwork: true,
            }) as any,
            makeCandidate(oid('507f191e810c19729de87072'), {
                authorId: 'author-b',
                recallSource: 'TwoTowerSource',
                inNetwork: false,
                isReply: true,
                score: 0.8,
            }) as any,
        ]);

        expect(spy).toHaveBeenCalledTimes(1);
        const [filter, update, options] = spy.mock.calls[0];
        expect(filter).toEqual({ requestId: 'req-trace-contract' });
        expect(options).toMatchObject({ upsert: true });
        expect((update as any).$set).toMatchObject({
            requestId: 'req-trace-contract',
            userId: 'trace-user',
            productSurface: 'space_feed',
            selectedCount: 2,
            inNetworkCount: 1,
            outOfNetworkCount: 1,
            authorDiversity: 1,
            replyRatio: 0.5,
            averageScore: 1,
            userState: 'warm',
            embeddingQualityScore: 0.7,
        });
        expect((update as any).$set.sourceCounts).toEqual([
            { source: 'FollowingSource', count: 1 },
            { source: 'TwoTowerSource', count: 1 },
        ]);
        expect((update as any).$set.candidates).toHaveLength(2);
        expect((update as any).$set.candidates[0]).toMatchObject({
            rank: 1,
            recallSource: 'FollowingSource',
            inNetwork: true,
            score: 1.2,
            weightedScore: 1.5,
            pipelineScore: 1.4,
        });
        expect((update as any).$set.candidates[0].scoreBreakdown).toMatchObject({
            weightedScore: 1.5,
            calibrationSourceMultiplier: 1.02,
        });
        expect((update as any).$set.freshness.newestAgeSeconds).toBeTypeOf('number');
    });

    it('persists runtime path, shadow comparison, and Rust serving metadata', async () => {
        const spy = vi.spyOn(RecommendationTrace, 'findOneAndUpdate').mockResolvedValue(null as any);
        const query = createFeedQuery('trace-user', 20, false, {
            requestId: 'req-rust-primary-trace',
        });
        const replayPoolCandidates = Array.from({ length: 75 }, (_, index) => {
            const postId = `507f191e810c19729de8${(7000 + index).toString(16).padStart(4, '0')}`;
            return {
                postId,
                modelPostId: postId,
                authorId: `author-rust-${index}`,
                rank: index + 1,
                recallSource: 'EmbeddingAuthorSource',
                inNetwork: false,
                isNews: false,
                score: 2.4 - (index * 0.01),
                weightedScore: 2.1 - (index * 0.01),
                pipelineScore: 2.0 - (index * 0.01),
                scoreBreakdown: { phoenixWeighted: 2.4 - (index * 0.01) },
                createdAt: '2026-04-23T00:00:00.000Z',
            };
        });

        await recordRecommendationTrace(
            query,
            [
                makeCandidate(oid('507f191e810c19729de87073'), {
                    authorId: 'author-rust',
                    recallSource: 'EmbeddingAuthorSource',
                    inNetwork: false,
                    recommendationExplain: {
                        detail: '匹配你的作者兴趣画像',
                        primarySource: 'EmbeddingAuthorSource',
                        sourceReason: 'embedding_author_retrieval',
                        inNetwork: false,
                        embeddingMatched: true,
                        graphMatched: false,
                        popularFallback: false,
                        diversityAdjusted: false,
                        evidence: ['author_cluster', 'author_affinity'],
                        signals: {
                            retrievalAuthorClusterScore: 0.81,
                            authorAffinityScore: 0.34,
                        },
                    },
                }) as any,
            ],
            {
                pipeline: 'rust_primary',
                owner: 'rust',
                fallbackMode: 'none',
                degradedReasons: ['shadow_observed'],
                shadowComparison: {
                    overlapCount: 3,
                    overlapRatio: 0.6,
                    selectedCount: 5,
                    baselineCount: 5,
                },
                serving: {
                    servingVersion: 'rust-v1',
                    stableOrderKey: 'stable-key',
                    hasMore: true,
                },
                rustTrace: {
                    traceVersion: 'rust_candidate_trace_v1',
                    requestId: 'req-rust-primary-trace',
                    pipelineVersion: 'xalgo_candidate_pipeline_v6',
                    owner: 'rust',
                    fallbackMode: 'node_provider_surface',
                    selectedCount: 1,
                    inNetworkCount: 0,
                    outOfNetworkCount: 1,
                    sourceCounts: [{ source: 'EmbeddingAuthorSource', count: 1 }],
                    authorDiversity: 1,
                    replyRatio: 0,
                    averageScore: 2.4,
                    topScore: 2.4,
                    bottomScore: 2.4,
                    freshness: {
                        newestAgeSeconds: 12,
                        oldestAgeSeconds: 12,
                        timeRangeSeconds: 0,
                    },
                    candidates: [{
                        postId: '507f191e810c19729de87073',
                        modelPostId: '507f191e810c19729de87073',
                        authorId: 'author-rust',
                        rank: 1,
                        recallSource: 'EmbeddingAuthorSource',
                        inNetwork: false,
                        isNews: false,
                        score: 2.4,
                        weightedScore: 2.1,
                        pipelineScore: 2.0,
                        scoreBreakdown: { phoenixWeighted: 2.4 },
                        createdAt: '2026-04-23T00:00:00.000Z',
                    }],
                    experimentKeys: ['recsys_v2:treatment'],
                    userState: 'warm',
                    embeddingQualityScore: 0.91,
                    replayPool: {
                        poolKind: 'pre_selector_scored_topk_v1',
                        totalCount: 140,
                        truncated: true,
                        candidates: replayPoolCandidates,
                    },
                    serveCacheHit: false,
                },
            },
        );

        expect(spy).toHaveBeenCalledTimes(1);
        const [, update] = spy.mock.calls[0];
        expect((update as any).$set).toMatchObject({
            requestId: 'req-rust-primary-trace',
            pipeline: 'rust_primary',
            pipelineVersion: 'xalgo_candidate_pipeline_v6',
            traceVersion: 'rust_candidate_trace_v1',
            owner: 'rust',
            fallbackMode: 'node_provider_surface',
            degradedReasons: ['shadow_observed'],
            averageScore: 2.4,
            embeddingQualityScore: 0.91,
            shadowComparison: {
                overlapCount: 3,
                overlapRatio: 0.6,
                selectedCount: 5,
                baselineCount: 5,
            },
            serving: {
                servingVersion: 'rust-v1',
                stableOrderKey: 'stable-key',
                hasMore: true,
            },
        });
        expect((update as any).$set.sourceCounts).toEqual([
            { source: 'EmbeddingAuthorSource', count: 1 },
        ]);
        expect((update as any).$set.replayPool).toMatchObject({
            poolKind: 'pre_selector_scored_topk_v1',
            totalCount: 140,
            truncated: true,
        });
        expect((update as any).$set.replayPool.candidates[0]).toMatchObject({
            authorId: 'author-rust-0',
            recallSource: 'EmbeddingAuthorSource',
            score: 2.4,
        });
        expect((update as any).$set.replayPool.candidates).toHaveLength(75);
        expect((update as any).$set.candidates[0]).toMatchObject({
            authorId: 'author-rust',
            recallSource: 'EmbeddingAuthorSource',
            score: 2.4,
            weightedScore: 2.1,
            pipelineScore: 2.0,
            recommendationDetail: '匹配你的作者兴趣画像',
            sourceReason: 'embedding_author_retrieval',
            evidence: ['author_cluster', 'author_affinity'],
        });
        expect((update as any).$set.candidates[0].explainSignals).toMatchObject({
            retrievalAuthorClusterScore: 0.81,
            authorAffinityScore: 0.34,
        });
    });
});
