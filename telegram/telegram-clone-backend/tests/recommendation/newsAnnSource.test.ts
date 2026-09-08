import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { NewsAnnSource } from '../../src/services/recommendation/sources/NewsAnnSource';
import Post from '../../src/models/Post';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('NewsAnnSource', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('honors the source-mixing policy for cold-start and in-network traffic', () => {
        const source = new NewsAnnSource();
        const query = createFeedQuery('user', 20);
        query.userStateContext = {
            state: 'cold_start',
            reason: 'bootstrap',
            followedCount: 0,
            recentActionCount: 0,
            recentPositiveActionCount: 0,
            usableEmbedding: false,
        };

        expect(source.enable(query)).toBe(false);

        query.userStateContext.state = 'warm';
        expect(source.enable(query)).toBe(true);

        query.inNetworkOnly = true;
        expect(source.enable(query)).toBe(false);
    });

    it('hydrates ANN externalIds only for observation and serves the recency fallback', async () => {
        vi.stubEnv('NEWS_ANN_SEMANTIC_CONTRACT_ENABLED', 'true');
        const q = createFeedQuery('user', 20);
        q.newsHistoryExternalIds = ['N0'];

        const annClient = {
            retrieve: vi.fn().mockResolvedValue(annAttempt('success', [
                { postId: 'N2', score: 0.9 },
                { postId: 'N1', score: 0.8 },
            ])),
        } as any;

        const p1 = {
            _id: oid('507f191e810c19729de8a001'),
            authorId: 'news_bot_official',
            content: 'news 1',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N1', source: 'mind', url: 'mind://N1' },
            stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
            media: [],
            isNsfw: false,
            isPinned: false,
        };
        const p2 = {
            _id: oid('507f191e810c19729de8a002'),
            authorId: 'news_bot_official',
            content: 'news 2',
            createdAt: new Date('2026-02-02T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N2', source: 'mind', url: 'mind://N2' },
            stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
            media: [],
            isNsfw: false,
            isPinned: false,
        };
        const fallback = {
            ...p1,
            _id: oid('507f191e810c19729de8a003'),
            content: 'fallback news',
            newsMetadata: { externalId: 'N3', source: 'mind', url: 'mind://N3' },
        };

        vi.spyOn(Post as any, 'find').mockImplementation((filter: Record<string, unknown>) => {
            if (filter['newsMetadata.externalId']) {
                return { lean: vi.fn().mockResolvedValue([p1, p2]) } as any;
            }
            return recencyQuery([fallback]);
        });

        const source = new NewsAnnSource(annClient);
        const out = await source.getCandidates(q as any);

        expect(q.embeddingContext?.embeddingContract).toBeUndefined();
        expect(annClient.retrieve).toHaveBeenCalledOnce();
        expect(annClient.retrieve).toHaveBeenCalledWith(
            expect.objectContaining({ topK: 200 }),
            expect.objectContaining({ deadlineMs: expect.any(Number) }),
        );
        expect(out).toHaveLength(1);
        expect(out[0].newsMetadata?.externalId).toBe('N3');
        expect(out[0].inNetwork).toBe(false);
        expect(out[0].recallSource).toBe('NewsAnnSource');
        expect(out[0]._scoreBreakdown).toMatchObject({ annFallbackRecency: 1 });
        expect(source.stageDetail(q as any, out)).toMatchObject({
            servedPath: 'recency_fallback',
            annObservation: {
                mode: 'observe_only',
                attempt: { outcome: 'success', requestedK: 200, returnedK: 2 },
                validatedCount: 2,
                hydratedCount: 2,
                comparison: {
                    status: 'skipped',
                    reason: 'exact_baseline_unavailable',
                    evaluationKs: [20, 80, 200],
                },
            },
        });
        expect(source.stageDetail(q as any, out)).toBeUndefined();
    });

    it('records a terminal timeout and ignores a late ANN resolution', async () => {
        vi.stubEnv('NEWS_ANN_SEMANTIC_CONTRACT_ENABLED', 'true');
        vi.useFakeTimers();
        try {
            const q = createFeedQuery('user', 20);
            let resolveAnn!: (value: unknown) => void;
            const annClient = {
                retrieve: vi.fn(() => new Promise((resolve) => {
                    resolveAnn = resolve;
                })),
            } as any;
            const post = {
                _id: oid('507f191e810c19729de8a003'),
                authorId: 'news_bot_official',
                content: 'fallback news',
                createdAt: new Date('2026-02-03T00:00:00.000Z'),
                isReply: false,
                isRepost: false,
                isNews: true,
                newsMetadata: { externalId: 'N3', source: 'mind', url: 'mind://N3' },
                stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
                media: [],
                isNsfw: false,
                isPinned: false,
            };
            vi.spyOn(Post as any, 'find').mockReturnValue(recencyQuery([post]) as any);

            const source = new NewsAnnSource(annClient);
            const pending = source.getCandidates(q as any);
            await vi.advanceTimersByTimeAsync(901);
            const out = await pending;
            const detail = source.stageDetail(q as any, out);

            expect(out).toHaveLength(1);
            expect(out[0].newsMetadata?.externalId).toBe('N3');
            expect(out[0]._scoreBreakdown).toMatchObject({ annFallbackRecency: 1 });
            expect(detail).toMatchObject({
                servedPath: 'recency_fallback',
                annObservation: {
                    mode: 'observe_only',
                    attempt: { outcome: 'timeout', candidates: [] },
                    validatedCount: 0,
                    hydratedCount: 0,
                },
            });
            expect(detail).not.toHaveProperty('error');
            expect(detail).not.toHaveProperty('timedOut');

            resolveAnn(annAttempt('success', [{ postId: 'N9', score: 1 }]));
            await vi.runAllTimersAsync();
            expect(detail?.annObservation).toMatchObject({ attempt: { outcome: 'timeout' } });
            expect(source.stageDetail(q as any, out)).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['empty', 'transport_error'] as const)(
        'preserves the %s ANN outcome while serving recency without top-level errors',
        async (outcome) => {
            vi.stubEnv('NEWS_ANN_SEMANTIC_CONTRACT_ENABLED', 'true');
            const q = createFeedQuery('user', 20);
            const annClient = { retrieve: vi.fn().mockResolvedValue(annAttempt(outcome)) } as any;
            const post = {
                _id: oid('507f191e810c19729de8a004'),
                authorId: 'news_bot_official',
                content: 'fallback news',
                createdAt: new Date('2026-02-04T00:00:00.000Z'),
                isReply: false,
                isRepost: false,
                isNews: true,
                newsMetadata: { externalId: 'N4', source: 'mind', url: 'mind://N4' },
                stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
                media: [],
                isNsfw: false,
                isPinned: false,
            };
            vi.spyOn(Post as any, 'find').mockReturnValue(recencyQuery([post]) as any);

            const source = new NewsAnnSource(annClient);
            const out = await source.getCandidates(q as any);
            const detail = source.stageDetail(q as any, out);

            expect(out).toHaveLength(1);
            expect(detail).toMatchObject({
                servedPath: 'recency_fallback',
                annObservation: { attempt: { outcome } },
            });
            expect(detail).not.toHaveProperty('error');
            expect(detail).not.toHaveProperty('timedOut');
        },
    );

    it('keeps serving recency when ANN hydration fails and nests the observation error', async () => {
        vi.stubEnv('NEWS_ANN_SEMANTIC_CONTRACT_ENABLED', 'true');
        const q = createFeedQuery('user', 20);
        const annClient = {
            retrieve: vi.fn().mockResolvedValue(annAttempt('success', [{ postId: 'N5', score: 0.9 }])),
        } as any;
        const fallback = {
            _id: oid('507f191e810c19729de8a005'),
            authorId: 'news_bot_official',
            content: 'fallback survives',
            createdAt: new Date('2026-02-05T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N6', source: 'mind', url: 'mind://N6' },
            stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
            media: [],
            isNsfw: false,
            isPinned: false,
        };
        vi.spyOn(Post as any, 'find').mockImplementation((filter: Record<string, unknown>) => {
            if (filter['newsMetadata.externalId']) throw new Error('hydration unavailable');
            return recencyQuery([fallback]);
        });

        const source = new NewsAnnSource(annClient);
        const out = await source.getCandidates(q as any);
        const detail = source.stageDetail(q as any, out);

        expect(out.map((candidate) => candidate.postId.toString())).toEqual([fallback._id.toString()]);
        expect(detail).toMatchObject({
            servedPath: 'recency_fallback',
            annObservation: {
                mode: 'observe_only',
                reason: 'observation_failed',
                validatedCount: 0,
                hydratedCount: 0,
            },
        });
        expect(detail).not.toHaveProperty('error');
        expect(detail).not.toHaveProperty('timedOut');
    });

    it('bounds hanging ANN hydration by the whole observation deadline', async () => {
        vi.stubEnv('NEWS_ANN_SEMANTIC_CONTRACT_ENABLED', 'true');
        vi.useFakeTimers();
        try {
            const q = createFeedQuery('user', 20);
            q.rankingPolicy = { sourceBatchTimeoutMs: 50 };
            const annClient = {
                retrieve: vi.fn().mockResolvedValue(annAttempt('success', [{ postId: 'N7', score: 0.9 }])),
            } as any;
            const fallback = {
                _id: oid('507f191e810c19729de8a006'),
                authorId: 'news_bot_official',
                content: 'recency deadline fallback',
                createdAt: new Date('2026-02-06T00:00:00.000Z'),
                isReply: false,
                isRepost: false,
                isNews: true,
                newsMetadata: { externalId: 'N8', source: 'mind', url: 'mind://N8' },
                stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
                media: [],
                isNsfw: false,
                isPinned: false,
            };
            let resolveHydration!: (posts: unknown[]) => void;
            vi.spyOn(Post as any, 'find').mockImplementation((filter: Record<string, unknown>) => {
                if (filter['newsMetadata.externalId']) {
                    return {
                        lean: vi.fn(() => new Promise((resolve) => {
                            resolveHydration = resolve;
                        })),
                    } as any;
                }
                return recencyQuery([fallback]);
            });

            const source = new NewsAnnSource(annClient);
            const pending = source.getCandidates(q as any);
            const observed = Promise.race([
                pending,
                new Promise<'test_timeout'>((resolve) => setTimeout(() => resolve('test_timeout'), 60)),
            ]);
            await vi.advanceTimersByTimeAsync(60);
            const result = await observed;

            expect(result).not.toBe('test_timeout');
            const out = result as Awaited<ReturnType<typeof source.getCandidates>>;
            const detail = source.stageDetail(q as any, out);
            expect(out.map((candidate) => candidate.postId.toString())).toEqual([fallback._id.toString()]);
            expect(detail).toMatchObject({
                servedPath: 'recency_fallback',
                annObservation: {
                    mode: 'observe_only',
                    attempt: {
                        outcome: 'timeout',
                        requestedK: 200,
                        returnedK: 0,
                        candidates: [],
                    },
                    validatedCount: 0,
                    hydratedCount: 0,
                    comparison: {
                        status: 'skipped',
                        reason: 'exact_baseline_unavailable',
                    },
                },
            });

            resolveHydration([]);
            await vi.runAllTimersAsync();
            expect(detail?.annObservation).toMatchObject({ attempt: { outcome: 'timeout' } });
            expect(source.stageDetail(q as any, out)).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
});

function annAttempt(outcome: string, candidates: Array<{ postId: string; score: number }> = []) {
    return {
        outcome,
        requestedK: 200,
        returnedK: candidates.length,
        latencyMs: 1,
        candidates: outcome === 'success' ? candidates : [],
        responseEvidence: outcome === 'success' || outcome === 'empty'
            ? {
                embeddingSpace: 'semantic_news_v1',
                retrievalEmbeddingDim: 256,
                modelVersion: 'semantic_news_v1',
                artifactVersion: 'semantic_news_artifact_v1',
                idNamespace: 'news_external_id',
                indexVersion: 'news-index-v1',
            }
            : undefined,
    };
}

function recencyQuery(posts: unknown[]) {
    const lean = vi.fn().mockResolvedValue(posts);
    const limit = vi.fn().mockReturnValue({ lean });
    const sort = vi.fn().mockReturnValue({ limit });
    return { sort };
}
