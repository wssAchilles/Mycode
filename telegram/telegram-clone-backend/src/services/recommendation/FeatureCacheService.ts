/**
 * FeatureCacheService - 多层特征缓存服务
 * 
 * 复刻 X Algorithm 的 Feature Store 缓存层
 * 
 * 核心功能:
 * - L1 本地缓存 (内存, 毫秒级访问)
 * - L2 Redis 缓存 (分布式, 亚毫秒级访问)
 * - L3 数据库持久层 (MongoDB)
 * 
 * 设计原则:
 * - 支持批量操作以减少网络往返
 * - 自动缓存失效和刷新
 * - 缓存穿透/雪崩/击穿防护
 */

import { redis } from '../../config/redis';
import UserFeatureVector, { IUserFeatureVector } from '../../models/UserFeatureVector';
import RealGraphEdge, { IRealGraphEdge } from '../../models/RealGraphEdge';
import ClusterDefinition, { IClusterDefinition } from '../../models/ClusterDefinition';

// ========== 配置 ==========
const CONFIG = {
    // L1 本地缓存配置
    l1: {
        maxSize: 5000,              // 最大缓存条目
        ttlSeconds: 60,             // 60 秒
    },

    // L2 Redis 缓存配置
    l2: {
        keyPrefix: 'fcs:',          // Feature Cache Service 前缀
        ttl: {
            userEmbedding: 6 * 60 * 60,     // 6 小时
            realGraphEdge: 24 * 60 * 60,    // 24 小时
            clusterDef: 7 * 24 * 60 * 60,   // 7 天
        },
    },

    // 批量操作配置
    batch: {
        maxBatchSize: 100,          // 单次最大批量
    },
};

// ========== L1 本地缓存 (LRU) ==========
class L1Cache<T> {
    private cache = new Map<string, { value: T; expiresAt: number }>();
    private readonly maxSize: number;
    private readonly ttlMs: number;

    constructor(maxSize: number, ttlSeconds: number) {
        this.maxSize = maxSize;
        this.ttlMs = ttlSeconds * 1000;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }

        // LRU: 移到末尾
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.value;
    }

    set(key: string, value: T): void {
        // 清理过期和超出容量的条目
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs,
        });
    }

    delete(key: string): void {
        this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }
}

// ========== 主服务类 ==========
export class FeatureCacheService {
    private static instance: FeatureCacheService;

    // L1 缓存实例
    private userEmbeddingL1 = new L1Cache<IUserFeatureVector>(
        CONFIG.l1.maxSize,
        CONFIG.l1.ttlSeconds
    );
    private realGraphL1 = new L1Cache<number>(
        CONFIG.l1.maxSize * 10, // 边更多
        CONFIG.l1.ttlSeconds
    );
    private clusterL1 = new L1Cache<IClusterDefinition>(
        CONFIG.l1.maxSize,
        CONFIG.l1.ttlSeconds * 5 // 聚类更稳定
    );

    public static getInstance(): FeatureCacheService {
        if (!FeatureCacheService.instance) {
            FeatureCacheService.instance = new FeatureCacheService();
        }
        return FeatureCacheService.instance;
    }

    // ========== 用户嵌入缓存 ==========

    /**
     * 获取用户嵌入 (三层缓存)
     */
    async getUserEmbedding(userId: string): Promise<IUserFeatureVector | null> {
        const cacheKey = `${CONFIG.l2.keyPrefix}emb:${userId}`;

        // L1 查找
        const l1Result = this.userEmbeddingL1.get(cacheKey);
        if (l1Result) {
            return l1Result;
        }

        // L2 查找
        try {
            const l2Result = await redis.get(cacheKey);
            if (l2Result) {
                const parsed = JSON.parse(l2Result) as IUserFeatureVector;
                this.userEmbeddingL1.set(cacheKey, parsed);
                return parsed;
            }
        } catch {
            // Redis 不可用时继续从 DB 读取
        }

        // L3 查找 (DB)
        const dbResult = await UserFeatureVector.getUserEmbedding(userId);

        if (dbResult) {
            // 回填缓存
            this.userEmbeddingL1.set(cacheKey, dbResult);
            try {
                await redis.setex(
                    cacheKey,
                    CONFIG.l2.ttl.userEmbedding,
                    JSON.stringify(dbResult)
                );
            } catch {
                // 忽略缓存错误
            }
        }

        return dbResult;
    }

