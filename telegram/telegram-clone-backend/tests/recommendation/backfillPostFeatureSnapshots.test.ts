import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    find: vi.fn(),
    ensureSnapshotsForPosts: vi.fn(),
}));

vi.mock('../../src/models/Post', () => ({
    default: {
        find: mocks.find,
    },
}));

vi.mock('../../src/services/recommendation/contentFeatures', () => ({
    postFeatureSnapshotService: {
        ensureSnapshotsForPosts: mocks.ensureSnapshotsForPosts,
    },
}));

vi.mock('../../src/config/db', () => ({
    connectMongoDB: vi.fn(),
}));

import { backfillPostFeatureSnapshots } from '../../src/scripts/backfillPostFeatureSnapshots';

describe('backfillPostFeatureSnapshots', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps same-createdAt posts reachable across snapshot batches', async () => {
        const createdAt = new Date('2026-08-25T00:00:00.000Z');
        const createdAfter = new Date('2026-08-24T00:00:00.000Z');
        const post = (id: string) => ({ _id: id, createdAt });
        const pages = [[post('post-3'), post('post-2')], [post('post-1')], []];
        const queries: Array<Record<string, unknown>> = [];
        let pageIndex = 0;
        mocks.find.mockImplementation((query: Record<string, unknown>) => {
            queries.push(query);
            return {
                select: vi.fn().mockReturnThis(),
                sort: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                lean: vi.fn().mockResolvedValue(pages[pageIndex++]),
            };
        });

        const processed = await backfillPostFeatureSnapshots({
            createdAfter,
            batch: 2,
        });

        expect(processed).toBe(3);
        expect(mocks.ensureSnapshotsForPosts).toHaveBeenCalledTimes(2);
        expect(queries[0]).toEqual({
            createdAt: { $gte: createdAfter },
            deletedAt: null,
        });
        expect(queries[1]).toEqual({
            $or: [
                { createdAt: { $gte: createdAfter, $lt: createdAt } },
                { createdAt, _id: { $lt: 'post-2' } },
            ],
            deletedAt: null,
        });
    });
});
