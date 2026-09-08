import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    redisDel: vi.fn(),
    redisGet: vi.fn(),
    redisSetex: vi.fn(),
    recordInteraction: vi.fn(),
    bulkWrite: vi.fn(),
    getEdgeScore: vi.fn(),
    applyDailyDecay: vi.fn(),
    find: vi.fn(),
    deleteMany: vi.fn(),
}));

vi.mock('../../src/config/redis', () => ({
    redis: {
        del: mocks.redisDel,
        get: mocks.redisGet,
        setex: mocks.redisSetex,
    },
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    default: {
        recordInteraction: mocks.recordInteraction,
        bulkWrite: mocks.bulkWrite,
        getEdgeScore: mocks.getEdgeScore,
        applyDailyDecay: mocks.applyDailyDecay,
        find: mocks.find,
        deleteMany: mocks.deleteMany,
    },
    InteractionType: {
        FOLLOW: 'follow',
        LIKE: 'like',
        REPLY: 'reply',
        RETWEET: 'retweet',
        QUOTE: 'quote',
        MENTION: 'mention',
        PROFILE_VIEW: 'profile_view',
        TWEET_CLICK: 'tweet_click',
        DWELL: 'dwell',
        ADDRESS_BOOK: 'address_book',
        DIRECT_MESSAGE: 'direct_message',
        CO_ENGAGEMENT: 'co_engagement',
        CONTENT_AFFINITY: 'content_affinity',
        MUTE: 'mute',
        BLOCK: 'block',
        UNFOLLOW: 'unfollow',
        REPORT: 'report',
    },
    DECAY_CONFIG: { minRetainScore: 0.01 },
    REALGRAPH_FEATURE_VERSION: 'test-feature',
    REALGRAPH_MODEL_VERSION: 'test-model',
    REALGRAPH_PREDICTION_MODE: 'heuristic',
}));

vi.mock('../../src/models/UserFeatureVector', () => ({ default: {} }));
vi.mock('../../src/models/ClusterDefinition', () => ({ default: {} }));

import { DECAY_CONFIG, InteractionType } from '../../src/models/RealGraphEdge';
import { FeatureCacheService } from '../../src/services/recommendation/FeatureCacheService';
import { RealGraphService } from '../../src/services/recommendation/RealGraphService';

