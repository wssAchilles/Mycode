/**
 * Feature Store - 统一特征存储导出模块
 * 
 * 复刻 X Algorithm 的 Feature Store 架构
 * 将所有特征存储服务整合为统一的访问入口
 * 
 * 功能:
 * - 用户嵌入 (SimClusters)
 * - 社交关系分数 (RealGraph)
 * - 用户信号 (USS)
 * - 聚类定义 (Cluster Definitions)
 * - 缓存管理 (Multi-tier Cache)
 */

// ========== 数据模型 ==========
export { default as UserFeatureVector } from '../../../models/UserFeatureVector';
export type {
    IUserFeatureVector,
    SparseVectorElement,
    EmbeddingType,
} from '../../../models/UserFeatureVector';

export { default as RealGraphEdge, DECAY_CONFIG, DEFAULT_COUNTS } from '../../../models/RealGraphEdge';
export type {
    IRealGraphEdge,
    InteractionType,
    InteractionCounts,
} from '../../../models/RealGraphEdge';

export { default as UserSignal, SIGNAL_CONFIG } from '../../../models/UserSignal';
export type {
    IUserSignal,
    SignalType,
    ProductSurface,
    TargetType,
    UserSignalInput,
} from '../../../models/UserSignal';

export { default as ClusterDefinition } from '../../../models/ClusterDefinition';
export type {
    IClusterDefinition,
    ClusterMember,
    ClusterStats,
    ClusterType,
} from '../../../models/ClusterDefinition';

// ========== 服务 ==========
export {
    simClustersService,
    SimClustersService,
} from '../SimClustersService';

export {
    realGraphService,
    RealGraphService,
} from '../RealGraphService';

export {
    userSignalService,
    UserSignalService,
} from '../UserSignalService';

export {
    featureCacheService,
    FeatureCacheService,
} from '../FeatureCacheService';

// ========== 统一特征存储接口 ==========
import { simClustersService } from '../SimClustersService';
import { realGraphService } from '../RealGraphService';
import { userSignalService } from '../UserSignalService';
import { featureCacheService } from '../FeatureCacheService';

/**
 * FeatureStore - 统一的特征存储访问入口
 * 
 * 使用方式:
 * ```typescript
 * import { FeatureStore } from '@/services/recommendation/featureStore';
 * 
 * // 获取用户嵌入
 * const embedding = await FeatureStore.getUserEmbedding(userId);
 * 
 * // 获取社交分数
 * const score = await FeatureStore.getEdgeScore(sourceId, targetId);
 * 
 * // 记录用户信号
 * await FeatureStore.logSignal({ ... });
 * ```
 */
export const FeatureStore = {
    // ========== SimClusters 嵌入 ==========

    /** 获取用户嵌入 (带缓存) */
    getUserEmbedding: (userId: string) =>
        featureCacheService.getUserEmbedding(userId),

    /** 批量获取用户嵌入 */
    getUserEmbeddingsBatch: (userIds: string[]) =>
        featureCacheService.getUserEmbeddingsBatch(userIds),

    /** 计算并存储用户嵌入 */
    computeUserEmbedding: (userId: string) =>
        simClustersService.computeAndStoreEmbedding(userId),

    /** 计算用户相似度 */
    getUserSimilarity: (userId1: string, userId2: string) =>
        simClustersService.computeUserSimilarity(userId1, userId2),

    /** 查找相似用户 */
    findSimilarUsers: (userId: string, limit: number = 20) =>
        simClustersService.findSimilarUsers(userId, limit),

    // ========== RealGraph 社交分数 ==========

    /** 获取边分数 (带缓存) */
    getEdgeScore: (sourceUserId: string, targetUserId: string) =>
        featureCacheService.getEdgeScore(sourceUserId, targetUserId),

    /** 批量获取边分数 */
    getEdgeScoresBatch: (
        pairs: Array<{ sourceUserId: string; targetUserId: string }>
    ) => featureCacheService.getEdgeScoresBatch(pairs),

    /** 记录交互 */
    recordInteraction: realGraphService.recordInteraction.bind(realGraphService),

    /** 获取用户 Top 亲密关系 */
    getTopConnections: (userId: string, limit: number = 50) =>
        realGraphService.getTopConnections(userId, limit),

    /** 预测交互概率 */
    predictInteraction: (sourceUserId: string, targetUserId: string) =>
        realGraphService.predictInteractionProbability(sourceUserId, targetUserId),

    // ========== 用户信号 ==========

    /** 记录信号 */
    logSignal: userSignalService.logSignal.bind(userSignalService),

    /** 批量记录信号 */
    logSignalsBatch: userSignalService.logSignalsBatch.bind(userSignalService),

    /** 获取用户最近信号 */
    getRecentSignals: userSignalService.getRecentSignals.bind(userSignalService),

    /** 获取用户信号特征 */
    getUserSignalFeatures: (userId: string, days: number = 7) =>
        userSignalService.getUserSignalFeatures(userId, days),

    // ========== 聚类定义 ==========

    /** 获取聚类定义 (带缓存) */
    getCluster: (clusterId: number) =>
        featureCacheService.getCluster(clusterId),

    /** 批量获取聚类 */
    getClustersBatch: (clusterIds: number[]) =>
        featureCacheService.getClustersBatch(clusterIds),

    // ========== 缓存管理 ==========

    /** 清除 L1 缓存 */
    clearCache: () => featureCacheService.clearL1Cache(),

    /** 获取缓存统计 */
    getCacheStats: () => featureCacheService.getCacheStats(),

    // ========== 服务引用 (高级用法) ==========
    services: {
        simClusters: simClustersService,
        realGraph: realGraphService,
        userSignal: userSignalService,
        cache: featureCacheService,
    },
};

export default FeatureStore;
