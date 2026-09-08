export interface EmbeddingContract {
    embeddingSpace: string;
    dimensions?: number;
    retrievalEmbeddingDim: number;
    rankingEmbeddingDim: number;
    modelVersion: string;
    artifactVersion: string;
    producer: string;
    semantic: boolean;
}

export const DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT: EmbeddingContract = {
    embeddingSpace: 'recommendation_two_tower_v1',
    dimensions: 256,
    retrievalEmbeddingDim: 256,
    rankingEmbeddingDim: 256,
    modelVersion: 'heuristic_embedding_contract_v1',
    artifactVersion: 'local_artifact_v1',
    producer: 'telegram-clone-backend',
    semantic: true,
};

export const REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT: EmbeddingContract = {
    embeddingSpace: 'registered_user_cold_start_v1',
    dimensions: 256,
    retrievalEmbeddingDim: 256,
    rankingEmbeddingDim: 256,
    modelVersion: 'registered_user_cold_start_v1',
    artifactVersion: 'registered_user_profile_features_v1',
    producer: 'RegisteredUserFeatureBootstrapService',
    semantic: false,
};

export const HEURISTIC_POST_HASH_EMBEDDING_CONTRACT: EmbeddingContract = {
    embeddingSpace: 'heuristic_post_hash_v1',
    dimensions: 48,
    retrievalEmbeddingDim: 48,
    rankingEmbeddingDim: 48,
    modelVersion: 'heuristic_fallback',
    artifactVersion: 'local_hash_v1',
    producer: 'PostFeatureSnapshotService',
    semantic: false,
};

export const CRAWLER_TFIDF_EMBEDDING_CONTRACT: EmbeddingContract = {
    embeddingSpace: 'crawler_tfidf_v0',
    dimensions: 0,
    retrievalEmbeddingDim: 0,
    rankingEmbeddingDim: 0,
    modelVersion: 'heuristic_fallback',
    artifactVersion: 'local_hash_v1',
    producer: 'newsService',
    semantic: false,
};

export function isEmbeddingContractCompatible(
    left?: Partial<EmbeddingContract> | null,
    right?: Partial<EmbeddingContract> | null,
): boolean {
    if (!left || !right) return false;
    if (right.semantic === true && left.semantic !== true) return false;
    if (typeof right.semantic === 'boolean' && typeof left.semantic === 'boolean' && left.semantic !== right.semantic) {
        return false;
    }

    const leftDim = resolveRetrievalDimension(left);
    const rightDim = resolveRetrievalDimension(right);
    return Boolean(
        left.embeddingSpace
        && left.embeddingSpace === right.embeddingSpace
        && typeof leftDim === 'number'
        && leftDim === rightDim
        && left.modelVersion === right.modelVersion
        && left.artifactVersion === right.artifactVersion,
    );
}

export function assertEmbeddingContractCompatible(
    actual?: Partial<EmbeddingContract> | null,
    required?: Partial<EmbeddingContract> | null,
): asserts actual is Partial<EmbeddingContract> {
    if (!isEmbeddingContractCompatible(actual, required)) {
        throw new Error('embedding_contract_mismatch');
    }
}

export function isVectorCompatibleWithContract(
    vector: unknown,
    contract?: Partial<EmbeddingContract> | null,
): boolean {
    const dimensions = resolveRetrievalDimension(contract);
    return Array.isArray(vector)
        && typeof dimensions === 'number'
        && dimensions > 0
        && vector.length === dimensions
        && vector.every((value) => typeof value === 'number' && Number.isFinite(value));
}

export function buildEmbeddingContract(
    contract: EmbeddingContract,
    dimensions: number,
): EmbeddingContract {
    return {
        ...contract,
        dimensions,
        retrievalEmbeddingDim: dimensions,
        rankingEmbeddingDim: dimensions,
    };
}

function resolveRetrievalDimension(contract?: Partial<EmbeddingContract> | null): number | undefined {
    if (typeof contract?.retrievalEmbeddingDim === 'number') {
        return contract.retrievalEmbeddingDim;
    }
    if (typeof contract?.dimensions === 'number') {
        return contract.dimensions;
    }
    return undefined;
}
