import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => ({
    del: vi.fn(),
    get: vi.fn(),
    mget: vi.fn(),
    pipeline: vi.fn(),
    setex: vi.fn(),
}));

const realGraphMocks = vi.hoisted(() => ({
    find: vi.fn(),
    getEdgeScore: vi.fn(),
}));

vi.mock('../../src/config/redis', () => ({
    redis: redisMocks,
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    default: realGraphMocks,
}));

import { FeatureCacheService } from '../../src/services/recommendation/FeatureCacheService';

describe('FeatureCacheService invalidation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears L1 and rejects when Redis L2 deletion fails', async () => {
        const service = new FeatureCacheService();
        redisMocks.get.mockResolvedValue(JSON.stringify({
            userId: 'user-1',
            interestedInClusters: [],
            version: 1,
        }));
        await service.getUserEmbedding('user-1');
        expect(service.getCacheStats().l1.userEmbedding).toBe(1);

        const deletionError = new Error('redis delete failed');
        redisMocks.del.mockRejectedValue(deletionError);

        await expect(service.invalidateUserEmbedding('user-1')).rejects.toBe(deletionError);
        expect(redisMocks.del).toHaveBeenCalledWith('fcs:emb:user-1');
        expect(service.getCacheStats().l1.userEmbedding).toBe(0);
    });

    it.each(['not-a-score', ''])(
        'falls back to the database when a single cached edge score is invalid: %s',
        async (cachedScore) => {
            const service = new FeatureCacheService();
            redisMocks.get.mockResolvedValue(cachedScore);
            realGraphMocks.getEdgeScore.mockResolvedValue(0.42);

            await expect(service.getEdgeScore('source-1', 'target-1')).resolves.toBe(0.42);
            expect(realGraphMocks.getEdgeScore).toHaveBeenCalledWith('source-1', 'target-1');
        },
    );

    it('falls back to the database when a batch cached edge score is not finite', async () => {
        const service = new FeatureCacheService();
        redisMocks.mget.mockResolvedValue(['Infinity']);
        realGraphMocks.find.mockReturnValue({
            lean: vi.fn().mockResolvedValue([
                { sourceUserId: 'source-1', targetUserId: 'target-1', decayedSum: 0.73 },
            ]),
        });
        redisMocks.pipeline.mockReturnValue({
            setex: vi.fn(),
            exec: vi.fn().mockResolvedValue([]),
        });

        const result = await service.getEdgeScoresBatch([
            { sourceUserId: 'source-1', targetUserId: 'target-1' },
        ]);

        expect(result.get('source-1:target-1')).toBe(0.73);
        expect(realGraphMocks.find).toHaveBeenCalledWith({
            $or: [{ sourceUserId: 'source-1', targetUserId: 'target-1' }],
        });
    });
});
