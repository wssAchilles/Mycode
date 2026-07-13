import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserFeatureVector, SparseVectorElement } from '../../src/models/UserFeatureVector';

const mocks = vi.hoisted(() => ({
    findOne: vi.fn(),
    upsertEmbedding: vi.fn(),
    redisDel: vi.fn(),
    invalidateFeatureCache: vi.fn(),
    getFeatureCacheInstance: vi.fn(),
}));

vi.mock('../../src/models/UserFeatureVector', () => ({
    default: {
        findOne: mocks.findOne,
        upsertEmbedding: mocks.upsertEmbedding,
    },
    EmbeddingType: {},
}));

vi.mock('../../src/config/redis', () => ({
    redis: {
        del: mocks.redisDel,
    },
}));

vi.mock('../../src/services/recommendation/FeatureCacheService', () => ({
    FeatureCacheService: {
        getInstance: mocks.getFeatureCacheInstance,
    },
}));

import { SimClustersService } from '../../src/services/recommendation/SimClustersService';

const interestedIn: SparseVectorElement[] = [{ clusterId: 11, score: 0.8 }];
const producerEmbedding: SparseVectorElement[] = [{ clusterId: 17, score: 0.6 }];

const storedEmbedding = {
    userId: 'user-1',
    interestedInClusters: interestedIn,
    producerEmbedding,
    knownForCluster: 17,
    knownForScore: 0.6,
    qualityScore: 0.04,
    version: 4,
    computedAt: new Date('2026-07-13T00:00:00.000Z'),
    expiresAt: new Date('2026-08-12T00:00:00.000Z'),
} as IUserFeatureVector;

describe('SimClustersService write boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({ version: 3 }),
        });
        mocks.upsertEmbedding.mockResolvedValue(storedEmbedding);
        mocks.redisDel.mockResolvedValue(1);
        mocks.invalidateFeatureCache.mockResolvedValue(undefined);
        mocks.getFeatureCacheInstance.mockReturnValue({
            invalidateUserEmbedding: mocks.invalidateFeatureCache,
        });
    });

    it('stores sparse fields before invalidating both embedding caches', async () => {
        const service = buildService();

        const result = await service.computeAndStoreEmbedding('user-1');

        expect(result).toBe(storedEmbedding);
        expect(mocks.upsertEmbedding).toHaveBeenCalledWith('user-1', {
            interestedInClusters: interestedIn,
            producerEmbedding,
            knownForCluster: 17,
            knownForScore: 0.6,
            qualityScore: 0.04,
        }, 4);
        const write = mocks.upsertEmbedding.mock.calls[0][1] as Record<string, unknown>;
        expect(write).not.toHaveProperty('twoTowerEmbedding');
        expect(write).not.toHaveProperty('twoTowerEmbeddingContract');
        expect(write).not.toHaveProperty('phoenixEmbedding');
        expect(write).not.toHaveProperty('phoenixEmbeddingContract');
        expect(write).not.toHaveProperty('embeddingContract');
        expect(mocks.redisDel).toHaveBeenCalledWith('sc:embed:user-1');
        expect(mocks.invalidateFeatureCache).toHaveBeenCalledWith('user-1');
        expect(mocks.upsertEmbedding.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.redisDel.mock.invocationCallOrder[0]);
        expect(mocks.upsertEmbedding.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.invalidateFeatureCache.mock.invocationCallOrder[0]);
    });

    it.each(['simclusters', 'feature-cache'] as const)(
        'returns the stored embedding and attempts both invalidations when %s invalidation rejects',
        async (failure) => {
            if (failure === 'simclusters') {
                mocks.redisDel.mockRejectedValue(new Error('redis unavailable'));
            } else {
                mocks.invalidateFeatureCache.mockRejectedValue(new Error('feature cache unavailable'));
            }
            const service = buildService();

            const result = await service.computeAndStoreEmbedding('user-1');

            expect(result).toBe(storedEmbedding);
            expect(mocks.redisDel).toHaveBeenCalledWith('sc:embed:user-1');
            expect(mocks.invalidateFeatureCache).toHaveBeenCalledWith('user-1');
        },
    );
});

function buildService(): SimClustersService {
    const service = new SimClustersService();
    vi.spyOn(service, 'computeInterestedIn').mockResolvedValue(interestedIn);
    vi.spyOn(service, 'computeProducerEmbedding').mockResolvedValue(producerEmbedding);
    return service;
}
