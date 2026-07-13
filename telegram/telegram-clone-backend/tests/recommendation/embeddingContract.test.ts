import { describe, expect, it } from 'vitest';

import {
    DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
    isEmbeddingContractCompatible,
    isVectorCompatibleWithContract,
} from '../../src/services/recommendation/contracts/embeddingContract';

describe('embedding contract', () => {
    it('accepts vectors that match the retrieval dimension', () => {
        const vector = Array(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim).fill(0);
        expect(isVectorCompatibleWithContract(vector, DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT)).toBe(true);
        expect(isVectorCompatibleWithContract([0, 1], DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT)).toBe(false);
    });

    it('rejects non-finite and non-number vector entries', () => {
        const valid = Array(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim).fill(0);

        expect(isVectorCompatibleWithContract([], DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT)).toBe(false);
        expect(isVectorCompatibleWithContract(
            valid.with(0, Number.NaN),
            DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        )).toBe(false);
        expect(isVectorCompatibleWithContract(
            valid.with(0, Number.POSITIVE_INFINITY),
            DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        )).toBe(false);
        expect(isVectorCompatibleWithContract(
            valid.with(0, '0' as unknown as number),
            DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        )).toBe(false);
    });

    it('requires matching embedding space, model and artifact versions', () => {
        expect(isEmbeddingContractCompatible(
            DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
            { ...DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT },
        )).toBe(true);

        expect(isEmbeddingContractCompatible(
            DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
            {
                ...DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
                artifactVersion: 'other_artifact',
            },
        )).toBe(false);
    });

    it('defines the registered-user bootstrap as a 256-dimensional local fallback', () => {
        expect(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT).toEqual({
            embeddingSpace: 'registered_user_cold_start_v1',
            dimensions: 256,
            retrievalEmbeddingDim: 256,
            rankingEmbeddingDim: 256,
            modelVersion: 'registered_user_cold_start_v1',
            artifactVersion: 'registered_user_profile_features_v1',
            producer: 'RegisteredUserFeatureBootstrapService',
            semantic: false,
        });
        expect(isEmbeddingContractCompatible(
            REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
            DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        )).toBe(false);
    });
});