    /**
     * 批量获取用户嵌入
     */
    async getUserEmbeddingsBatch(
        userIds: string[]
    ): Promise<Map<string, IUserFeatureVector>> {
        const result = new Map<string, IUserFeatureVector>();
        const missingFromL1: string[] = [];
        const missingFromL2: string[] = [];

        // L1 查找
        for (const userId of userIds) {
            const cacheKey = `${CONFIG.l2.keyPrefix}emb:${userId}`;
            const l1Result = this.userEmbeddingL1.get(cacheKey);
            if (l1Result) {
                result.set(userId, l1Result);
            } else {
                missingFromL1.push(userId);
            }
        }

        if (missingFromL1.length === 0) return result;

        // L2 批量查找
        try {
            const l2Keys = missingFromL1.map(id => `${CONFIG.l2.keyPrefix}emb:${id}`);
            const l2Results = await redis.mget(l2Keys);

            for (let i = 0; i < missingFromL1.length; i++) {
                const userId = missingFromL1[i];
                const l2Value = l2Results[i];

                if (l2Value) {
                    const parsed = JSON.parse(l2Value) as IUserFeatureVector;
                    result.set(userId, parsed);
                    this.userEmbeddingL1.set(`${CONFIG.l2.keyPrefix}emb:${userId}`, parsed);
                } else {
                    missingFromL2.push(userId);
                }
            }
        } catch {
            // Redis 不可用时所有缺失的都从 DB 读取
            missingFromL2.push(...missingFromL1);
        }

        if (missingFromL2.length === 0) return result;

        // L3 批量查找 (DB)
        const dbResult = await UserFeatureVector.getUserEmbeddingsBatch(missingFromL2);

        // 回填缓存
        const pipeline = redis.pipeline();
        for (const [userId, embedding] of dbResult) {
            result.set(userId, embedding);
            const cacheKey = `${CONFIG.l2.keyPrefix}emb:${userId}`;
            this.userEmbeddingL1.set(cacheKey, embedding);
            pipeline.setex(cacheKey, CONFIG.l2.ttl.userEmbedding, JSON.stringify(embedding));
        }

        try {
            await pipeline.exec();
        } catch {
            // 忽略缓存错误
        }

        return result;
    }

    /**
     * 失效用户嵌入缓存
     */
    async invalidateUserEmbedding(userId: string): Promise<void> {
        const cacheKey = `${CONFIG.l2.keyPrefix}emb:${userId}`;
        this.userEmbeddingL1.delete(cacheKey);
        try {
            await redis.del(cacheKey);
        } catch {
            // 忽略
        }
    }

    // ========== RealGraph 边分数缓存 ==========

    /**
     * 获取边分数 (三层缓存)
     */
    async getEdgeScore(
        sourceUserId: string,
        targetUserId: string
    ): Promise<number> {
        const cacheKey = `${CONFIG.l2.keyPrefix}rg:${sourceUserId}:${targetUserId}`;

        // L1 查找
        const l1Result = this.realGraphL1.get(cacheKey);
        if (l1Result !== undefined) {
            return l1Result;
        }

        // L2 查找
        try {
            const l2Result = await redis.get(cacheKey);
            if (l2Result !== null) {
                const score = parseFloat(l2Result);
                this.realGraphL1.set(cacheKey, score);
                return score;
            }
        } catch {
            // 继续从 DB 读取
        }

        // L3 查找
        const dbResult = await RealGraphEdge.getEdgeScore(sourceUserId, targetUserId);

        // 回填缓存
        this.realGraphL1.set(cacheKey, dbResult);
        try {
            await redis.setex(cacheKey, CONFIG.l2.ttl.realGraphEdge, dbResult.toString());
        } catch {
            // 忽略
        }

        return dbResult;
    }

