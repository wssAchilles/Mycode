import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    userActionBulkWrite: vi.fn(),
    userActionInsertMany: vi.fn(),
    userSignalFind: vi.fn(),
    userSignalBulkWrite: vi.fn(),
    userSignalInsertMany: vi.fn(),
    realGraphRecordInteractionsBatch: vi.fn(),
    redisDel: vi.fn(),
}));

vi.mock('../../src/models/UserAction', () => ({
    ActionType: {
        LIKE: 'like',
        REPLY: 'reply',
        REPOST: 'repost',
        QUOTE: 'quote',
        CLICK: 'click',
        PROFILE_CLICK: 'profile_click',
        SHARE: 'share',
        OPEN_LINK: 'open_link',
        HASHTAG_CLICK: 'hashtag_click',
        SEARCH_QUERY: 'search_query',
        IMPRESSION: 'impression',
        DELIVERY: 'delivery',
        DISMISS: 'dismiss',
        HIDE: 'hide',
        BLOCK_AUTHOR: 'block_author',
        REPORT: 'report',
        DWELL: 'dwell',
    },
    default: {
        bulkWrite: mocks.userActionBulkWrite,
        insertMany: mocks.userActionInsertMany,
        logActions: async (actions: any[]) => {
            const docs = actions.map((action) => ({
                ...action,
                timestamp: action.timestamp || new Date(),
            }));
            const keyedDocs = docs.filter((doc) => doc.metadata?.recommendationEventKey);
            const unkeyedDocs = docs.filter((doc) => !doc.metadata?.recommendationEventKey);

            if (keyedDocs.length > 0) {
                const dedupedDocs = Array.from(
                    new Map(keyedDocs.map((doc) => [doc.metadata.recommendationEventKey, doc])).values(),
                );
                await mocks.userActionBulkWrite(
                    dedupedDocs.map((doc: any) => ({
                        updateOne: {
                            filter: { 'metadata.recommendationEventKey': doc.metadata.recommendationEventKey },
                            update: { $setOnInsert: doc },
                            upsert: true,
                        },
                    })),
                    { ordered: false },
                );
            }
            if (unkeyedDocs.length > 0) {
                await mocks.userActionInsertMany(unkeyedDocs);
            }
        },
    },
}));

vi.mock('../../src/models/UserSignal', () => ({
    ProductSurface: {
        HOME_FEED: 'home_feed',
        SPACE_FEED: 'space_feed',
        NEWS_FEED: 'news_feed',
        SEARCH: 'search',
        PROFILE: 'profile',
        NOTIFICATIONS: 'notifications',
        EXPLORE: 'explore',
        MOMENTS: 'moments',
        LISTS: 'lists',
        BOOKMARKS: 'bookmarks',
        DIRECT_MESSAGE: 'dm',
        EXTERNAL: 'external',
    },
    SignalType: {
        IMPRESSION: 'impression',
        TWEET_CLICK: 'tweet_click',
    },
    TargetType: {
        POST: 'post',
        USER: 'user',
        TOPIC: 'topic',
        LIST: 'list',
        NOTIFICATION: 'notification',
        SEARCH_QUERY: 'search_query',
    },
    default: {
        find: mocks.userSignalFind,
        bulkWrite: mocks.userSignalBulkWrite,
        insertMany: mocks.userSignalInsertMany,
        logSignalsBatch: async (signals: any[]) => {
            const docs = signals.map((signal) => ({ ...signal, expiresAt: new Date() }));
            const keyedDocs = docs.filter((doc) => doc.metadata?.recommendationEventKey);
            const unkeyedDocs = docs.filter((doc) => !doc.metadata?.recommendationEventKey);
            let newKeyedDocs = keyedDocs;

            if (keyedDocs.length > 0) {
                const dedupedDocs = Array.from(
                    new Map(keyedDocs.map((doc) => [doc.metadata.recommendationEventKey, doc])).values(),
                );
                const eventKeys = dedupedDocs.map((doc: any) => doc.metadata.recommendationEventKey);
                const existingDocs = await mocks.userSignalFind(
                    { 'metadata.recommendationEventKey': { $in: eventKeys } },
                    { 'metadata.recommendationEventKey': 1 },
                ).lean();
                const existingKeys = new Set(existingDocs.map((doc: any) => doc.metadata?.recommendationEventKey));
                newKeyedDocs = dedupedDocs.filter((doc: any) => !existingKeys.has(doc.metadata.recommendationEventKey));
                await mocks.userSignalBulkWrite(
                    dedupedDocs.map((doc: any) => ({
                        updateOne: {
                            filter: { 'metadata.recommendationEventKey': doc.metadata.recommendationEventKey },
                            update: { $setOnInsert: doc },
                            upsert: true,
                        },
                    })),
                    { ordered: false },
                );
            }
            if (unkeyedDocs.length > 0) {
                await mocks.userSignalInsertMany(unkeyedDocs, { ordered: false });
            }
            return { insertedSignals: [...newKeyedDocs, ...unkeyedDocs] };
        },
    },
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    InteractionType: {
        TWEET_CLICK: 'tweet_click',
    },
    default: {},
}));

vi.mock('../../src/services/recommendation/RealGraphService', () => ({
    realGraphService: {
        recordInteractionsBatch: mocks.realGraphRecordInteractionsBatch,
    },
}));

vi.mock('../../src/config/redis', () => ({
    redis: {
        del: mocks.redisDel,
    },
}));

import { recordRecommendationEvents } from '../../src/services/recommendation/events/recordRecommendationEvent';
import { buildRecommendationEventKey } from '../../src/services/recommendation/events/types';