describe('RealGraph and FeatureCache consistency', () => {
    const featureCacheService = FeatureCacheService.getInstance();

    beforeEach(() => {
        vi.clearAllMocks();
        featureCacheService.clearL1Cache();
        mocks.redisGet.mockResolvedValue(null);
        mocks.redisDel.mockResolvedValue(1);
        mocks.redisSetex.mockResolvedValue('OK');
        mocks.bulkWrite.mockResolvedValue({});
        mocks.applyDailyDecay.mockReset();
        mocks.find.mockReset();
        mocks.deleteMany.mockReset();
    });

    it('invalidates a warmed FeatureCache edge after a single interaction write', async () => {
        mocks.getEdgeScore
            .mockResolvedValueOnce(0.25)
            .mockResolvedValueOnce(0.91);
        await expect(featureCacheService.getEdgeScore('source-1', 'target-1')).resolves.toBe(0.25);
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(1);

        mocks.recordInteraction.mockResolvedValue({});
        const service = new RealGraphService();
        vi.spyOn(service as any, 'writePredictionMetadata').mockResolvedValue(undefined);

        await service.recordInteraction('source-1', 'target-1', InteractionType.LIKE);

        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith('rg:score:source-1:target-1');
        expect(mocks.redisDel).toHaveBeenCalledWith('fcs:rg:source-1:target-1');
        await expect(featureCacheService.getEdgeScore('source-1', 'target-1')).resolves.toBe(0.91);
        expect(mocks.getEdgeScore).toHaveBeenCalledTimes(2);
    });

    it('exposes cache invalidation for direct edge writes', async () => {
        await featureCacheService.getEdgeScore('source-direct', 'target-direct');
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(1);

        await new RealGraphService().invalidateEdgeScoreCaches('source-direct', 'target-direct');

        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith('rg:score:source-direct:target-direct');
        expect(mocks.redisDel).toHaveBeenCalledWith('fcs:rg:source-direct:target-direct');
    });

    it('invalidates each distinct FeatureCache edge after a batch write', async () => {
        mocks.getEdgeScore
            .mockResolvedValueOnce(0.25)
            .mockResolvedValueOnce(0.5);
        await featureCacheService.getEdgeScore('source-1', 'target-1');
        await featureCacheService.getEdgeScore('source-2', 'target-2');
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(2);

        const service = new RealGraphService();
        vi.spyOn(service as any, 'recomputePredictionMetadataForPairs').mockResolvedValue(undefined);

        await service.recordInteractionsBatch([
            { sourceUserId: 'source-1', targetUserId: 'target-1', interactionType: InteractionType.LIKE },
            { sourceUserId: 'source-1', targetUserId: 'target-1', interactionType: InteractionType.REPLY },
            { sourceUserId: 'source-2', targetUserId: 'target-2', interactionType: InteractionType.LIKE },
        ]);

        expect(mocks.redisDel).toHaveBeenCalledWith(
            'fcs:rg:source-1:target-1',
            'fcs:rg:source-2:target-2',
        );
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
    });

    it('invalidates the single-write cache when metadata persistence fails', async () => {
        await featureCacheService.getEdgeScore('source-3', 'target-3');
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(1);

        const service = new RealGraphService();
        const metadataError = new Error('metadata write failed');
        vi.spyOn(service as any, 'writePredictionMetadata').mockRejectedValue(metadataError);
        mocks.recordInteraction.mockResolvedValue({});

        await expect(service.recordInteraction('source-3', 'target-3', InteractionType.LIKE))
            .rejects.toBe(metadataError);
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith('fcs:rg:source-3:target-3');
    });

    it('invalidates the batch cache when metadata recomputation fails', async () => {
        await featureCacheService.getEdgeScore('source-4', 'target-4');
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(1);

        const service = new RealGraphService();
        const metadataError = new Error('metadata recompute failed');
        vi.spyOn(service as any, 'recomputePredictionMetadataForPairs').mockRejectedValue(metadataError);

        await expect(service.recordInteractionsBatch([
            { sourceUserId: 'source-4', targetUserId: 'target-4', interactionType: InteractionType.LIKE },
        ])).rejects.toBe(metadataError);
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith('fcs:rg:source-4:target-4');
    });

    it('invalidates only the edges reported as successfully decayed', async () => {
        await featureCacheService.getEdgeScore('source-6', 'target-6');
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(1);

        mocks.applyDailyDecay
            .mockImplementationOnce(async (
                _batchSize: number,
                _signal: AbortSignal | undefined,
                onProcessed: (pair: { sourceUserId: string; targetUserId: string }) => void,
            ) => {
                onProcessed({ sourceUserId: 'source-6', targetUserId: 'target-6' });
                return 1;
            })
            .mockResolvedValueOnce(0);

        await expect(new RealGraphService().applyDailyDecay()).resolves.toEqual({
            totalProcessed: 1,
            batches: 1,
            errors: 0,
        });
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith('fcs:rg:source-6:target-6');
    });

    it('invalidates caches for stale edges removed by cleanup', async () => {
        await featureCacheService.getEdgeScore('source-7', 'target-7');
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(1);

        const staleEdge = {
            _id: 'edge-7',
            sourceUserId: 'source-7',
            targetUserId: 'target-7',
        };
        mocks.find.mockReturnValue({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockReturnThis(),
            setOptions: vi.fn().mockResolvedValue([staleEdge]),
        });
        mocks.deleteMany.mockResolvedValue({ deletedCount: 1 });

        await expect(new RealGraphService().cleanupStaleEdges()).resolves.toBe(1);

        expect(mocks.deleteMany).toHaveBeenCalledWith(
            { _id: { $in: ['edge-7'] } },
            expect.objectContaining({ signal: undefined }),
        );
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith('rg:score:source-7:target-7');
        expect(mocks.redisDel).toHaveBeenCalledWith('fcs:rg:source-7:target-7');
    });

    it('invalidates cleanup caches before propagating an abort after deletion', async () => {
        await featureCacheService.getEdgeScore('source-8', 'target-8');
        const controller = new AbortController();
        const staleEdge = {
            _id: 'edge-8',
            sourceUserId: 'source-8',
            targetUserId: 'target-8',
        };
        mocks.find.mockReturnValue({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn().mockReturnThis(),
            setOptions: vi.fn().mockResolvedValue([staleEdge]),
        });
        mocks.deleteMany.mockImplementation(async () => {
            controller.abort();
            return { deletedCount: 1 };
        });

        await expect(new RealGraphService().cleanupStaleEdges(
            DECAY_CONFIG.minRetainScore,
            90,
            controller.signal,
        )).rejects.toMatchObject({ name: 'AbortError' });
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith('rg:score:source-8:target-8');
        expect(mocks.redisDel).toHaveBeenCalledWith('fcs:rg:source-8:target-8');
    });
});
