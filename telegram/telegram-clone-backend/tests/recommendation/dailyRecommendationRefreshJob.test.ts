import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    userFindAll: vi.fn(),
    postFind: vi.fn(),
    postSnapshotCountDocuments: vi.fn(),
    jobRunCreate: vi.fn(),
    jobRunUpdateOne: vi.fn(),
    batchUpdateEmbeddings: vi.fn(),
    applyDailyDecay: vi.fn(),
    backfillPredictionMetadata: vi.fn(),
    bootstrapBackfill: vi.fn(),
    refreshSnapshotsByPostIds: vi.fn(),
    featureExportRun: vi.fn(),
}));

vi.mock('../../src/models/User', () => ({
    default: {
        findAll: mocks.userFindAll,
    },
}));

vi.mock('../../src/models/Post', () => ({
    default: {
        find: mocks.postFind,
    },
}));

vi.mock('../../src/models/PostFeatureSnapshot', () => ({
    default: {
        countDocuments: mocks.postSnapshotCountDocuments,
    },
}));

vi.mock('../../src/models/RecommendationJobRun', () => ({
    default: {
        create: mocks.jobRunCreate,
        updateOne: mocks.jobRunUpdateOne,
    },
}));

vi.mock('../../src/services/recommendation/SimClustersService', () => ({
    simClustersService: {
        batchUpdateEmbeddings: mocks.batchUpdateEmbeddings,
    },
}));

vi.mock('../../src/services/recommendation/RealGraphService', () => ({
    realGraphService: {
        applyDailyDecay: mocks.applyDailyDecay,
        backfillPredictionMetadata: mocks.backfillPredictionMetadata,
    },
}));

vi.mock('../../src/services/recommendation/users', () => ({
    registeredUserFeatureBootstrapService: {
        backfill: mocks.bootstrapBackfill,
    },
}));

vi.mock('../../src/services/recommendation/contentFeatures', () => ({
    postFeatureSnapshotService: {
        refreshSnapshotsByPostIds: mocks.refreshSnapshotsByPostIds,
    },
}));

vi.mock('../../src/services/jobs/FeatureExportJob', () => ({
    featureExportJob: {
        run: mocks.featureExportRun,
    },
}));

import { DailyRecommendationRefreshJob } from '../../src/services/jobs/DailyRecommendationRefreshJob';

describe('DailyRecommendationRefreshJob', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('refreshes registered-user features and writes persistent run evidence', async () => {
        mocks.jobRunCreate.mockResolvedValue({ _id: 'job-run-1' });
        mocks.bootstrapBackfill.mockResolvedValue({ scanned: 3, created: 1 });
        mocks.userFindAll
            .mockResolvedValueOnce([{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }])
            .mockResolvedValueOnce([]);
        mocks.batchUpdateEmbeddings.mockResolvedValue({ success: 3, failed: 0 });
        mocks.applyDailyDecay.mockResolvedValue({ totalProcessed: 2 });
        mocks.backfillPredictionMetadata.mockResolvedValue({ matched: 5, updated: 5, dryRun: false });
        mocks.postFind.mockReturnValueOnce(findPostsResult([
            { _id: 'post-1', createdAt: new Date('2026-06-10T00:00:00.000Z') },
            { _id: 'post-2', createdAt: new Date('2026-06-09T00:00:00.000Z') },
        ])).mockReturnValueOnce(findPostsResult([]));
        mocks.refreshSnapshotsByPostIds.mockResolvedValue(undefined);
        mocks.postSnapshotCountDocuments.mockResolvedValue(10);
        mocks.featureExportRun.mockResolvedValue({
            usersExported: 3,
            clustersExported: 12,
            postsExported: 2,
            durationMs: 50,
        });

        const result = await new DailyRecommendationRefreshJob().run({
            trigger: 'manual',
            userLimit: 10,
            postDays: 7,
            postBatchSize: 50,
        });

        expect(mocks.jobRunCreate).toHaveBeenCalledWith(expect.objectContaining({
            jobName: 'daily_recommendation_refresh',
            status: 'running',
            trigger: 'manual',
        }));
        expect(mocks.bootstrapBackfill).toHaveBeenCalledWith({ limit: 10, batchSize: 500 });
        expect(mocks.batchUpdateEmbeddings).toHaveBeenCalledWith(['user-1', 'user-2', 'user-3']);
        expect(mocks.backfillPredictionMetadata).toHaveBeenCalledWith(expect.objectContaining({
            force: true,
            limit: 10000,
            batchSize: 500,
        }));
        expect(mocks.refreshSnapshotsByPostIds).toHaveBeenCalledWith(['post-1', 'post-2']);
        expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
            { _id: 'job-run-1' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'success',
                    summary: expect.objectContaining({
                        users: {
                            registered: 3,
                            bootstrapped: 1,
                            embeddingsUpdated: 3,
                            embeddingFailures: 0,
                        },
                    }),
                }),
            }),
        );
        expect(result).toMatchObject({
            users: {
                registered: 3,
                bootstrapped: 1,
                embeddingsUpdated: 3,
                embeddingFailures: 0,
            },
            realGraph: {
                decayedEdges: 2,
                predictionMatched: 5,
                predictionUpdated: 5,
            },
            posts: {
                scanned: 2,
                refreshed: 2,
            },
        });
    });

    it('marks the job run as failed when a refresh step throws', async () => {
        mocks.jobRunCreate.mockResolvedValue({ _id: 'job-run-failed' });
        mocks.bootstrapBackfill.mockRejectedValue(new Error('bootstrap failed'));

        await expect(new DailyRecommendationRefreshJob().run({ trigger: 'manual' }))
            .rejects
            .toThrow('bootstrap failed');

        expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
            { _id: 'job-run-failed' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'failed',
                    error: 'bootstrap failed',
                }),
            }),
        );
    });
});

function findPostsResult(posts: Array<{ _id: string; createdAt: Date }>) {
    return {
        select: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(posts),
    };
}
