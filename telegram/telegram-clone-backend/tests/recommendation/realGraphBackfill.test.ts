import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    find: vi.fn(),
    getEdgeScore: vi.fn(),
    redisDel: vi.fn(),
    redisGet: vi.fn(),
    redisSetex: vi.fn(),
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    default: {
        find: mocks.find,
        getEdgeScore: mocks.getEdgeScore,
    },
    DECAY_CONFIG: { minRetainScore: 0.01 },
    REALGRAPH_FEATURE_VERSION: 'test-feature',
    REALGRAPH_MODEL_VERSION: 'test-model',
    REALGRAPH_PREDICTION_MODE: 'test-mode',
}));

vi.mock('../../src/config/redis', () => ({
    redis: {
        del: mocks.redisDel,
        get: mocks.redisGet,
        setex: mocks.redisSetex,
    },
}));

import { FeatureCacheService } from '../../src/services/recommendation/FeatureCacheService';
import { RealGraphService } from '../../src/services/recommendation/RealGraphService';

describe('RealGraph prediction metadata backfill', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        FeatureCacheService.getInstance().clearL1Cache();
        mocks.redisDel.mockResolvedValue(1);
        mocks.redisGet.mockResolvedValue(null);
        mocks.redisSetex.mockResolvedValue('OK');
    });

    it('keeps same-updatedAt edges reachable across batches', async () => {
        const updatedAt = new Date('2026-08-25T00:00:00.000Z');
        const since = new Date('2026-08-24T00:00:00.000Z');
        const metadataConditions = [
            { modelVersion: { $ne: 'test-model' } },
            { predictionMode: { $ne: 'test-mode' } },
            { featureVersion: { $ne: 'test-feature' } },
            { lastPredictionAt: { $exists: false } },
        ];
        const edge = (id: string) => ({ _id: id, updatedAt });
        const pages = [[edge('edge-3'), edge('edge-2')], [edge('edge-1')], []];
        const queries: Array<Record<string, unknown>> = [];
        let pageIndex = 0;
        mocks.find.mockImplementation((query: Record<string, unknown>) => {
            queries.push(query);
            return {
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(pages[pageIndex++]),
            };
        });

        const result = await new RealGraphService().backfillPredictionMetadata({
            since,
            batchSize: 2,
            limit: 10,
            dryRun: true,
        });

        expect(result).toEqual({ matched: 3, updated: 0, dryRun: true });
        expect(queries[0]).toEqual({
            $or: metadataConditions,
            updatedAt: { $gte: since },
        });
        expect(queries[1]).toEqual({
            $and: [
                { $or: metadataConditions },
                {
                    $or: [
                        { updatedAt: { $gte: since, $lt: updatedAt } },
                        { updatedAt, _id: { $lt: 'edge-2' } },
                    ],
                },
            ],
        });
    });

    it('invalidates a backfilled page from both edge-cache namespaces', async () => {
        const featureCacheService = FeatureCacheService.getInstance();
        mocks.getEdgeScore
            .mockResolvedValueOnce(0.25)
            .mockResolvedValueOnce(0.5)
            .mockResolvedValueOnce(0.91);
        await featureCacheService.getEdgeScore('source-1', 'target-1');
        await featureCacheService.getEdgeScore('source-2', 'target-2');
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(2);

        const updatedAt = new Date('2026-08-25T00:00:00.000Z');
        const edges = [
            { _id: 'edge-2', sourceUserId: 'source-2', targetUserId: 'target-2', updatedAt },
            { _id: 'edge-1', sourceUserId: 'source-1', targetUserId: 'target-1', updatedAt },
        ];
        mocks.find.mockReturnValueOnce({
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue(edges),
        });
        const service = new RealGraphService();
        vi.spyOn(service as any, 'writePredictionMetadata').mockResolvedValue(undefined);

        await expect(service.backfillPredictionMetadata({
            limit: 2,
            batchSize: 2,
            force: true,
        })).resolves.toEqual({ matched: 2, updated: 2, dryRun: false });

        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith(
            'rg:score:source-2:target-2',
            'rg:score:source-1:target-1',
        );
        expect(mocks.redisDel).toHaveBeenCalledWith(
            'fcs:rg:source-2:target-2',
            'fcs:rg:source-1:target-1',
        );
        await expect(featureCacheService.getEdgeScore('source-1', 'target-1')).resolves.toBe(0.91);
        expect(mocks.getEdgeScore).toHaveBeenCalledTimes(3);
    });

    it('invalidates a backfilled page when metadata persistence fails', async () => {
        const featureCacheService = FeatureCacheService.getInstance();
        mocks.getEdgeScore.mockResolvedValueOnce(0.25);
        await featureCacheService.getEdgeScore('source-5', 'target-5');
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(1);

        const edge = {
            _id: 'edge-5',
            sourceUserId: 'source-5',
            targetUserId: 'target-5',
            updatedAt: new Date('2026-08-25T00:00:00.000Z'),
        };
        mocks.find.mockReturnValueOnce({
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([edge]),
        });
        const service = new RealGraphService();
        const metadataError = new Error('metadata write failed');
        vi.spyOn(service as any, 'writePredictionMetadata').mockRejectedValue(metadataError);

        await expect(service.backfillPredictionMetadata({
            limit: 1,
            batchSize: 1,
            force: true,
        })).rejects.toBe(metadataError);
        expect(featureCacheService.getCacheStats().l1.realGraph).toBe(0);
        expect(mocks.redisDel).toHaveBeenCalledWith('fcs:rg:source-5:target-5');
    });
});
