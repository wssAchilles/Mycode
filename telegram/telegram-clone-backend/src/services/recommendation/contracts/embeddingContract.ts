export interface EmbeddingContract {
    embeddingSpace: string;
    retrievalEmbeddingDim: number;
    rankingEmbeddingDim: number;
    modelVersion: string;
    artifactVersion: string;
    producer: string;
}

export const DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT: EmbeddingContract = {
    embeddingSpace: 'recommendation_two_tower_v1',
    retrievalEmbeddingDim: 256,
    rankingEmbeddingDim: 256,
    modelVersion: 'heuristic_embedding_contract_v1',
    artifactVersion: 'local_artifact_v1',
    producer: 'telegram-clone-backend',
};

export function isEmbeddingContractCompatible(
    left?: Partial<EmbeddingContract> | null,
    right?: Partial<EmbeddingContract> | null,
): boolean {
    if (!left || !right) return false;
    return Boolean(
        left.embeddingSpace
        && left.embeddingSpace === right.embeddingSpace
        && left.retrievalEmbeddingDim === right.retrievalEmbeddingDim
        && left.modelVersion === right.modelVersion
        && left.artifactVersion === right.artifactVersion,
    );
}

export function isVectorCompatibleWithContract(
    vector: unknown,
    contract?: Partial<EmbeddingContract> | null,
): boolean {
    return Array.isArray(vector)
        && typeof contract?.retrievalEmbeddingDim === 'number'
        && vector.length === contract.retrievalEmbeddingDim;
}