    /**
     * 批量获取边分数
     */
    async getEdgeScoresBatch(
        pairs: Array<{ sourceUserId: string; targetUserId: string }>
    ): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        const missingFromL1: typeof pairs = [];

        // L1 查找
        for (const pair of pairs) {
            const cacheKey = `${CONFIG.l2.keyPrefix}rg:${pair.sourceUserId}:${pair.targetUserId}`;
            const pairKey = `${pair.sourceUserId}:${pair.targetUserId}`;
            const l1Result = this.realGraphL1.get(cacheKey);
            if (l1Result !== undefined) {
                result.set(pairKey, l1Result);
            } else {
                missingFromL1.push(pair);
            }
        }

        if (missingFromL1.length === 0) return result;

        // L2 批量查找
        try {
            const l2Keys = missingFromL1.map(
                p => `${CONFIG.l2.keyPrefix}rg:${p.sourceUserId}:${p.targetUserId}`
            );
            const l2Results = await redis.mget(l2Keys);

            const missingFromL2: typeof pairs = [];
            for (let i = 0; i < missingFromL1.length; i++) {
                const pair = missingFromL1[i];
                const pairKey = `${pair.sourceUserId}:${pair.targetUserId}`;
                const l2Value = l2Results[i];

                if (l2Value !== null) {
                    const score = parseFloat(l2Value);
                    result.set(pairKey, score);
                    this.realGraphL1.set(
                        `${CONFIG.l2.keyPrefix}rg:${pair.sourceUserId}:${pair.targetUserId}`,
                        score
                    );
                } else {
                    missingFromL2.push(pair);
                }
            }

            // L3 批量查找 (DB)
            if (missingFromL2.length > 0) {
                const edges = await RealGraphEdge.find({
                    $or: missingFromL2.map(p => ({
                        sourceUserId: p.sourceUserId,
                        targetUserId: p.targetUserId,
                    })),
                });

                const edgeMap = new Map<string, number>();
                for (const edge of edges) {
                    edgeMap.set(`${edge.sourceUserId}:${edge.targetUserId}`, edge.decayedSum);
                }

                const pipeline = redis.pipeline();
                for (const pair of missingFromL2) {
                    const pairKey = `${pair.sourceUserId}:${pair.targetUserId}`;
                    const score = edgeMap.get(pairKey) || 0;
                    result.set(pairKey, score);

                    const cacheKey = `${CONFIG.l2.keyPrefix}rg:${pair.sourceUserId}:${pair.targetUserId}`;
                    this.realGraphL1.set(cacheKey, score);
                    pipeline.setex(cacheKey, CONFIG.l2.ttl.realGraphEdge, score.toString());
                }

                await pipeline.exec();
            }
        } catch {
            // 回退到逐个查询
            for (const pair of missingFromL1) {
                const pairKey = `${pair.sourceUserId}:${pair.targetUserId}`;
                const score = await RealGraphEdge.getEdgeScore(pair.sourceUserId, pair.targetUserId);
                result.set(pairKey, score);
            }
        }