describe('recommendation event idempotency', () => {
    beforeEach(() => {
        mocks.userSignalFind.mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('builds client-provided event keys before fallback keys', () => {
        expect(buildRecommendationEventKey({
            clientEventId: ' evt_space_1 ',
            userId: 'user_1',
            eventType: 'impression',
            targetId: 'post_1',
        })).toBe('evt_space_1');

        expect(buildRecommendationEventKey({
            userId: 'user_1',
            eventType: 'impression',
            targetId: 'post_1',
            requestId: 'req_1',
            rank: 1,
        })).toBe('user_1:impression:post_1:req_1:1');

        expect(buildRecommendationEventKey({
            userId: 'user_1',
            eventType: 'click',
            targetId: 'post_1',
            occurredAt: new Date('2026-07-06T00:00:00.000Z'),
        })).toBe('user_1:click:post_1:no_request:no_rank:2026-07-06T00:00:00.000Z');
    });

    it('upserts durable actions and signals by recommendation event key', async () => {
        const event = {
            clientEventId: 'evt_space_1',
            userId: 'user_1',
            eventType: 'impression',
            targetType: 'post',
            targetId: '65f000000000000000000001',
            productSurface: 'space_feed',
            requestId: 'req_1',
            servedPosition: 1,
            positionContractVersion: 'served_position_1_based_v1',
            score: 0.5,
            recommendationSource: 'GraphSource',
            occurredAt: new Date('2026-07-06T00:00:00.000Z'),
        } as const;

        await recordRecommendationEvents([event, event]);

        expect(mocks.userActionBulkWrite).toHaveBeenCalledTimes(1);
        expect(mocks.userActionBulkWrite.mock.calls[0][0]).toHaveLength(1);
        expect(mocks.userActionBulkWrite.mock.calls[0][0][0]).toMatchObject({
            updateOne: {
                filter: { 'metadata.recommendationEventKey': 'evt_space_1' },
                update: {
                    $setOnInsert: {
                        metadata: {
                            clientEventId: 'evt_space_1',
                            recommendationEventKey: 'evt_space_1',
                        },
                    },
                },
                upsert: true,
            },
        });

        expect(mocks.userSignalBulkWrite).toHaveBeenCalledTimes(1);
        expect(mocks.userSignalBulkWrite.mock.calls[0][0]).toHaveLength(1);
        expect(mocks.userSignalBulkWrite.mock.calls[0][0][0]).toMatchObject({
            updateOne: {
                filter: { 'metadata.recommendationEventKey': 'evt_space_1' },
                update: {
                    $setOnInsert: {
                        metadata: {
                            clientEventId: 'evt_space_1',
                            recommendationEventKey: 'evt_space_1',
                        },
                    },
                },
                upsert: true,
            },
        });
        expect(mocks.userActionInsertMany).not.toHaveBeenCalled();
        expect(mocks.userSignalInsertMany).not.toHaveBeenCalled();
    });

    it('does not collapse distinct fallback events that lack serving anchors', () => {
        expect(buildRecommendationEventKey({
            userId: 'user_1',
            eventType: 'click',
            targetId: 'post_1',
            occurredAt: new Date('2026-07-06T00:00:00.000Z'),
        })).not.toBe(buildRecommendationEventKey({
            userId: 'user_1',
            eventType: 'click',
            targetId: 'post_1',
            occurredAt: new Date('2026-07-06T00:00:01.000Z'),
        }));
    });

    it('does not replay RealGraph side effects for already persisted signal event keys', async () => {
        mocks.userSignalFind.mockReturnValue({
            lean: vi.fn().mockResolvedValue([
                { metadata: { recommendationEventKey: 'evt_space_click_1' } },
            ]),
        });

        await recordRecommendationEvents([{
            clientEventId: 'evt_space_click_1',
            userId: 'user_1',
            eventType: 'click',
            targetType: 'post',
            targetId: '65f000000000000000000001',
            targetAuthorId: 'author_1',
            productSurface: 'space_feed',
            requestId: 'req_1',
            servedPosition: 1,
            positionContractVersion: 'served_position_1_based_v1',
            occurredAt: new Date('2026-07-06T00:00:00.000Z'),
        }]);

        expect(mocks.userSignalBulkWrite).toHaveBeenCalledTimes(1);
        expect(mocks.realGraphRecordInteractionsBatch).not.toHaveBeenCalled();
    });

    it('persists an internal 1-based position without converting it again', async () => {
        await recordRecommendationEvents([{
            userId: 'user_1',
            eventType: 'impression',
            targetType: 'post',
            targetId: '65f000000000000000000001',
            productSurface: 'space_feed',
            requestId: 'req_position_1',
            servedPosition: 1,
            positionContractVersion: 'served_position_1_based_v1',
            occurredAt: new Date('2026-07-06T00:00:00.000Z'),
        }]);

        const action = mocks.userActionBulkWrite.mock.calls[0][0][0].updateOne.update.$setOnInsert;
        const signal = mocks.userSignalBulkWrite.mock.calls[0][0][0].updateOne.update.$setOnInsert;
        expect(action).toMatchObject({
            rank: 1,
            metadata: {
                recommendationEventKey: 'user_1:impression:65f000000000000000000001:req_position_1:1',
                positionContractVersion: 'served_position_1_based_v1',
            },
        });
        expect(signal.metadata).toMatchObject({
            recommendationPosition: 1,
            recommendationEventKey: 'user_1:impression:65f000000000000000000001:req_position_1:1',
            positionContractVersion: 'served_position_1_based_v1',
        });
    });
});
