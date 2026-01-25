/**
 * SimClustersService - SimClusters 嵌入计算服务
 * 
 * 复刻 X Algorithm 的 SimClusters 核心功能
 * 参考: https://github.com/twitter/the-algorithm/blob/main/src/scala/com/twitter/simclusters_v2/README.md
 * 
 * 核心功能:
 * - 计算用户 InterestedIn 嵌入 (基于关注列表)
 * - 计算用户 ProducerEmbedding (基于粉丝列表)
 * - 用户相似度计算
 * - 嵌入缓存管理
 */

import UserFeatureVector, {
    IUserFeatureVector,
    SparseVectorElement,
    EmbeddingType
} from '../../models/UserFeatureVector';
import ClusterDefinition, { IClusterDefinition } from '../../models/ClusterDefinition';
import RealGraphEdge from '../../models/RealGraphEdge';
import { redis } from '../../config/redis';

// ========== 配置常量 ==========
const CONFIG = {
    // InterestedIn 计算参数
    interestedIn: {
        maxFollows: 1000,           // 最多使用的关注数
        maxClusters: 50,            // 最多保留的聚类数
        minScore: 0.01,             // 最小分数阈值
    },

    // ProducerEmbedding 计算参数
    producer: {
        maxFollowers: 5000,         // 最多使用的粉丝数
        maxClusters: 100,           // 最多保留的聚类数
        minScore: 0.005,
    },

    // 缓存配置
    cache: {
        ttlSeconds: 6 * 60 * 60,    // 6 小时
        keyPrefix: 'sc:embed:',
    },

    // 嵌入维度
    embeddingDim: 64,               // Two-Tower 嵌入维度
    phoenixDim: 256,                // Phoenix 嵌入维度
};

// ========== 辅助函数 ==========

/**
 * 稀疏向量归一化 (L2)
 */
function normalizeSparseVector(vec: SparseVectorElement[]): SparseVectorElement[] {
    const norm = Math.sqrt(vec.reduce((sum, e) => sum + e.score * e.score, 0));
    if (norm === 0) return vec;
    return vec.map(e => ({ clusterId: e.clusterId, score: e.score / norm }));
}

/**
 * 稀疏向量点积
 */
function sparseVectorDotProduct(
    vec1: SparseVectorElement[],
    vec2: SparseVectorElement[]
): number {
    const map2 = new Map(vec2.map(e => [e.clusterId, e.score]));
    let dot = 0;
    for (const e of vec1) {
        const score2 = map2.get(e.clusterId);
        if (score2 !== undefined) {
            dot += e.score * score2;
        }
    }
    return dot;
}

/**
 * 稀疏向量相加 (聚合多个用户的嵌入)
 */
function sparseVectorAdd(
    vectors: SparseVectorElement[][],
    weights?: number[]
): SparseVectorElement[] {
    const sumMap = new Map<number, number>();

    for (let i = 0; i < vectors.length; i++) {
        const weight = weights ? weights[i] : 1;
        for (const e of vectors[i]) {
            const current = sumMap.get(e.clusterId) || 0;
            sumMap.set(e.clusterId, current + e.score * weight);
        }
    }

    const result: SparseVectorElement[] = [];
    for (const [clusterId, score] of sumMap) {
        result.push({ clusterId, score });
    }

    // 按分数降序排序
    result.sort((a, b) => b.score - a.score);

    return result;
}

// ========== 主服务类 ==========
export class SimClustersService {
    private static instance: SimClustersService;

    public static getInstance(): SimClustersService {
        if (!SimClustersService.instance) {
            SimClustersService.instance = new SimClustersService();
        }
        return SimClustersService.instance;
    }

