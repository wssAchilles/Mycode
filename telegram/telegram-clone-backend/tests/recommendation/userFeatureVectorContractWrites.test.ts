import { afterEach, describe, expect, it, vi } from 'vitest';

import UserFeatureVector, {
    type IUserFeatureVector,
} from '../../src/models/UserFeatureVector';
import type { EmbeddingContract } from '../../src/services/recommendation/contracts/embeddingContract';

const contractFor = (dimensions: number): EmbeddingContract => ({
    embeddingSpace: `future_user_embedding_${dimensions}`,
    dimensions,
    retrievalEmbeddingDim: dimensions,
    rankingEmbeddingDim: dimensions,
    modelVersion: 'future-model-v2',
    artifactVersion: 'future-artifact-v3',
    producer: 'future-user-embedding-writer',
    semantic: true,
});

const vectorFor = (dimensions: number): number[] => Array.from(
    { length: dimensions },
    (_, index) => index / dimensions,
);

describe('UserFeatureVector.upsertEmbedding contract writes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps sparse updates scoped to explicit sparse and metadata fields', async () => {
        const stored = { userId: 'user-1' } as IUserFeatureVector;
        const findOneAndUpdate = vi.spyOn(UserFeatureVector, 'findOneAndUpdate')
            .mockResolvedValue(stored);

        await UserFeatureVector.upsertEmbedding('user-1', {
            interestedInClusters: [{ clusterId: 7, score: 0.9 }],
            producerEmbedding: [{ clusterId: 8, score: 0.4 }],
            knownForCluster: 7,
            knownForScore: 0.9,
            qualityScore: 0.8,
            modelVersion: 'simclusters-v4',
        }, 4);

        const update = findOneAndUpdate.mock.calls[0][1] as {
            $set: Record<string, unknown>;
        };
        expect(update.$set).toMatchObject({
            interestedInClusters: [{ clusterId: 7, score: 0.9 }],
            producerEmbedding: [{ clusterId: 8, score: 0.4 }],
            knownForCluster: 7,
            knownForScore: 0.9,
            qualityScore: 0.8,
            modelVersion: 'simclusters-v4',
            version: 4,
        });
        expect(update.$set.computedAt).toBeInstanceOf(Date);
        expect(update.$set.expiresAt).toBeInstanceOf(Date);
        expect(update.$set).not.toHaveProperty('twoTowerEmbedding');
        expect(update.$set).not.toHaveProperty('twoTowerEmbeddingContract');
        expect(update.$set).not.toHaveProperty('phoenixEmbedding');
        expect(update.$set).not.toHaveProperty('phoenixEmbeddingContract');
        expect(update.$set).not.toHaveProperty('embeddingContract');
        expect(findOneAndUpdate.mock.calls[0][2]).toMatchObject({
            upsert: true,
            new: true,
            runValidators: true,
        });
    });

    it('rejects legacy shared contract writes before calling MongoDB', async () => {
        const findOneAndUpdate = vi.spyOn(UserFeatureVector, 'findOneAndUpdate')
            .mockResolvedValue({ userId: 'user-1' } as IUserFeatureVector);

        await expect(UserFeatureVector.upsertEmbedding('user-1', {
            embeddingContract: contractFor(16),
        }, 2)).rejects.toThrow('legacy_embedding_contract_not_writable');

        expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([
        ['twoTowerEmbeddingQuarantineReason', { twoTowerEmbeddingQuarantineReason: 'relabel-existing' }],
        ['twhinEmbedding', { twhinEmbedding: [0.1, 0.2] }],
    ])('rejects unsupported %s writes before calling MongoDB', async (_field, embeddings) => {
        const findOneAndUpdate = vi.spyOn(UserFeatureVector, 'findOneAndUpdate')
            .mockResolvedValue({ userId: 'user-1' } as IUserFeatureVector);

        await expect(UserFeatureVector.upsertEmbedding('user-1', embeddings, 2))
            .rejects.toThrow('unsupported_user_embedding_write');

        expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    describe.each([
        {
            label: 'Two-Tower',
            dimensions: 16,
            vectorField: 'twoTowerEmbedding' as const,
            contractField: 'twoTowerEmbeddingContract' as const,
        },
        {
            label: 'Phoenix',
            dimensions: 24,
            vectorField: 'phoenixEmbedding' as const,
            contractField: 'phoenixEmbeddingContract' as const,
        },
    ])('$label writes', ({ dimensions, vectorField, contractField }) => {
        const invalidWrites = (): Array<[string, Partial<IUserFeatureVector>]> => {
            const incompleteContract = { ...contractFor(dimensions) } as Partial<EmbeddingContract>;
            delete incompleteContract.artifactVersion;

            return [
                ['missing sidecar', { [vectorField]: vectorFor(dimensions) }],
                ['sidecar without vector', { [contractField]: contractFor(dimensions) }],
                ['wrong dimension', {
                    [vectorField]: vectorFor(dimensions - 1),
                    [contractField]: contractFor(dimensions),
                }],
                ['NaN', {
                    [vectorField]: [Number.NaN, ...vectorFor(dimensions).slice(1)],
                    [contractField]: contractFor(dimensions),
                }],
                ['Infinity', {
                    [vectorField]: [Number.POSITIVE_INFINITY, ...vectorFor(dimensions).slice(1)],
                    [contractField]: contractFor(dimensions),
                }],
                ['incomplete sidecar', {
                    [vectorField]: vectorFor(dimensions),
                    [contractField]: incompleteContract,
                }],
            ];
        };

        it.each(invalidWrites())('rejects %s before calling MongoDB', async (_case, embeddings) => {
            const findOneAndUpdate = vi.spyOn(UserFeatureVector, 'findOneAndUpdate')
                .mockResolvedValue({ userId: 'user-1' } as IUserFeatureVector);

            await expect(UserFeatureVector.upsertEmbedding('user-1', embeddings, 3))
                .rejects.toThrow();

            expect(findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('writes a finite vector with a complete future contract atomically', async () => {
            const stored = { userId: 'user-1' } as IUserFeatureVector;
            const findOneAndUpdate = vi.spyOn(UserFeatureVector, 'findOneAndUpdate')
                .mockResolvedValue(stored);
            const vector = vectorFor(dimensions);
            const contract = contractFor(dimensions);

            await UserFeatureVector.upsertEmbedding('user-1', {
                [vectorField]: vector,
                [contractField]: contract,
            }, 5);

            const update = findOneAndUpdate.mock.calls[0][1] as {
                $set: Record<string, unknown>;
            };
            expect(update.$set).toMatchObject({
                [vectorField]: vector,
                [contractField]: contract,
                version: 5,
            });
            expect(update.$set).not.toHaveProperty('embeddingContract');
        });
    });
});
