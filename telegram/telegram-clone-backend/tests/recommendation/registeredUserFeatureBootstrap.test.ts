import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
    type EmbeddingContract,
} from '../../src/services/recommendation/contracts/embeddingContract';

const mocks = vi.hoisted(() => ({
    userFindAll: vi.fn(),
    featureFindOne: vi.fn(),
    featureFind: vi.fn(),
    featureCreate: vi.fn(),
    featureInsertMany: vi.fn(),
    featureBulkWrite: vi.fn(),
    postFeatureFind: vi.fn(),
    connectMongoDB: vi.fn(),
    disconnectMongoDB: vi.fn(),
    dotenvConfig: vi.fn(),
}));

vi.mock('../../src/models/User', () => ({
    default: { findAll: mocks.userFindAll },
}));

vi.mock('../../src/models/UserFeatureVector', () => ({
    default: {
        findOne: mocks.featureFindOne,
        find: mocks.featureFind,
        create: mocks.featureCreate,
        insertMany: mocks.featureInsertMany,
        bulkWrite: mocks.featureBulkWrite,
    },
}));

vi.mock('../../src/models/PostFeatureSnapshot', () => ({
    default: { find: mocks.postFeatureFind },
}));

vi.mock('../../src/config/db', () => ({
    connectMongoDB: mocks.connectMongoDB,
}));

vi.mock('dotenv', () => ({
    default: { config: mocks.dotenvConfig },
}));

vi.mock('mongoose', () => ({
    default: {
        connection: { removeAllListeners: vi.fn() },
        disconnect: mocks.disconnectMongoDB,
    },
}));

import {
    RegisteredUserFeatureBootstrapService,
} from '../../src/services/recommendation/users/registeredUserFeatureBootstrap';

const user = {
    id: 'registered-user-1',
    username: 'registered-user',
    region: 'CN',
    language: 'zh',
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
};

const vectorFor = (dimensions = 256): number[] => Array.from(
    { length: dimensions },
    (_, index) => index / Math.max(1, dimensions),
);

const futureContract = (dimensions = 256): EmbeddingContract => ({
    embeddingSpace: 'future-semantic-user-v2',
    dimensions,
    retrievalEmbeddingDim: dimensions,
    rankingEmbeddingDim: dimensions,
    modelVersion: 'future-model-v2',
    artifactVersion: 'future-artifact-v2',
    producer: 'future-semantic-writer',
    semantic: true,
});