    /**
     * 计算用户 InterestedIn 嵌入
     * 
     * 算法:
     * 1. 获取用户关注列表
     * 2. 对每个关注的用户, 获取其 KnownFor 聚类
     * 3. 聚合所有聚类, 使用关系分数加权
     * 4. 归一化并截断
     * 
     * 复刻 SimClusters 的 U = A × V (InterestedIn = Follow × KnownFor)
     */
    async computeInterestedIn(userId: string): Promise<SparseVectorElement[]> {
        // Step 1: 获取用户的 Top 关注 (使用 RealGraph 分数加权)
        const followEdges = await RealGraphEdge.getTopConnections(
            userId,
            CONFIG.interestedIn.maxFollows
        );

        if (followEdges.length === 0) {
            return [];
        }

        // Step 2: 获取关注用户的 KnownFor 信息
        const followedUserIds = followEdges.map(e => e.targetUserId);

        // 批量查询用户的 KnownFor
        const userVectors = await UserFeatureVector.getUserEmbeddingsBatch(followedUserIds);

        // Step 3: 聚合计算 InterestedIn
        // 公式: InterestedIn[c] = Σ(follow_weight[u] × KnownFor[u, c])
        const clusterScores = new Map<number, number>();

        for (const edge of followEdges) {
            const userVec = userVectors.get(edge.targetUserId);
            if (!userVec) continue;

            const knownFor = userVec.knownForCluster;
            const knownForScore = userVec.knownForScore || 0;

            if (knownFor !== undefined && knownForScore > 0) {
                // 使用 RealGraph decayedSum 作为权重
                const weight = Math.log1p(edge.decayedSum);
                const current = clusterScores.get(knownFor) || 0;
                clusterScores.set(knownFor, current + weight * knownForScore);
            }

            // 也考虑 ProducerEmbedding (多社区)
            if (userVec.producerEmbedding) {
                for (const pe of userVec.producerEmbedding) {
                    const weight = Math.log1p(edge.decayedSum) * 0.5; // 降低权重
                    const current = clusterScores.get(pe.clusterId) || 0;
                    clusterScores.set(pe.clusterId, current + weight * pe.score);
                }
            }
        }

        // Step 4: 转换为稀疏向量并归一化
        let result: SparseVectorElement[] = [];
        for (const [clusterId, score] of clusterScores) {
            if (score >= CONFIG.interestedIn.minScore) {
                result.push({ clusterId, score });
            }
        }

        // 排序并截断
        result.sort((a, b) => b.score - a.score);
        result = result.slice(0, CONFIG.interestedIn.maxClusters);

        // L2 归一化
        return normalizeSparseVector(result);
    }

    /**
     * 计算用户 ProducerEmbedding
     * 
     * 算法:
     * 1. 获取用户粉丝列表
     * 2. 聚合粉丝的 InterestedIn 嵌入
     * 3. 计算余弦相似度作为 ProducerEmbedding
     * 
     * 复刻 SimClusters 的 Producer Embedding 计算
     */
    async computeProducerEmbedding(userId: string): Promise<SparseVectorElement[]> {
        // Step 1: 获取用户的粉丝 (入边)
        const followerEdges = await RealGraphEdge.find({
            targetUserId: userId,
            decayedSum: { $gt: 0 },
        })
            .sort({ decayedSum: -1 })
            .limit(CONFIG.producer.maxFollowers);

        if (followerEdges.length === 0) {
            return [];
        }

        // Step 2: 获取粉丝的 InterestedIn 嵌入
        const followerIds = followerEdges.map(e => e.sourceUserId);
        const followerVectors = await UserFeatureVector.getUserEmbeddingsBatch(followerIds);

        // Step 3: 聚合粉丝的兴趣
        const vectors: SparseVectorElement[][] = [];
        const weights: number[] = [];

        for (const edge of followerEdges) {
            const vec = followerVectors.get(edge.sourceUserId);
            if (vec && vec.interestedInClusters.length > 0) {
                vectors.push(vec.interestedInClusters);
                weights.push(Math.log1p(edge.decayedSum));
            }
        }

        if (vectors.length === 0) {
            return [];
        }

        // Step 4: 加权聚合
        let result = sparseVectorAdd(vectors, weights);

        // 过滤低分数
        result = result.filter(e => e.score >= CONFIG.producer.minScore);

        // 截断
        result = result.slice(0, CONFIG.producer.maxClusters);

        // 归一化
        return normalizeSparseVector(result);
    }

