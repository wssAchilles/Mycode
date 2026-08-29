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

const userFeatureMocks = vi.hoisted(() => ({
    getUserEmbeddingsBatch: vi.fn(),
}));

const clusterMocks = vi.hoisted(() => ({
    getClustersBatch: vi.fn(),
}));

vi.mock('../../src/config/redis', () => ({
    redis: redisMocks,
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    default: realGraphMocks,
}));

vi.mock('../../src/models/UserFeatureVector', () => ({
    default: userFeatureMocks,
}));

vi.mock('../../src/models/ClusterDefinition', () => ({
    default: clusterMocks,
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

    it.each(['not-a-score', '', '0x10', '0b10'])(
        'falls back to the database when a single cached edge score is invalid: %s',
        async (cachedScore) => {
            const service = new FeatureCacheService();
            redisMocks.get.mockResolvedValue(cachedScore);
            realGraphMocks.getEdgeScore.mockResolvedValue(0.42);

            await expect(service.getEdgeScore('source-1', 'target-1')).resolves.toBe(0.42);
            expect(realGraphMocks.getEdgeScore).toHaveBeenCalledWith('source-1', 'target-1');
        },
    );

    it('keeps valid batch cache entries aligned while recovering invalid and missing scores', async () => {
        const service = new FeatureCacheService();
        redisMocks.mget.mockResolvedValue(['0.41', '0x10', null]);
        realGraphMocks.find.mockReturnValue({
            lean: vi.fn().mockResolvedValue([
                { sourceUserId: 'source-2', targetUserId: 'target-2', decayedSum: 0.73 },
                { sourceUserId: 'source-3', targetUserId: 'target-3', decayedSum: 0.84 },
            ]),
        });
        const pipelineSetex = vi.fn();
        redisMocks.pipeline.mockReturnValue({
            setex: pipelineSetex,
            exec: vi.fn().mockResolvedValue([]),
        });

        const result = await service.getEdgeScoresBatch([
            { sourceUserId: 'source-1', targetUserId: 'target-1' },
            { sourceUserId: 'source-2', targetUserId: 'target-2' },
            { sourceUserId: 'source-3', targetUserId: 'target-3' },
        ]);

        expect(result).toEqual(new Map([
            ['source-1:target-1', 0.41],
            ['source-2:target-2', 0.73],
            ['source-3:target-3', 0.84],
        ]));
        expect(realGraphMocks.find).toHaveBeenCalledWith({
            $or: [
                { sourceUserId: 'source-2', targetUserId: 'target-2' },
                { sourceUserId: 'source-3', targetUserId: 'target-3' },
            ],
        });
        expect(pipelineSetex).toHaveBeenCalledTimes(2);
    });

    it('does not replace a valid edge hit when cache backfill fails', async () => {
        const service = new FeatureCacheService();
        redisMocks.mget.mockResolvedValue(['0.41', null]);
        realGraphMocks.find.mockReturnValue({
            lean: vi.fn().mockResolvedValue([
                { sourceUserId: 'source-2', targetUserId: 'target-2', decayedSum: 0.73 },
            ]),
        });
        realGraphMocks.getEdgeScore.mockResolvedValue(0.99);
        redisMocks.pipeline.mockReturnValue({
            setex: vi.fn(),
            exec: vi.fn().mockRejectedValue(new Error('cache backfill failed')),
        });

        await expect(service.getEdgeScoresBatch([
            { sourceUserId: 'source-1', targetUserId: 'target-1' },
            { sourceUserId: 'source-2', targetUserId: 'target-2' },
        ])).resolves.toEqual(new Map([
            ['source-1:target-1', 0.41],
            ['source-2:target-2', 0.73],
        ]));
        expect(realGraphMocks.getEdgeScore).not.toHaveBeenCalled();
    });

    it('keeps parsed user embeddings when a later L2 entry is malformed', async () => {
        const service = new FeatureCacheService();
        const cached = {
            userId: 'user-1',
            interestedInClusters: [],
            version: 1,
        };
        const staleDb = { ...cached, version: 99 };
        const freshDb = { userId: 'user-2', interestedInClusters: [], version: 2 };
        const thirdDb = { userId: 'user-3', interestedInClusters: [], version: 3 };
        const laterCached = { userId: 'user-4', interestedInClusters: [], version: 4 };
        const laterStaleDb = { ...laterCached, version: 44 };
        redisMocks.mget.mockResolvedValue([
            JSON.stringify(cached),
            null,
            '{malformed',
            JSON.stringify(laterCached),
        ]);
        userFeatureMocks.getUserEmbeddingsBatch.mockImplementation(async (userIds: string[]) =>
            new Map(userIds.map((userId) => [
                userId,
                userId === 'user-1'
                    ? staleDb
                    : userId === 'user-2'
                        ? freshDb
                        : userId === 'user-3'
                            ? thirdDb
                            : laterStaleDb,
            ]))
        );
        redisMocks.pipeline.mockReturnValue({
            setex: vi.fn(),
            exec: vi.fn().mockResolvedValue([]),
        });

        await expect(service.getUserEmbeddingsBatch(['user-1', 'user-2', 'user-3', 'user-4'])).resolves.toEqual(
            new Map([
                ['user-1', cached],
                ['user-2', freshDb],
                ['user-3', thirdDb],
                ['user-4', laterCached],
            ])
        );
        expect(userFeatureMocks.getUserEmbeddingsBatch).toHaveBeenCalledWith(['user-2', 'user-3']);
    });

    it('keeps parsed cluster definitions when a later L2 entry is malformed', async () => {
        const service = new FeatureCacheService();
        const cached = { clusterId: 1, name: 'cached' };
        const staleDb = { clusterId: 1, name: 'stale-db' };
        const freshDb = { clusterId: 2, name: 'fresh-db' };
        const laterCached = { clusterId: 3, name: 'later-cached' };
        const laterStaleDb = { clusterId: 3, name: 'later-stale-db' };
        redisMocks.mget.mockResolvedValue([JSON.stringify(cached), '{malformed', JSON.stringify(laterCached)]);
        clusterMocks.getClustersBatch.mockImplementation(async (clusterIds: number[]) =>
            new Map(clusterIds.map((clusterId) => [
                clusterId,
                clusterId === 1 ? staleDb : clusterId === 2 ? freshDb : laterStaleDb,
            ]))
        );
        redisMocks.pipeline.mockReturnValue({
            setex: vi.fn(),
            exec: vi.fn().mockResolvedValue([]),
        });

        await expect(service.getClustersBatch([1, 2, 3])).resolves.toEqual(
            new Map([
                [1, cached],
                [2, freshDb],
                [3, laterCached],
            ])
        );
        expect(clusterMocks.getClustersBatch).toHaveBeenCalledWith([2]);
    });
});
