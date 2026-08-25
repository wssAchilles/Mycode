import { afterEach, describe, expect, it, vi } from 'vitest';
import { Op } from 'sequelize';

const mocks = vi.hoisted(() => ({
    articleFindAll: vi.fn(),
    postFindOneAndUpdate: vi.fn(),
    ensureSnapshotsForPosts: vi.fn(),
}));

vi.mock('../../src/models/NewsArticle', () => ({
    default: {
        findAll: mocks.articleFindAll,
    },
}));

vi.mock('../../src/models/Post', () => ({
    default: {
        findOneAndUpdate: mocks.postFindOneAndUpdate,
    },
}));

vi.mock('../../src/services/recommendation/contentFeatures', () => ({
    postFeatureSnapshotService: {
        ensureSnapshotsForPosts: mocks.ensureSnapshotsForPosts,
    },
}));

import { NewsMaterializationService } from '../../src/services/recommendation/newsMaterialization/NewsMaterializationService';

describe('NewsMaterializationService', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('keeps same-updatedAt articles reachable across materialization batches', async () => {
        const updatedAt = new Date('2026-08-25T00:00:00.000Z');
        const since = new Date('2026-08-24T00:00:00.000Z');
        const article = (id: string) => ({
            id,
            title: `title-${id}`,
            summary: 'summary',
            source: 'source',
            updatedAt,
        });
        let findAllCall = 0;

        mocks.articleFindAll.mockImplementation(async (options: { where: Record<PropertyKey, unknown> }) => {
            findAllCall += 1;
            if (findAllCall === 1) {
                expect(options.where.updatedAt).toEqual({ [Op.gte]: since });
                return [article('article-3'), article('article-2')];
            }
            if (findAllCall === 2) {
                expect(options.where[Op.or]).toEqual([
                    {
                        updatedAt: { [Op.gte]: since, [Op.lt]: updatedAt },
                    },
                    {
                        updatedAt,
                        id: { [Op.lt]: 'article-2' },
                    },
                ]);
                return [article('article-1')];
            }
            return [];
        });
        mocks.postFindOneAndUpdate.mockResolvedValue({});

        const result = await new NewsMaterializationService().materialize({
            since,
            batchSize: 2,
            limit: 10,
            refreshFeatureSnapshots: false,
        });

        expect(result).toEqual({
            scanned: 3,
            upserted: 3,
            snapshotRequested: 0,
            dryRun: false,
        });
        expect(mocks.postFindOneAndUpdate).toHaveBeenCalledTimes(3);
        expect(mocks.postFindOneAndUpdate.mock.calls.map(([filter]) => filter.$or[0]['newsMetadata.externalId']))
            .toEqual(['article-3', 'article-2', 'article-1']);
    });
});
