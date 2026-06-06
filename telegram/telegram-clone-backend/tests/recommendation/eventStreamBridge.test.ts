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
            targetPostId: '65f000000000000000000001',
            requestId: 'req-feed-1',
            rank: 3,
            score: 0.42,
            recallSource: 'ColdStartSource',
            selectionPool: 'exploration',
            selectionReason: 'bandit_or_novelty_exploration',
            productSurface: ProductSurface.SPACE_FEED,
            experimentKeys: ['exp-recsys:treatment'],
        });
        expect(actions[1]).toMatchObject({
            action: ActionType.DWELL,
            targetPostId: '65f000000000000000000002',
            requestId: 'req-feed-1',
            rank: 4,
            score: 0.31,
            recallSource: 'GraphSource',
            dwellTimeMs: 3500,
            productSurface: ProductSurface.SPACE_FEED,
        });

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
                type: 'mute',
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
            targetPostId: '65f000000000000000000003',
            requestId: 'req-feed-2',
            rank: 1,
            recallSource: 'NewsAnnSource',
            productSurface: ProductSurface.SPACE_FEED,
        });
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
            SignalType.MUTE,
        ]);
    });
});
