import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../src/services/recommendation/utils/redisClient', () => ({
    getRedis: () => null,
}));

import UserAction, { ActionType } from '../../src/models/UserAction';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { ImpressionLogger } from '../../src/services/recommendation/sideeffects/ImpressionLogger';
import { ServeCacheSideEffect } from '../../src/services/recommendation/sideeffects/ServeCacheSideEffect';
import { ExperimentContext } from '../../src/services/experiment/types';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

const makeCandidate = (
    postId: mongoose.Types.ObjectId,
    overrides?: Partial<any>
) => ({
    postId,
    modelPostId: postId.toString(),
    authorId: 'author-1',
    content: 'hello',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    inNetwork: true,
    isNews: false,
    recallSource: 'FollowingSource',
    score: 1.2,
    weightedScore: 1.5,
    ...overrides,
});

describe('Feed action logging contract', () => {
    const attachExperimentContext = (query: ReturnType<typeof createFeedQuery>) => {
        const ctx: ExperimentContext = {
            userId: query.userId,
            assignments: [
                {
                    experimentId: 'space_feed_recsys_alignment',
                    experimentName: 'space feed recsys alignment',
                    bucket: 'treatment',
                    config: {},
                    inExperiment: true,
                },
            ],
            getConfig: <T>(_experimentId: string, _key: string, defaultValue: T) => defaultValue,
            isInBucket: (_experimentId: string, _bucket: string) => false,
        };
        query.experimentContext = ctx;
    };

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('ImpressionLogger writes request-level training fields', async () => {
        const spy = vi.spyOn(UserAction, 'logActions').mockResolvedValue();
        const query = createFeedQuery('u-impression-contract', 20, false, {
            requestId: 'req-impression-contract',
        });
        attachExperimentContext(query);
        const c1 = makeCandidate(oid('507f191e810c19729de87031'), {
            inNetwork: true,
            isNews: false,
            modelPostId: '507f191e810c19729de87031',
            recallSource: 'FollowingSource',
            score: 2.3,
            weightedScore: 2.7,
        });
        const c2 = makeCandidate(oid('507f191e810c19729de87032'), {
            inNetwork: false,
            isNews: true,
            modelPostId: 'N12345',
            newsMetadata: { externalId: 'N12345' },
            recallSource: 'NewsAnnSource',
            score: 0.9,
            weightedScore: 1.1,
        });

        await new ImpressionLogger().run(query, [c1 as any, c2 as any]);

        expect(spy).toHaveBeenCalledTimes(1);
        const actions = spy.mock.calls[0][0] as any[];
        expect(actions).toHaveLength(2);
        expect(actions[0]).toMatchObject({
            action: ActionType.IMPRESSION,
            requestId: 'req-impression-contract',
            rank: 1,
            score: 2.3,
            weightedScore: 2.7,
            inNetwork: true,
            isNews: false,
            modelPostId: '507f191e810c19729de87031',
            recallSource: 'FollowingSource',
            experimentKeys: ['space_feed_recsys_alignment:treatment'],
            productSurface: 'space_feed',
        });
        expect(actions[1]).toMatchObject({
            action: ActionType.IMPRESSION,
            requestId: 'req-impression-contract',
            rank: 2,
            score: 0.9,
            weightedScore: 1.1,
            inNetwork: false,
            isNews: true,
            modelPostId: 'N12345',
            recallSource: 'NewsAnnSource',
            experimentKeys: ['space_feed_recsys_alignment:treatment'],
            productSurface: 'space_feed',
        });
    });

    it('ServeCacheSideEffect writes delivery fields with rank and model id fallback', async () => {
        const spy = vi.spyOn(UserAction, 'logActions').mockResolvedValue();
        const query = createFeedQuery('u-delivery-contract', 20, false, {
            requestId: 'req-delivery-contract',
        });
        attachExperimentContext(query);
        const c1 = makeCandidate(oid('507f191e810c19729de87041'), {
            inNetwork: true,
            isNews: false,
            modelPostId: '507f191e810c19729de87041',
            recallSource: 'FollowingSource',
            score: 1.8,
            weightedScore: 2.1,
        });
        const c2 = makeCandidate(oid('507f191e810c19729de87042'), {
            inNetwork: false,
            isNews: true,
            modelPostId: undefined,
            newsMetadata: { externalId: 'N67890' },
            recallSource: 'NewsAnnSource',
            score: Number.NaN,
            weightedScore: undefined,
        });

        await new ServeCacheSideEffect().run(query, [c1 as any, c2 as any]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(spy).toHaveBeenCalledTimes(1);
        const actions = spy.mock.calls[0][0] as any[];
        expect(actions).toHaveLength(2);
        expect(actions[0]).toMatchObject({
            action: ActionType.DELIVERY,
            requestId: 'req-delivery-contract',
            rank: 1,
            score: 1.8,
            weightedScore: 2.1,
            inNetwork: true,
            isNews: false,
            modelPostId: '507f191e810c19729de87041',
            recallSource: 'FollowingSource',
            experimentKeys: ['space_feed_recsys_alignment:treatment'],
            productSurface: 'space_feed',
        });
        expect(actions[1]).toMatchObject({
            action: ActionType.DELIVERY,
            requestId: 'req-delivery-contract',
            rank: 2,
            inNetwork: false,
            isNews: true,
            modelPostId: 'N67890',
            recallSource: 'NewsAnnSource',
            experimentKeys: ['space_feed_recsys_alignment:treatment'],
            productSurface: 'space_feed',
        });
        expect(actions[1].score).toBeUndefined();
        expect(actions[1].weightedScore).toBeUndefined();
    });
});
