import type { EmbeddingContract } from './embeddingContract';

// 默认占位的启发式模型版本标识，严禁当作真实语义向量放行
const DEFAULT_HEURISTIC_MODEL_VERSION = 'heuristic_embedding_contract_v1';

// 受信任的 V3 语义嵌入键名白名单（严格禁止未知扩展字段透传）
const EMBEDDING_CONTRACT_EXACT_KEYS = new Set<string>([
    'embeddingSpace',
    'dimensions',
    'retrievalEmbeddingDim',
    'rankingEmbeddingDim',
    'modelVersion',
    'artifactVersion',
    'producer',
    'semantic',
]);

// 受信任的语义向量空间集合
const TRUSTED_SEMANTIC_EMBEDDING_SPACES = new Set<string>([
    'recommendation_two_tower_v3',
    'recommendation_two_tower_v1',
    'semantic_post_bge_m3_v3',
    'semantic_news_v1',
]);

// 受信任的语义向量生产者集合（拒绝未授权外部生产者）
const TRUSTED_SEMANTIC_EMBEDDING_PRODUCERS = new Set<string>([
    'ml-services',
    'ml-worker',
    'PostSemanticBackfillJob',
    'NewsService',
]);

/**
 * V3 用户侧双塔语义检索标准契约
 */
export const V3_SEMANTIC_USER_TWO_TOWER_EMBEDDING_CONTRACT: EmbeddingContract = {
    embeddingSpace: 'recommendation_two_tower_v3',
    dimensions: 256,
    retrievalEmbeddingDim: 256,
    rankingEmbeddingDim: 256,
    modelVersion: 'two_tower_v3',
    artifactVersion: 'two_tower_v3_artifact_v1',
    producer: 'ml-services',
    semantic: true,
};

/**
 * V3 帖子侧 BGE-M3 语义回刷标准契约
 */
export const V3_SEMANTIC_POST_EMBEDDING_CONTRACT: EmbeddingContract = {
    embeddingSpace: 'semantic_post_bge_m3_v3',
    dimensions: 256,
    retrievalEmbeddingDim: 256,
    rankingEmbeddingDim: 256,
    modelVersion: 'bge_m3_post_semantic_v3',
    artifactVersion: 'post_semantic_v3_artifact_v1',
    producer: 'PostSemanticBackfillJob',
    semantic: true,
};

/**
 * 校验契约是否来自受信任的 V3 语义向量血统，并严格阻止默认占位契约、本地启发式契约及未授权扩展字段
 */
export function isKnownSemanticEmbeddingContract(contract: unknown): contract is EmbeddingContract {
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
        return false;
    }

    const keys = Object.keys(contract);
    if (keys.length !== EMBEDDING_CONTRACT_EXACT_KEYS.size) {
        return false;
    }
    if (!keys.every((key) => EMBEDDING_CONTRACT_EXACT_KEYS.has(key))) {
        return false;
    }

    const candidate = contract as Partial<EmbeddingContract>;
    if (candidate.semantic !== true) {
        return false;
    }
    if (candidate.modelVersion === DEFAULT_HEURISTIC_MODEL_VERSION) {
        return false;
    }

    return typeof candidate.embeddingSpace === 'string'
        && TRUSTED_SEMANTIC_EMBEDDING_SPACES.has(candidate.embeddingSpace)
        && typeof candidate.producer === 'string'
        && TRUSTED_SEMANTIC_EMBEDDING_PRODUCERS.has(candidate.producer)
        && typeof candidate.modelVersion === 'string'
        && candidate.modelVersion.trim().length > 0
        && typeof candidate.artifactVersion === 'string'
        && candidate.artifactVersion.trim().length > 0;
}
