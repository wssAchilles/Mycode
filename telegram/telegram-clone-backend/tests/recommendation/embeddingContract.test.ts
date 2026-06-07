import { describe, expect, it } from 'vitest';

import {
    DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
    isEmbeddingContractCompatible,
    isVectorCompatibleWithContract,
} from '../../src/services/recommendation/contracts/embeddingContract';

describe('embedding contract', () => {
    it('accepts vectors that match the retrieval dimension', () => {
        const vector = Array(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim).fill(0);
        expect(isVectorCompatibleWithContract(vector, DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT)).toBe(true);
        expect(isVectorCompatibleWithContract([0, 1], DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT)).toBe(false);
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
});