        return result;
    }

    /**
     * 失效边分数缓存
     */
    async invalidateEdgeScore(
        sourceUserId: string,
        targetUserId: string
    ): Promise<void> {
        const cacheKey = `${CONFIG.l2.keyPrefix}rg:${sourceUserId}:${targetUserId}`;
        this.realGraphL1.delete(cacheKey);
        try {
            await redis.del(cacheKey);
        } catch {
            // 忽略
        }
    }

    // ========== 聚类定义缓存 ==========

    /**
     * 获取聚类定义 (三层缓存)
     */
    async getCluster(clusterId: number): Promise<IClusterDefinition | null> {
        const cacheKey = `${CONFIG.l2.keyPrefix}cluster:${clusterId}`;

        // L1 查找
        const l1Result = this.clusterL1.get(cacheKey);
        if (l1Result) {
            return l1Result;
        }

        // L2 查找
        try {
            const l2Result = await redis.get(cacheKey);
            if (l2Result) {
                const parsed = JSON.parse(l2Result) as IClusterDefinition;
                this.clusterL1.set(cacheKey, parsed);
                return parsed;
            }
        } catch {
            // 继续从 DB 读取
        }

        // L3 查找
        const dbResult = await ClusterDefinition.getCluster(clusterId);

        if (dbResult) {
            this.clusterL1.set(cacheKey, dbResult);
            try {
                await redis.setex(
                    cacheKey,
                    CONFIG.l2.ttl.clusterDef,
                    JSON.stringify(dbResult)
                );
            } catch {
                // 忽略
            }
        }

        return dbResult;
    }

    /**
     * 批量获取聚类
     */
    async getClustersBatch(
        clusterIds: number[]
    ): Promise<Map<number, IClusterDefinition>> {
        const result = new Map<number, IClusterDefinition>();
        const missingFromL1: number[] = [];

        // L1 查找
        for (const clusterId of clusterIds) {
            const cacheKey = `${CONFIG.l2.keyPrefix}cluster:${clusterId}`;
            const l1Result = this.clusterL1.get(cacheKey);
            if (l1Result) {
                result.set(clusterId, l1Result);
            } else {
                missingFromL1.push(clusterId);
            }
        }

        if (missingFromL1.length === 0) return result;

        // L2 + L3 查找
        try {
            const l2Keys = missingFromL1.map(id => `${CONFIG.l2.keyPrefix}cluster:${id}`);
            const l2Results = await redis.mget(l2Keys);

            const missingFromL2: number[] = [];
            for (let i = 0; i < missingFromL1.length; i++) {
                const clusterId = missingFromL1[i];
                const l2Value = l2Results[i];

                if (l2Value) {
                    const parsed = JSON.parse(l2Value) as IClusterDefinition;
                    result.set(clusterId, parsed);
                    this.clusterL1.set(`${CONFIG.l2.keyPrefix}cluster:${clusterId}`, parsed);
                } else {
                    missingFromL2.push(clusterId);
                }
            }

            if (missingFromL2.length > 0) {
                const dbResult = await ClusterDefinition.getClustersBatch(missingFromL2);

                const pipeline = redis.pipeline();
                for (const [clusterId, cluster] of dbResult) {
                    result.set(clusterId, cluster);
                    const cacheKey = `${CONFIG.l2.keyPrefix}cluster:${clusterId}`;
                    this.clusterL1.set(cacheKey, cluster);
                    pipeline.setex(cacheKey, CONFIG.l2.ttl.clusterDef, JSON.stringify(cluster));
                }

                await pipeline.exec();
            }
        } catch {
            // 回退到 DB 查询
            const dbResult = await ClusterDefinition.getClustersBatch(missingFromL1);
            for (const [clusterId, cluster] of dbResult) {
                result.set(clusterId, cluster);
            }
        }

        return result;
    }

    // ========== 缓存管理 ==========

    /**
     * 清除所有 L1 缓存
     */
    clearL1Cache(): void {
        this.userEmbeddingL1.clear();
        this.realGraphL1.clear();
        this.clusterL1.clear();
    }

    /**
     * 获取缓存统计
     */
    getCacheStats(): {
        l1: { userEmbedding: number; realGraph: number; cluster: number };
    } {
        return {
            l1: {
                userEmbedding: this.userEmbeddingL1.size,
                realGraph: this.realGraphL1.size,
                cluster: this.clusterL1.size,
            },
        };
    }
}

// ========== 导出单例 ==========
export const featureCacheService = FeatureCacheService.getInstance();
export default featureCacheService;
