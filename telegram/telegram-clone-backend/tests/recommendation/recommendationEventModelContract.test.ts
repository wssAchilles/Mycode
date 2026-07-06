import { afterEach, describe, expect, it, vi } from 'vitest';

import UserAction, { ActionType } from '../../src/models/UserAction';
import UserSignal, {
    ProductSurface,
    SignalType,
    TargetType,
} from '../../src/models/UserSignal';

describe('recommendation event model idempotency contract', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses partial unique indexes for recommendation event keys', () => {
        expect(UserAction.schema.indexes()).toContainEqual([
            { 'metadata.recommendationEventKey': 1 },
            expect.objectContaining({
                unique: true,
                name: 'uniq_recommendation_event_key',
                partialFilterExpression: {
                    'metadata.recommendationEventKey': { $type: 'string', $gt: '' },
                },
            }),
        ]);

        expect(UserSignal.schema.indexes()).toContainEqual([
            { 'metadata.recommendationEventKey': 1 },
            expect.objectContaining({
                unique: true,
                name: 'uniq_recommendation_signal_event_key',
                partialFilterExpression: {
                    'metadata.recommendationEventKey': { $type: 'string', $gt: '' },
                },
            }),
        ]);
    });

    it('upserts keyed user actions without changing unkeyed append behavior', async () => {
        const bulkWrite = vi.spyOn(UserAction, 'bulkWrite').mockResolvedValue({} as any);
        const insertMany = vi.spyOn(UserAction, 'insertMany').mockResolvedValue([] as any);

        await UserAction.logActions([
            {
                userId: 'user_1',
                action: ActionType.IMPRESSION,
                productSurface: 'space_feed',
                metadata: { recommendationEventKey: 'evt_1' },
            },
            {
                userId: 'user_1',
                action: ActionType.CLICK,
                productSurface: 'space_feed',
            },
        ]);

        expect(bulkWrite).toHaveBeenCalledWith([
            {
                updateOne: {
                    filter: { 'metadata.recommendationEventKey': 'evt_1' },
                    update: {
                        $setOnInsert: expect.objectContaining({
                            userId: 'user_1',
                            action: ActionType.IMPRESSION,
                            metadata: { recommendationEventKey: 'evt_1' },
                        }),
                    },
                    upsert: true,
                },
            },
        ], { ordered: false });
        expect(insertMany).toHaveBeenCalledWith([
            expect.objectContaining({
                userId: 'user_1',
                action: ActionType.CLICK,
            }),
        ]);
    });

    it('returns only newly inserted keyed signals for downstream side effects', async () => {
        vi.spyOn(UserSignal, 'find').mockReturnValue({
            lean: vi.fn().mockResolvedValue([
                { metadata: { recommendationEventKey: 'evt_existing' } },
            ]),
        } as any);
        const bulkWrite = vi.spyOn(UserSignal, 'bulkWrite').mockResolvedValue({} as any);
        const insertMany = vi.spyOn(UserSignal, 'insertMany').mockResolvedValue([] as any);

        const result = await UserSignal.logSignalsBatch([
            {
                userId: 'user_1',
                signalType: SignalType.TWEET_CLICK,
                targetId: 'post_1',
                targetType: TargetType.POST,
                productSurface: ProductSurface.SPACE_FEED,
                metadata: { recommendationEventKey: 'evt_existing' },
            },
            {
                userId: 'user_1',
                signalType: SignalType.IMPRESSION,
                targetId: 'post_2',
                targetType: TargetType.POST,
                productSurface: ProductSurface.SPACE_FEED,
                metadata: { recommendationEventKey: 'evt_new' },
            },
        ]);

        expect(bulkWrite).toHaveBeenCalledTimes(1);
        expect(insertMany).not.toHaveBeenCalled();
        expect(result.insertedSignals).toHaveLength(1);
        expect(result.insertedSignals[0]).toMatchObject({
            targetId: 'post_2',
            metadata: { recommendationEventKey: 'evt_new' },
        });
    });
});
