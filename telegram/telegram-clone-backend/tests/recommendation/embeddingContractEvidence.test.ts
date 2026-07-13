import { describe, expect, it } from 'vitest';

import UserFeatureVector from '../../src/models/UserFeatureVector';
import {
    DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
    HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
    type EmbeddingContract,
} from '../../src/services/recommendation/contracts/embeddingContract';
import {
    LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
    classifyEmbeddingContractEvidence,
    quarantineDigest,
    vectorChecksum,
    type EmbeddingEvidenceStatus,
} from '../../src/services/recommendation/contracts/embeddingContractEvidence';

const vectorFor = (contract: EmbeddingContract, value = 0.25): number[] => (
    Array(contract.retrievalEmbeddingDim).fill(value)
);

describe('embedding contract evidence', () => {
    it('classifies supported persisted states while keeping semantic_ready unreachable', () => {
        const localVector = vectorFor(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT);
        const vocabulary: EmbeddingEvidenceStatus[] = [
            'verified_local_fallback',
            'semantic_ready',
            'quarantined',
            'invalid',
            'unclassified',
        ];
        const cases = [
            {
                input: {
                    vector: localVector,
                    perVectorContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
                },
                expected: 'verified_local_fallback',
            },
            {
                input: {
                    vector: localVector,
                    replayContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
                    replayMatched: true,
                },
                expected: 'verified_local_fallback',
            },
            {
                input: {
                    vector: localVector,
                    quarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
                },
                expected: 'quarantined',
            },
            { input: { vector: undefined }, expected: 'invalid' },
            { input: { vector: localVector }, expected: 'unclassified' },
        ] as const;

        const results = cases.map(({ input, expected }) => {
            const result = classifyEmbeddingContractEvidence(input);
            expect(result).toBe(expected);
            return result;
        });

        expect(vocabulary).toContain('semantic_ready');
        expect(results).not.toContain('semantic_ready');
    });

    it('requires complete known-local identity and structural compatibility', () => {
        const coldStart = REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT;
        const { dimensions: _dimensions, ...coldStartWithoutDimensions } = coldStart;
        expect(classifyEmbeddingContractEvidence({
            vector: vectorFor(HEURISTIC_POST_HASH_EMBEDDING_CONTRACT),
            perVectorContract: HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
        })).toBe('verified_local_fallback');
        expect(classifyEmbeddingContractEvidence({
            vector: vectorFor(coldStart),
            perVectorContract: coldStartWithoutDimensions,
        })).toBe('verified_local_fallback');

        const unsupportedContracts: EmbeddingContract[] = [
            { ...coldStart, embeddingSpace: 'other_space' },
            { ...coldStart, rankingEmbeddingDim: 255 },
            { ...coldStart, modelVersion: 'other_model' },
            { ...coldStart, artifactVersion: 'other_artifact' },
            { ...coldStart, producer: 'other_producer' },
            { ...coldStart, semantic: true },
        ];
        for (const perVectorContract of unsupportedContracts) {
            expect(classifyEmbeddingContractEvidence({
                vector: vectorFor(coldStart),
                perVectorContract,
            })).toBe('unclassified');
        }

        expect(classifyEmbeddingContractEvidence({
            vector: vectorFor(coldStart).slice(1),
            perVectorContract: coldStart,
        })).toBe('invalid');
        expect(classifyEmbeddingContractEvidence({
            vector: vectorFor(coldStart),
            perVectorContract: {
                ...coldStart,
                dimensions: 255,
                retrievalEmbeddingDim: 255,
            },
        })).toBe('invalid');
    });

    it('rejects incomplete or malformed trusted contracts at runtime', () => {
        const coldStart = REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT;
        const requiredFields: Array<keyof EmbeddingContract> = [
            'embeddingSpace',
            'retrievalEmbeddingDim',
            'rankingEmbeddingDim',
            'modelVersion',
            'artifactVersion',
            'producer',
            'semantic',
        ];
        const invalidContracts = requiredFields.map((field) => {
            const contract = { ...coldStart } as Record<string, unknown>;
            delete contract[field];
            return contract as unknown as EmbeddingContract;
        });
        invalidContracts.push(
            { ...coldStart, retrievalEmbeddingDim: 0 },
            { ...coldStart, rankingEmbeddingDim: 0 },
            { ...coldStart, dimensions: coldStart.retrievalEmbeddingDim - 1 },
        );
        for (const field of [
            'embeddingSpace',
            'modelVersion',
            'artifactVersion',
            'producer',
        ] as const) {
            invalidContracts.push({ ...coldStart, [field]: '   ' });
        }

        for (const contract of invalidContracts) {
            expect(classifyEmbeddingContractEvidence({
                vector: vectorFor(coldStart),
                perVectorContract: contract,
            })).toBe('invalid');
            expect(classifyEmbeddingContractEvidence({
                vector: vectorFor(coldStart),
                replayContract: contract,
                replayMatched: true,
            })).toBe('invalid');
        }
    });

    it('treats default semantic sentinels as unclassified diagnostic metadata', () => {
        const vector = vectorFor(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT);
        const partialLegacyContract: Partial<EmbeddingContract> = {
            embeddingSpace: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.embeddingSpace,
            retrievalEmbeddingDim: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim,
            rankingEmbeddingDim: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.rankingEmbeddingDim,
            modelVersion: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.modelVersion,
            artifactVersion: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.artifactVersion,
            producer: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.producer,
        };

        expect(classifyEmbeddingContractEvidence({
            vector,
            perVectorContract: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        })).toBe('unclassified');
        expect(classifyEmbeddingContractEvidence({
            vector,
            legacySharedContract: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        })).toBe('unclassified');
        expect(classifyEmbeddingContractEvidence({
            vector,
            legacySharedContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
        })).toBe('unclassified');
        expect(classifyEmbeddingContractEvidence({
            vector,
            legacySharedContract: partialLegacyContract,
        })).toBe('unclassified');
        for (const legacySharedContract of [
            {},
            { embeddingSpace: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.embeddingSpace },
        ]) {
            expect(classifyEmbeddingContractEvidence({
                vector,
                legacySharedContract,
            })).toBe('unclassified');
        }
        for (const legacySharedContract of [
            { retrievalEmbeddingDim: vector.length - 1 },
            { dimensions: vector.length - 1 },
        ]) {
            expect(classifyEmbeddingContractEvidence({
                vector,
                legacySharedContract,
            })).toBe('invalid');
        }
    });

    it('fails closed for unsupported quarantine and replay evidence', () => {
        const vector = vectorFor(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT);
        const invalidInputs = [
            { vector, quarantineReason: 'unknown_reason' },
            { vector, quarantineReason: '' },
            {
                vector,
                quarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
                perVectorContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            },
            {
                vector: undefined,
                quarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
            },
            {
                vector: [Number.NaN],
                quarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
            },
            {
                vector,
                perVectorContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
                replayMatched: false,
            },
        ];

        for (const input of invalidInputs) {
            expect(classifyEmbeddingContractEvidence(input)).toBe('invalid');
        }
        expect(classifyEmbeddingContractEvidence({
            vector,
            legacySharedContract: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
            quarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
        })).toBe('quarantined');
    });

    it('computes byte-stable vector checksums', () => {
        expect(vectorChecksum([0.5, -0.25])).toBe(
            '07eb0c314cc3ea3a7c21e171ff046a7c0a0961f9756ec7c7e14b2b5db2e50cb0',
        );
        expect(vectorChecksum([-0])).not.toBe(vectorChecksum([0]));
        expect(() => vectorChecksum([Number.POSITIVE_INFINITY])).toThrow('invalid_vector');
    });

    it('computes an order-independent quarantine digest over record identity', () => {
        const reason = LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON;
        const first = { userId: 'user-b', vector: [0.5, -0.25], reason };
        const second = { userId: 'user-a', vector: [-0, 1], reason };
        const digest = quarantineDigest([first, second]);

        expect(quarantineDigest([second, first])).toBe(digest);
        expect(quarantineDigest([
            { ...first, userId: 'same-user' },
            { ...second, userId: 'same-user' },
        ])).toBe(quarantineDigest([
            { ...second, userId: 'same-user' },
            { ...first, userId: 'same-user' },
        ]));
        expect(quarantineDigest([{ ...first, userId: 'user-c' }, second])).not.toBe(digest);
        expect(quarantineDigest([{ ...first, vector: [-0.25, 0.5] }, second])).not.toBe(digest);
        expect(quarantineDigest([{ ...first, reason: 'other_reason' }, second])).not.toBe(digest);
    });

    it('registers optional per-vector sidecar schema paths and keeps the legacy contract', () => {
        for (const path of [
            'twoTowerEmbeddingContract',
            'twoTowerEmbeddingQuarantineReason',
            'phoenixEmbeddingContract',
        ]) {
            const schemaPath = UserFeatureVector.schema.path(path);
            expect(schemaPath).toBeDefined();
            expect(schemaPath.options.required).not.toBe(true);
            expect(schemaPath.options.default).toBeUndefined();
        }
        expect(UserFeatureVector.schema.path('embeddingContract.embeddingSpace')).toBeDefined();

        const partialSidecar = new UserFeatureVector({
            userId: 'partial-sidecar',
            interestedInClusters: [],
            version: 1,
            computedAt: new Date(),
            expiresAt: new Date(),
            twoTowerEmbeddingContract: {
                retrievalEmbeddingDim: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim,
            } as unknown as EmbeddingContract,
        });
        expect(partialSidecar.validateSync()?.errors[
            'twoTowerEmbeddingContract.embeddingSpace'
        ]).toBeDefined();
    });
});
