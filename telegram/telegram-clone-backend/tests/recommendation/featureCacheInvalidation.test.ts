import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => ({
    del: vi.fn(),
    get: vi.fn(),
}));

vi.mock('../../src/config/redis', () => ({
    redis: redisMocks,
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
});
