import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

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
    repairDenseVectors: vi.fn(),
    refreshSnapshotsByPostIds: vi.fn(),
    featureExportRun: vi.fn(),
    scanEmbeddingContractEvidence: vi.fn(),
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
        repairDenseVectors: mocks.repairDenseVectors,
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

vi.mock('../../src/services/ops/recommendation/embeddingEvidenceAudit', () => ({
    scanEmbeddingContractEvidence: mocks.scanEmbeddingContractEvidence,
}));

import { DailyRecommendationRefreshJob } from '../../src/services/jobs/DailyRecommendationRefreshJob';

describe('DailyRecommendationRefreshJob', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('refreshes registered-user features and writes persistent run evidence', async () => {
        mocks.jobRunCreate.mockResolvedValue({ _id: 'job-run-1' });
        mocks.bootstrapBackfill.mockResolvedValue({ scanned: 3, created: 1 });
        const createdAt = new Date('2026-06-10T00:00:00.000Z');
        mocks.userFindAll
            .mockResolvedValueOnce([
                { id: 'user-3', createdAt },
                { id: 'user-2', createdAt },
                { id: 'user-1', createdAt },
            ])
            .mockResolvedValueOnce([]);
        mocks.batchUpdateEmbeddings.mockResolvedValue({ success: 3, failed: 0 });
        mocks.repairDenseVectors.mockResolvedValue({ scanned: 3, repaired: 2 });
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
        mocks.scanEmbeddingContractEvidence.mockResolvedValue({
            embeddingEvidence: embeddingEvidenceSummary,
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
        expect(mocks.batchUpdateEmbeddings).toHaveBeenCalledWith(['user-3', 'user-2', 'user-1']);
        expect(mocks.repairDenseVectors).toHaveBeenCalledWith([
            { id: 'user-3', createdAt },
            { id: 'user-2', createdAt },
            { id: 'user-1', createdAt },
        ]);
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
                            denseVectorsRepaired: 2,
                        },
                        embeddingEvidence: embeddingEvidenceSummary,
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
                denseVectorsRepaired: 2,
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
            embeddingEvidence: embeddingEvidenceSummary,
        });
        expect(mocks.scanEmbeddingContractEvidence).toHaveBeenCalledWith({ limit: undefined });
    });

    it('keeps same-timestamp posts reachable across snapshot batches', async () => {
        const createdAt = new Date('2026-06-10T00:00:00.000Z');
        const postIds = [
            new mongoose.Types.ObjectId('000000000000000000000003'),
            new mongoose.Types.ObjectId('000000000000000000000002'),
            new mongoose.Types.ObjectId('000000000000000000000001'),
        ];
        let postFindCall = 0;

        mocks.jobRunCreate.mockResolvedValue({ _id: 'job-run-timestamp-tie' });
        mocks.bootstrapBackfill.mockResolvedValue({ scanned: 0, created: 0 });
        mocks.userFindAll.mockResolvedValue([]);
        mocks.applyDailyDecay.mockResolvedValue({ totalProcessed: 0 });
        mocks.backfillPredictionMetadata.mockResolvedValue({ matched: 0, updated: 0, dryRun: false });
        mocks.postFind.mockImplementation((query: Record<string, unknown>) => {
            postFindCall += 1;
            if (postFindCall === 1) {
                return findPostsResult([
                    { _id: postIds[0], createdAt },
                    { _id: postIds[1], createdAt },
                ]);
            }
            if (postFindCall === 2 && '$or' in query) {
                return findPostsResult([{ _id: postIds[2], createdAt }]);
            }
            return findPostsResult([]);
        });
        mocks.refreshSnapshotsByPostIds.mockResolvedValue(undefined);
        mocks.postSnapshotCountDocuments.mockResolvedValue(3);
        mocks.scanEmbeddingContractEvidence.mockResolvedValue({
            embeddingEvidence: embeddingEvidenceSummary,
        });

        const result = await new DailyRecommendationRefreshJob().run({
            trigger: 'manual',
            userLimit: 1,
            postDays: 7,
            postBatchSize: 2,
            skipFeatureExport: true,
        });

        expect(result.posts).toEqual({ scanned: 3, refreshed: 3 });
        expect(mocks.refreshSnapshotsByPostIds).toHaveBeenNthCalledWith(1, postIds.slice(0, 2));
        expect(mocks.refreshSnapshotsByPostIds).toHaveBeenNthCalledWith(2, postIds.slice(2));
        expect(mocks.postFind).toHaveBeenNthCalledWith(2, {
            $or: [
                { createdAt: { $gte: expect.any(Date), $lt: createdAt } },
                { createdAt, _id: { $lt: postIds[1] } },
            ],
            deletedAt: null,
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

const embeddingEvidenceSummary = {
    total: 5,
    verified_local_fallback: 4,
    semantic_ready: 0,
    quarantined: 1,
    invalid: 0,
    unclassified: 0,
    cohorts: {
        userVectors: {
            total: 4,
            verified_local_fallback: 3,
            semantic_ready: 0,
            quarantined: 1,
            invalid: 0,
            unclassified: 0,
        },
        postFeatureSnapshots: {
            total: 1,
            verified_local_fallback: 1,
            semantic_ready: 0,
            quarantined: 0,
            invalid: 0,
            unclassified: 0,
        },
    },
    quarantineDigest: 'a'.repeat(64),
    scan: {
        userDocuments: 2,
        postFeatureSnapshots: 1,
        mode: 'full' as const,
        limit: null,
        diagnosticOnly: false,
        ordering: '_id_ascending' as const,
    },
};

function findPostsResult(posts: Array<{ _id: string | mongoose.Types.ObjectId; createdAt: Date }>) {
    return {
        select: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(posts),
    };
}
