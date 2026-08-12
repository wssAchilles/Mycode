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

    it('indexes rollout evidence scans by runtime mode and time before serving owner', () => {
        const [keys] = RecommendationTrace.schema.indexes().find(([indexKeys]) =>
            'runtimeMode' in indexKeys && 'createdAt' in indexKeys && 'servingOwner' in indexKeys,
        ) || [{}];

        expect(Object.entries(keys)).toEqual([
            ['runtimeMode', 1],
            ['createdAt', -1],
            ['servingOwner', 1],
        ]);
    });

    it('round-trips request runtime truth through the trace schema', () => {
        const trace = new RecommendationTrace({
            requestId: 'req-runtime-roundtrip',
            userId: 'trace-user',
            productSurface: 'space_feed',
            runtimeMode: 'primary',
            servingOwner: 'node',
            fallbackReason: 'rust_primary_empty_fallback_node',
            owner: 'node',
            fallbackMode: 'none',
            degradedReasons: [],
            selectedCount: 0,
            inNetworkCount: 0,
            outOfNetworkCount: 0,
            sourceCounts: [],
            authorDiversity: 0,
            replyRatio: 0,
            averageScore: 0,
            freshness: {},
            candidates: [],
            experimentKeys: [],
        }).toObject();

        expect(trace).toMatchObject({
            runtimeMode: 'primary',
            servingOwner: 'node',
            fallbackReason: 'rust_primary_empty_fallback_node',
            owner: 'node',
        });
    });

    it('persists request-level source mix and candidate trace', async () => {
        const spy = vi.spyOn(RecommendationTrace, 'findOneAndUpdate').mockResolvedValue(null as any);
        const query = createFeedQuery('trace-user', 20, false, {
            requestId: 'req-trace-contract',
            decisionId: '8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab',
            clientRequestId: 'client-trace-contract',
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
                secondaryRecallSources: ['TwoTowerSource'],
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
        expect(filter).toEqual({
            requestId: 'req-trace-contract',
            $or: [
                { decisionId: { $exists: false } },
                { decisionId: '8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab' },
            ],
        });
        expect(options).toMatchObject({ upsert: true });
        expect((update as any).$set).toMatchObject({
            requestId: 'req-trace-contract',
            decisionId: '8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab',
            clientRequestId: 'client-trace-contract',
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
            secondaryRecallSources: ['TwoTowerSource'],
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

    it('persists a bounded, scored pre-selector replay pool including rejected candidates', async () => {
        const spy = vi.spyOn(RecommendationTrace, 'findOneAndUpdate').mockResolvedValue(null as any);
        const query = createFeedQuery('trace-replay-user', 1, false, {
            requestId: 'req-node-replay-pool',
        });
        const replayCandidates = Array.from({ length: 121 }, (_, index) =>
            makeCandidate(
                new mongoose.Types.ObjectId((index + 1).toString(16).padStart(24, '0')),
                {
                    authorId: `author-${index}`,
                    score: 121 - index,
                    inNetwork: false,
                    recallSource: 'TwoTowerSource',
                },
            ) as any,
        );

        await (new RecommendationTraceLogger() as any).run(
            query,
            [replayCandidates[0]],
            { preSelectorCandidates: replayCandidates },
        );

        const [, update] = spy.mock.calls[0];
        expect((update as any).$set.replayPool).toMatchObject({
            poolKind: 'pre_selector_scored_topk_v1',
            totalCount: 121,
            truncated: true,
        });
        expect((update as any).$set.replayPool.candidates).toHaveLength(120);
        expect((update as any).$set.replayPool.candidates[1]).toMatchObject({
            authorId: 'author-1',
            score: 120,
        });
        expect((update as any).$set.replayPool.fingerprint).toMatch(/^[0-9a-f]{16}$/);
        expect((update as any).$set.replayPoolFingerprint).toBe(
            (update as any).$set.replayPool.fingerprint,
        );
    });

    it('marks a full Rust replay pool truncated when local storage clips it', async () => {
        const spy = vi.spyOn(RecommendationTrace, 'findOneAndUpdate').mockResolvedValue(null as any);
        const query = createFeedQuery('trace-rust-replay-user', 1, false, {
            requestId: 'req-rust-replay-local-clip',
        });
        const replayPoolCandidates = Array.from({ length: 121 }, (_, index) => {
            const postId = (index + 1).toString(16).padStart(24, '0');
            return {
                postId,
                modelPostId: postId,
                authorId: `author-rust-${index}`,
                rank: index + 1,
                recallSource: 'TwoTowerSource',
                inNetwork: false,
                isNews: false,
                score: 121 - index,
                createdAt: '2026-04-23T00:00:00.000Z',
            };
        });

        await recordRecommendationTrace(
            query,
            [makeCandidate(oid('507f191e810c19729de87078')) as any],
            {
                rustTrace: {
                    traceVersion: 'rust_candidate_trace_v1',
                    requestId: query.requestId,
                    pipelineVersion: 'xalgo_candidate_pipeline_v6',
                    owner: 'rust',
                    fallbackMode: 'none',
                    selectedCount: 1,
                    inNetworkCount: 0,
                    outOfNetworkCount: 1,
                    sourceCounts: [],
                    authorDiversity: 1,
                    replyRatio: 0,
                    averageScore: 1,
                    freshness: {},
                    candidates: [],
                    experimentKeys: [],
                    replayPool: {
                        poolKind: 'pre_selector_scored_topk_v1',
                        totalCount: 121,
                        truncated: false,
                        candidates: replayPoolCandidates,
                    },
                    serveCacheHit: false,
                },
            },
        );

        const [, update] = spy.mock.calls[0];
        expect((update as any).$set.replayPool.candidates).toHaveLength(120);
        expect((update as any).$set.replayPool.totalCount).toBe(121);
        expect((update as any).$set.replayPool.truncated).toBe(true);
    });

    it('persists replay candidates when the selector returns no candidates', async () => {
        const spy = vi.spyOn(RecommendationTrace, 'findOneAndUpdate').mockResolvedValue(null as any);
        const query = createFeedQuery('trace-replay-only-user', 1, false, {
            requestId: 'req-node-replay-only',
        });
        const replayCandidate = makeCandidate(oid('507f191e810c19729de87079'), {
            authorId: 'author-rejected',
            score: 0.7,
            inNetwork: false,
            recallSource: 'TwoTowerSource',
        }) as any;

        await recordRecommendationTrace(query, [], {
            replayCandidates: [replayCandidate],
        });

        expect(spy).toHaveBeenCalledTimes(1);
        const [, update] = spy.mock.calls[0];
        expect((update as any).$set).toMatchObject({
            selectedCount: 0,
            candidates: [],
            replayPool: {
                poolKind: 'pre_selector_scored_topk_v1',
                totalCount: 1,
                truncated: false,
            },
        });
        expect((update as any).$set.replayPool.candidates[0]).toMatchObject({
            authorId: 'author-rejected',
            score: 0.7,
        });
    });

    it('persists runtime truth when a primary fallback also serves no Node candidates', async () => {
        const spy = vi.spyOn(RecommendationTrace, 'findOneAndUpdate').mockResolvedValue(null as any);
        const query = createFeedQuery('trace-empty-fallback-user', 20, false, {
            requestId: 'req-empty-primary-fallback',
            decisionId: 'd2ebaa7a-f43f-47f5-8a92-4440e85b97bb',
            clientRequestId: 'client-empty-primary-fallback',
        });

        await recordRecommendationTrace(query, [], {
            pipeline: 'rust_primary_empty_fallback_node',
            runtimeMode: 'primary',
            servingOwner: 'node',
            fallbackReason: 'rust_primary_empty_fallback_node',
            fallbackMode: 'none',
        });

        expect(spy).toHaveBeenCalledTimes(1);
        const [filter, update] = spy.mock.calls[0];
        expect(filter).toEqual({
            requestId: 'req-empty-primary-fallback',
            $or: [
                { decisionId: { $exists: false } },
                { decisionId: 'd2ebaa7a-f43f-47f5-8a92-4440e85b97bb' },
            ],
        });
        expect((update as any).$set).toMatchObject({
            decisionId: 'd2ebaa7a-f43f-47f5-8a92-4440e85b97bb',
            clientRequestId: 'client-empty-primary-fallback',
            runtimeMode: 'primary',
            servingOwner: 'node',
            fallbackReason: 'rust_primary_empty_fallback_node',
            owner: 'node',
        });
        expect((update as any).$setOnInsert).toMatchObject({
            requestId: 'req-empty-primary-fallback',
            selectedCount: 0,
            candidates: [],
        });
        expect((update as any).$setOnInsert).not.toHaveProperty('decisionId');
        expect((update as any).$setOnInsert).not.toHaveProperty('clientRequestId');
        expect((update as any).$set).not.toHaveProperty('candidates');
        expect((update as any).$set).not.toHaveProperty('replayPool');
        expect((update as any).$set).not.toHaveProperty('experimentKeys');
        expect((update as any).$set).not.toHaveProperty('createdAt');
    });

    it('merges served runtime truth without replacing the pipeline trace payload', async () => {
        let stored: Record<string, any> = {};
        let inserted = false;
        const spy = vi.spyOn(RecommendationTrace, 'findOneAndUpdate').mockImplementation(
            async (_filter: any, update: any) => {
                if (!inserted) {
                    stored = { ...stored, ...(update.$setOnInsert || {}) };
                    inserted = true;
                }
                stored = { ...stored, ...(update.$set || {}) };
                return null as any;
            },
        );
        const pipelineQuery = createFeedQuery('trace-dual-writer-user', 1, false, {
            requestId: 'req-dual-writer',
            decisionId: 'f0992d65-aee7-442c-b8fc-74acdc7b9fd1',
            clientRequestId: 'client-dual-writer',
        });
        pipelineQuery.experimentContext = {
            userId: pipelineQuery.userId,
            assignments: [{
                experimentId: 'space_feed_recsys',
                experimentName: 'Space feed recsys',
                bucket: 'treatment',
                config: {},
                inExperiment: true,
            }],
            getConfig: (_experimentId, _key, defaultValue) => defaultValue,
            isInBucket: () => false,
        };
        const selected = makeCandidate(oid('507f191e810c19729de87081'), {
            authorId: 'pipeline-selected',
        }) as any;
        const rejected = makeCandidate(oid('507f191e810c19729de87082'), {
            authorId: 'pipeline-rejected',
            score: 0.5,
        }) as any;

        await new RecommendationTraceLogger().run(
            pipelineQuery,
            [selected],
            { preSelectorCandidates: [selected, rejected] },
        );
        const originalCreatedAt = stored.createdAt;
        const originalCandidates = stored.candidates;
        const originalReplayPool = stored.replayPool;

        await recordRecommendationTrace(
            createFeedQuery('trace-dual-writer-user', 1, false, {
                requestId: 'req-dual-writer',
                decisionId: pipelineQuery.decisionId,
                clientRequestId: pipelineQuery.clientRequestId,
            }),
            [makeCandidate(oid('507f191e810c19729de87083'), {
                authorId: 'served-feed-candidate',
            }) as any],
            {
                pipeline: 'node_baseline',
                runtimeMode: 'off',
                servingOwner: 'node',
                fallbackMode: 'node_local_mixer',
                degradedReasons: ['served_runtime_truth'],
            },
        );

        expect(spy).toHaveBeenCalledTimes(2);
        const [, runtimeUpdate] = spy.mock.calls[1];
        expect((runtimeUpdate as any).$set).toMatchObject({
            pipeline: 'node_baseline',
            runtimeMode: 'off',
            servingOwner: 'node',
            owner: 'node',
            fallbackMode: 'node_local_mixer',
            degradedReasons: ['served_runtime_truth'],
        });
        expect((runtimeUpdate as any).$set).not.toHaveProperty('candidates');
        expect((runtimeUpdate as any).$set).not.toHaveProperty('experimentKeys');
        expect((runtimeUpdate as any).$set).not.toHaveProperty('replayPool');
        expect((runtimeUpdate as any).$set).not.toHaveProperty('createdAt');
        expect(stored.candidates).toBe(originalCandidates);
        expect(stored.replayPool).toBe(originalReplayPool);
        expect(stored.experimentKeys).toEqual(['space_feed_recsys:treatment']);
        expect(stored.createdAt).toBe(originalCreatedAt);
        expect(stored).toMatchObject({
            runtimeMode: 'off',
            servingOwner: 'node',
            owner: 'node',
        });
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
                secondaryRecallSources: ['GraphSource'],
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
                runtimeMode: 'primary',
                servingOwner: 'rust',
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
                    owner: 'node',
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
                        secondaryRecallSources: ['GraphSource'],
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
            pipeline: 'rust_primary',
            runtimeMode: 'primary',
            servingOwner: 'rust',
            owner: 'rust',
            fallbackMode: 'node_provider_surface',
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
        });
        expect((update as any).$setOnInsert).toMatchObject({
            requestId: 'req-rust-primary-trace',
            pipelineVersion: 'xalgo_candidate_pipeline_v6',
            traceVersion: 'rust_candidate_trace_v1',
            averageScore: 2.4,
            embeddingQualityScore: 0.91,
        });
        expect((update as any).$setOnInsert.sourceCounts).toEqual([
            { source: 'EmbeddingAuthorSource', count: 1 },
        ]);
        expect((update as any).$setOnInsert.replayPool).toMatchObject({
            poolKind: 'pre_selector_scored_topk_v1',
            totalCount: 140,
            truncated: true,
        });
        expect((update as any).$setOnInsert.replayPool.candidates[0]).toMatchObject({
            authorId: 'author-rust-0',
            recallSource: 'EmbeddingAuthorSource',
            secondaryRecallSources: ['GraphSource'],
            score: 2.4,
        });
        expect((update as any).$setOnInsert.replayPool.candidates).toHaveLength(75);
        expect((update as any).$setOnInsert.candidates[0]).toMatchObject({
            authorId: 'author-rust',
            recallSource: 'EmbeddingAuthorSource',
            score: 2.4,
            weightedScore: 2.1,
            pipelineScore: 2.0,
            recommendationDetail: '匹配你的作者兴趣画像',
            sourceReason: 'embedding_author_retrieval',
            evidence: ['author_cluster', 'author_affinity'],
        });
        expect((update as any).$setOnInsert.candidates[0].explainSignals).toMatchObject({
            retrievalAuthorClusterScore: 0.81,
            authorAffinityScore: 0.34,
        });
    });
});