describe('RegisteredUserFeatureBootstrapService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.featureCreate.mockResolvedValue({});
        mocks.featureBulkWrite.mockResolvedValue({ modifiedCount: 1 });
    });

    it('creates deterministic cold-start vectors with independent non-semantic sidecars', async () => {
        mocks.featureFindOne.mockReturnValue(findOneResult(null));
        const service = new RegisteredUserFeatureBootstrapService();

        await service.ensureUser(user);
        await service.ensureUser(user);

        const first = mocks.featureCreate.mock.calls[0][0] as Record<string, unknown>;
        const second = mocks.featureCreate.mock.calls[1][0] as Record<string, unknown>;
        expect(first.twoTowerEmbedding).toEqual(second.twoTowerEmbedding);
        expect(first.phoenixEmbedding).toEqual(second.phoenixEmbedding);
        expect(first.twoTowerEmbedding).toHaveLength(256);
        expect(first.phoenixEmbedding).toHaveLength(256);
        expect(first.twoTowerEmbeddingContract).toEqual(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT);
        expect(first.phoenixEmbeddingContract).toEqual(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT);
        expect(first.twoTowerEmbeddingContract).not.toBe(first.phoenixEmbeddingContract);
        expect(first).not.toHaveProperty('embeddingContract');
    });

    it('fills a missing slot without writing its nonempty unknown sibling', async () => {
        const unknownPhoenix = vectorFor(7);
        mocks.featureFind.mockReturnValue(findManyResult([{
            userId: user.id,
            phoenixEmbedding: unknownPhoenix,
        }]));

        const result = await new RegisteredUserFeatureBootstrapService().repairDenseVectors([user]);

        expect(result).toEqual({ scanned: 1, repaired: 1 });
        const $set = firstBulkSet();
        expect($set.twoTowerEmbedding).toHaveLength(256);
        expect($set.twoTowerEmbeddingContract).toEqual(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT);
        expect($set).not.toHaveProperty('phoenixEmbedding');
        expect($set).not.toHaveProperty('phoenixEmbeddingContract');
        expect($set).not.toHaveProperty('embeddingContract');
    });

    it('repairs a damaged trusted slot without changing a quarantined sibling', async () => {
        mocks.featureFind.mockReturnValue(findManyResult([{
            userId: user.id,
            twoTowerEmbedding: vectorFor(3),
            twoTowerEmbeddingQuarantineReason: 'legacy_serving_lite_mixed_lineage_v1',
            phoenixEmbedding: [Number.NaN],
            phoenixEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
        }]));

        const result = await new RegisteredUserFeatureBootstrapService().repairDenseVectors([user]);

        expect(result).toEqual({ scanned: 1, repaired: 1 });
        const $set = firstBulkSet();
        expect($set.phoenixEmbedding).toHaveLength(256);
        expect($set.phoenixEmbeddingContract).toEqual(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT);
        expect($set).not.toHaveProperty('twoTowerEmbedding');
        expect($set).not.toHaveProperty('twoTowerEmbeddingContract');
        expect($set).not.toHaveProperty('twoTowerEmbeddingQuarantineReason');
    });

    it('preserves nonempty vectors with unknown or different lineage', async () => {
        mocks.featureFind.mockReturnValue(findManyResult([{
            userId: user.id,
            twoTowerEmbedding: vectorFor(4),
            phoenixEmbedding: vectorFor(),
            phoenixEmbeddingContract: futureContract(),
        }]));

        const result = await new RegisteredUserFeatureBootstrapService().repairDenseVectors([user]);

        expect(result).toEqual({ scanned: 1, repaired: 0 });
        expect(mocks.featureBulkWrite).not.toHaveBeenCalled();
    });

    it.each([
        ['producer', { producer: 'different-writer' }],
        ['ranking dimension', { rankingEmbeddingDim: 128 }],
    ])('does not repair a damaged vector when its cold-start-looking sidecar differs by %s', async (
        _case,
        contractPatch,
    ) => {
        mocks.featureFind.mockReturnValue(findManyResult([{
            userId: user.id,
            twoTowerEmbedding: [Number.NaN],
            twoTowerEmbeddingContract: {
                ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
                ...contractPatch,
            },
            phoenixEmbedding: vectorFor(),
            phoenixEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
        }]));

        const result = await new RegisteredUserFeatureBootstrapService().repairDenseVectors([user]);

        expect(result).toEqual({ scanned: 1, repaired: 0 });
        expect(mocks.featureBulkWrite).not.toHaveBeenCalled();
    });

    it.each([
        ['unknown sidecar', { twoTowerEmbeddingContract: futureContract() }],
        ['quarantine evidence', { twoTowerEmbeddingQuarantineReason: 'manual-review' }],
    ])('does not fill an empty slot carrying conflicting %s', async (_case, evidence) => {
        mocks.featureFind.mockReturnValue(findManyResult([{
            userId: user.id,
            ...evidence,
            phoenixEmbedding: vectorFor(),
            phoenixEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
        }]));

        const result = await new RegisteredUserFeatureBootstrapService().repairDenseVectors([user]);

        expect(result).toEqual({ scanned: 1, repaired: 0 });
        expect(mocks.featureBulkWrite).not.toHaveBeenCalled();
    });

    it('reports the number of documents actually modified by MongoDB', async () => {
        mocks.featureFind.mockReturnValue(findManyResult([{
            userId: user.id,
            phoenixEmbedding: vectorFor(),
            phoenixEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
        }]));
        mocks.featureBulkWrite.mockResolvedValue({ modifiedCount: 0 });

        const result = await new RegisteredUserFeatureBootstrapService().repairDenseVectors([user]);

        expect(result).toEqual({ scanned: 1, repaired: 0 });
        expect(mocks.featureBulkWrite).toHaveBeenCalledOnce();
    });

    it('guards repair writes with the observed document identity and timestamp', async () => {
        const updatedAt = new Date('2026-07-13T01:00:00.000Z');
        mocks.featureFind.mockReturnValue(findManyResult([{
            _id: 'feature-vector-1',
            userId: user.id,
            updatedAt,
            phoenixEmbedding: vectorFor(),
            phoenixEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
        }]));

        await new RegisteredUserFeatureBootstrapService().repairDenseVectors([user]);

        expect(firstBulkOperation().filter).toEqual({
            _id: 'feature-vector-1',
            updatedAt,
        });
    });

    it('matches the absence of updatedAt for historical documents instead of widening the repair filter', async () => {
        mocks.featureFind.mockReturnValue(findManyResult([{
            _id: 'legacy-feature-vector-1',
            userId: user.id,
            phoenixEmbedding: vectorFor(),
            phoenixEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
        }]));

        await new RegisteredUserFeatureBootstrapService().repairDenseVectors([user]);

        expect(firstBulkOperation().filter).toEqual({
            _id: 'legacy-feature-vector-1',
            updatedAt: { $exists: false },
        });
    });
});

describe('legacy embedding-contract backfill boundary', () => {
    it('is import-safe and permanently excludes user-vector shared-contract writes', async () => {
        vi.clearAllMocks();
        mocks.postFeatureFind.mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
        });
        const backfill = await import('../../src/scripts/backfillEmbeddingContracts');

        expect(mocks.dotenvConfig).not.toHaveBeenCalled();
        expect(mocks.connectMongoDB).not.toHaveBeenCalled();
        const result = await backfill.backfillEmbeddingContracts({
            dryRun: false,
            limit: 10,
            batchSize: 5,
        });
        expect(mocks.featureFind).not.toHaveBeenCalled();
        expect(mocks.postFeatureFind).toHaveBeenCalledOnce();
        expect(result.users).toEqual({
            scanned: 0,
            matched: 0,
            updated: 0,
            disabled: true,
        });
    });
});

function findOneResult(value: unknown) {
    return {
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(value),
    };
}

function findManyResult(value: Array<Record<string, unknown>>) {
    return {
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(value),
    };
}

function firstBulkSet(): Record<string, unknown> {
    return firstBulkOperation().update.$set;
}

function firstBulkOperation(): {
    filter: Record<string, unknown>;
    update: { $set: Record<string, unknown> };
} {
    const operations = mocks.featureBulkWrite.mock.calls[0][0] as Array<{
        updateOne: {
            filter: Record<string, unknown>;
            update: { $set: Record<string, unknown> };
        };
    }>;
    expect(operations).toHaveLength(1);
    return operations[0].updateOne;
}
