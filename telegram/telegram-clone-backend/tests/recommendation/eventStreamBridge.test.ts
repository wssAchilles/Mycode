import { afterEach, describe, expect, it, vi } from 'vitest';

import UserAction, { ActionType } from '../../src/models/UserAction';
import UserSignal, { ProductSurface, SignalType, TargetType } from '../../src/models/UserSignal';
import EventStreamService, { type UserBehaviorEvent } from '../../src/services/eventStreamService';

describe('EventStreamService recommendation bridge', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('flushes small analytics batches on the timer so recommendation feedback is not stuck in memory', async () => {
        vi.useFakeTimers();
        const service = new EventStreamService();
        const flushSpy = vi.spyOn(service, 'flush').mockResolvedValue();

        await service.logBatch([
            {
                type: 'impression',
                userId: 'user-1',
                postId: '65f000000000000000000001',
                timestamp: new Date('2026-06-06T00:00:00.000Z'),
                metadata: {
                    requestId: 'req-small-batch',
                    position: 0,
                    recommendationScore: 0.42,
                    source: 'ColdStartSource',
                    selectionPool: 'primary',
                    selectionReason: 'timer_flush_contract',
                },
            },
        ]);

        expect(flushSpy).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5000);

        expect(flushSpy).toHaveBeenCalledTimes(1);
    });

    it('writes recommendation attribution fields into UserAction and UserSignal', async () => {
        const actionSpy = vi.spyOn(UserAction, 'logActions').mockResolvedValue();
        const signalSpy = vi.spyOn(UserSignal, 'logSignalsBatch').mockResolvedValue();
        const service = new EventStreamService();
        const events: UserBehaviorEvent[] = [
            {
                type: 'click',
                userId: 'user-1',
                postId: '65f000000000000000000001',
                timestamp: new Date('2026-06-06T00:00:00.000Z'),
                metadata: {
                    requestId: 'req-feed-1',
                    position: 2,
                    recommendationScore: 0.42,
                    source: 'ColdStartSource',
                    selectionPool: 'exploration',
                    selectionReason: 'bandit_or_novelty_exploration',
                    experimentId: 'exp-recsys',
                    bucketId: 'treatment',
                },
            },
            {
                type: 'dwell',
                userId: 'user-1',
                postId: '65f000000000000000000002',
                timestamp: new Date('2026-06-06T00:00:03.000Z'),
                metadata: {
                    requestId: 'req-feed-1',
                    position: 3,
                    recommendationScore: 0.31,
                    source: 'GraphSource',
                    dwellTime: 3500,
                },
            },
        ];

        await (service as any).bridgeToRecommendationPipeline(events);

        expect(actionSpy).toHaveBeenCalledTimes(1);
        const actions = actionSpy.mock.calls[0][0] as any[];
        expect(actions[0]).toMatchObject({
            userId: 'user-1',
            action: ActionType.CLICK,
            requestId: 'req-feed-1',
            rank: 3,
            score: 0.42,
            recallSource: 'ColdStartSource',
            selectionPool: 'exploration',
            selectionReason: 'bandit_or_novelty_exploration',
            productSurface: ProductSurface.SPACE_FEED,
            experimentKeys: ['exp-recsys:treatment'],
        });
        expect(String(actions[0].targetPostId)).toBe('65f000000000000000000001');
        expect(actions[1]).toMatchObject({
            action: ActionType.DWELL,
            requestId: 'req-feed-1',
            rank: 4,
            score: 0.31,
            recallSource: 'GraphSource',
            dwellTimeMs: 3500,
            productSurface: ProductSurface.SPACE_FEED,
        });
        expect(String(actions[1].targetPostId)).toBe('65f000000000000000000002');

        expect(signalSpy).toHaveBeenCalledTimes(1);
        const signals = signalSpy.mock.calls[0][0] as any[];
        expect(signals[0]).toMatchObject({
            signalType: SignalType.TWEET_CLICK,
            targetId: '65f000000000000000000001',
            targetType: TargetType.POST,
            productSurface: ProductSurface.SPACE_FEED,
            requestId: 'req-feed-1',
            metadata: {
                recommendationPosition: 3,
                recommendationSource: 'ColdStartSource',
                recommendationScore: 0.42,
                selectionPool: 'exploration',
            },
        });
    });

    it('maps negative feedback and skips invalid post events without blocking valid events', async () => {
        const actionSpy = vi.spyOn(UserAction, 'logActions').mockResolvedValue();
        const signalSpy = vi.spyOn(UserSignal, 'logSignalsBatch').mockResolvedValue();
        const service = new EventStreamService();
        const events: UserBehaviorEvent[] = [
            {
                type: 'dismiss',
                userId: 'user-2',
                postId: '65f000000000000000000003',
                timestamp: new Date('2026-06-06T00:00:00.000Z'),
                metadata: {
                    requestId: 'req-feed-2',
                    position: 0,
                    source: 'NewsAnnSource',
                },
            },
            {
                type: 'report',
                userId: 'user-2',
                postId: 'not-a-mongo-id',
                timestamp: new Date('2026-06-06T00:00:01.000Z'),
                metadata: {
                    requestId: 'req-feed-2',
                },
            },
            {
                type: 'block',
                userId: 'user-2',
                postId: '__user__',
                timestamp: new Date('2026-06-06T00:00:02.000Z'),
                metadata: {
                    requestId: 'req-feed-2',
                    authorId: 'author-9',
                },
            },
        ];

        await (service as any).bridgeToRecommendationPipeline(events);

        const actions = actionSpy.mock.calls[0][0] as any[];
        expect(actions).toHaveLength(2);
        expect(actions[0]).toMatchObject({
            action: ActionType.DISMISS,
            requestId: 'req-feed-2',
            rank: 1,
            recallSource: 'NewsAnnSource',
            productSurface: ProductSurface.SPACE_FEED,
        });
        expect(String(actions[0].targetPostId)).toBe('65f000000000000000000003');
        expect(actions[1]).toMatchObject({
            action: ActionType.BLOCK_AUTHOR,
            targetAuthorId: 'author-9',
            targetPostId: undefined,
            requestId: 'req-feed-2',
            productSurface: ProductSurface.SPACE_FEED,
        });

        const signals = signalSpy.mock.calls[0][0] as any[];
        expect(signals.map((signal) => signal.signalType)).toEqual([
            SignalType.DISMISS_POST,
            SignalType.BLOCK,
        ]);
    });

    it('bridges profile, search, topic, and link events with non-post target types', async () => {
        const actionSpy = vi.spyOn(UserAction, 'logActions').mockResolvedValue();
        const signalSpy = vi.spyOn(UserSignal, 'logSignalsBatch').mockResolvedValue();
        const service = new EventStreamService();
        const events: UserBehaviorEvent[] = [
            {
                type: 'profile_click',
                userId: 'user-3',
                postId: '65f000000000000000000004',
                timestamp: new Date('2026-06-06T00:00:00.000Z'),
                metadata: {
                    authorId: 'author-profile-1',
                    requestId: 'req-intent-1',
                    position: 1,
                },
            },
            {
                type: 'search_query',
                userId: 'user-3',
                postId: '__search__',
                timestamp: new Date('2026-06-06T00:00:01.000Z'),
                metadata: {
                    searchQuery: '  recsys ranking  ',
                    productSurface: ProductSurface.EXPLORE,
                },
            },
            {
                type: 'hashtag_click',
                userId: 'user-3',
                postId: '#Growth',
                timestamp: new Date('2026-06-06T00:00:02.000Z'),
                metadata: {
                    hashtag: '#Growth',
                    productSurface: ProductSurface.EXPLORE,
                },
            },
            {
                type: 'open_link',
                userId: 'user-3',
                postId: '65f000000000000000000005',
                timestamp: new Date('2026-06-06T00:00:03.000Z'),
                metadata: {
                    authorId: 'author-link-1',
                    url: 'https://example.com/recsys',
                    requestId: 'req-intent-1',
                },
            },
        ];

        await (service as any).bridgeToRecommendationPipeline(events);

        const actions = actionSpy.mock.calls[0][0] as any[];
        expect(actions.map((action) => action.action)).toEqual([
            ActionType.PROFILE_CLICK,
            ActionType.SEARCH_QUERY,
            ActionType.HASHTAG_CLICK,
            ActionType.OPEN_LINK,
        ]);
        expect(actions[1]).toMatchObject({
            targetPostId: undefined,
            targetKeywords: ['recsys ranking'],
            productSurface: ProductSurface.EXPLORE,
        });
        expect(actions[2]).toMatchObject({
            targetPostId: undefined,
            targetKeywords: ['growth'],
            productSurface: ProductSurface.EXPLORE,
        });
        expect(actions[3]).toMatchObject({
            targetAuthorId: 'author-link-1',
            targetUrl: 'https://example.com/recsys',
            productSurface: ProductSurface.EXTERNAL,
        });
        expect(String(actions[3].targetPostId)).toBe('65f000000000000000000005');

        const signals = signalSpy.mock.calls[0][0] as any[];
        expect(signals).toMatchObject([
            {
                signalType: SignalType.PROFILE_CLICK,
                targetId: 'author-profile-1',
                targetType: TargetType.USER,
            },
            {
                signalType: SignalType.SEARCH_QUERY,
                targetId: 'recsys ranking',
                targetType: TargetType.SEARCH_QUERY,
                metadata: {
                    searchQuery: 'recsys ranking',
                    targetKeywords: ['recsys ranking'],
                },
            },
            {
                signalType: SignalType.HASHTAG_CLICK,
                targetId: 'growth',
                targetType: TargetType.TOPIC,
                metadata: {
                    hashtag: 'growth',
                    targetKeywords: ['growth'],
                },
            },
            {
                signalType: SignalType.OPEN_LINK,
                targetId: '65f000000000000000000005',
                targetType: TargetType.POST,
                targetAuthorId: 'author-link-1',
                metadata: {
                    targetUrl: 'https://example.com/recsys',
                },
            },
        ]);
    });

    it('bridges recommendation events even when Redis is unavailable', async () => {
        const actionSpy = vi.spyOn(UserAction, 'logActions').mockResolvedValue();
        const signalSpy = vi.spyOn(UserSignal, 'logSignalsBatch').mockResolvedValue();
        const service = new EventStreamService();
        (service as any).redis = null;

        await service.logBatch([
            {
                type: 'search_query',
                userId: 'user-4',
                postId: '__search__',
                timestamp: new Date('2026-06-06T00:00:00.000Z'),
                metadata: {
                    searchQuery: 'home mixer',
                },
            },
        ]);
        await service.flush();

        expect(actionSpy).toHaveBeenCalledTimes(1);
        expect(signalSpy).toHaveBeenCalledTimes(1);
        expect((actionSpy.mock.calls[0][0] as any[])[0]).toMatchObject({
            action: ActionType.SEARCH_QUERY,
            targetKeywords: ['home mixer'],
        });
    });
});