    /**
     * 获取用户完整嵌入 (带缓存)
     */
    async getUserEmbedding(userId: string): Promise<IUserFeatureVector | null> {
        // 1. 检查缓存
        const cacheKey = `${CONFIG.cache.keyPrefix}${userId}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch {
            // Redis 不可用时继续从 DB 读取
        }

        // 2. 从数据库读取
        const embedding = await UserFeatureVector.getUserEmbedding(userId);

        // 3. 写入缓存
        if (embedding) {
            try {
                await redis.setex(
                    cacheKey,
                    CONFIG.cache.ttlSeconds,
                    JSON.stringify(embedding)
                );
            } catch {
                // 缓存失败不影响主流程
            }
        }

        return embedding;
    }

    /**
     * 计算并存储用户嵌入
     */
    async computeAndStoreEmbedding(userId: string): Promise<IUserFeatureVector> {
        // 并行计算 InterestedIn 和 ProducerEmbedding
        const [interestedIn, producerEmbedding] = await Promise.all([
            this.computeInterestedIn(userId),
            this.computeProducerEmbedding(userId),
        ]);

        // 确定 KnownFor (取 producerEmbedding 中分数最高的)
        let knownForCluster: number | undefined;
        let knownForScore: number | undefined;

        if (producerEmbedding.length > 0) {
            knownForCluster = producerEmbedding[0].clusterId;
            knownForScore = producerEmbedding[0].score;
        }

        // 计算质量分数 (基于嵌入丰富度)
        const qualityScore = Math.min(1, (interestedIn.length + producerEmbedding.length) / 50);

        // 获取当前版本号
        const existing = await UserFeatureVector.findOne({ userId });
        const version = (existing?.version || 0) + 1;

        // 更新存储
        const embedding = await UserFeatureVector.upsertEmbedding(
            userId,
            {
                interestedInClusters: interestedIn,
                producerEmbedding,
                knownForCluster,
                knownForScore,
                qualityScore,
            },
            version
        );

        // 清除缓存
        const cacheKey = `${CONFIG.cache.keyPrefix}${userId}`;
        try {
            await redis.del(cacheKey);
        } catch {
            // 忽略缓存错误
        }

        return embedding;
    }

    /**
     * 批量更新用户嵌入 (定时任务使用)
     */
    async batchUpdateEmbeddings(
        userIds: string[],
        onProgress?: (processed: number, total: number) => void
    ): Promise<{ success: number; failed: number }> {
        let success = 0;
        let failed = 0;

        for (let i = 0; i < userIds.length; i++) {
            try {
                await this.computeAndStoreEmbedding(userIds[i]);
                success++;
            } catch (error) {
                console.error(`[SimClusters] Failed to update embedding for ${userIds[i]}:`, error);
                failed++;
            }

            if (onProgress) {
                onProgress(i + 1, userIds.length);
            }
        }

        return { success, failed };
    }

    /**
     * 计算两个用户的相似度
     */
    async computeUserSimilarity(userId1: string, userId2: string): Promise<number> {
        const [vec1, vec2] = await Promise.all([
            this.getUserEmbedding(userId1),
            this.getUserEmbedding(userId2),
        ]);

        if (!vec1 || !vec2) return 0;
        if (!vec1.interestedInClusters.length || !vec2.interestedInClusters.length) return 0;

        return sparseVectorDotProduct(
            normalizeSparseVector(vec1.interestedInClusters),
            normalizeSparseVector(vec2.interestedInClusters)
        );
    }

    /**
     * 查找与用户兴趣相似的其他用户
     */
    async findSimilarUsers(
        userId: string,
        limit: number = 20
    ): Promise<Array<{ userId: string; similarity: number }>> {
        return UserFeatureVector.findSimilarUsers(userId, limit);
    }

    /**
     * 计算用户对内容的兴趣分数
     * 用于推荐排序
     */
    async computeContentInterest(
        userId: string,
        contentClusterIds: number[]
    ): Promise<number> {
        const userVec = await this.getUserEmbedding(userId);
        if (!userVec || !userVec.interestedInClusters.length) return 0;

        const userMap = new Map(
            userVec.interestedInClusters.map(e => [e.clusterId, e.score])
        );

        let score = 0;
        for (const clusterId of contentClusterIds) {
            const userScore = userMap.get(clusterId);
            if (userScore) {
                score += userScore;
            }
        }

        return score;
    }
}

// ========== 导出单例 ==========
export const simClustersService = SimClustersService.getInstance();
export default simClustersService;
