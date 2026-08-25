import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    find: vi.fn(),
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
    default: {
        find: mocks.find,
    },
    DECAY_CONFIG: { minRetainScore: 0.01 },
    REALGRAPH_FEATURE_VERSION: 'test-feature',
    REALGRAPH_MODEL_VERSION: 'test-model',
    REALGRAPH_PREDICTION_MODE: 'test-mode',
}));

vi.mock('../../src/config/redis', () => ({
    redis: {},
}));

import { RealGraphService } from '../../src/services/recommendation/RealGraphService';

describe('RealGraph prediction metadata backfill', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
