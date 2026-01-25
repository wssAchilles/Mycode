/**
 * RealGraphService - 社交关系分数服务
 * 
 * 复刻 X Algorithm 的 Real Graph
 * 参考: https://github.com/twitter/the-algorithm/blob/main/src/scala/com/twitter/interaction_graph/README.md
 * 
 * 核心功能:
 * - 记录用户间交互 (公开 + 私密)
 * - 计算衰减聚合分数
 * - ML 预测交互概率
 * - 管理每日衰减任务
 */

import RealGraphEdge, {
    IRealGraphEdge,
    InteractionType,
    InteractionCounts,
    DECAY_CONFIG
} from '../../models/RealGraphEdge';
import { redis } from '../../config/redis';

// ========== 配置常量 ==========
const CONFIG = {
    // 缓存配置
    cache: {
        ttlSeconds: 24 * 60 * 60,  // 24 小时
        keyPrefix: 'rg:score:',
    },

    // 预测模型配置 (梯度提升树参数)
    model: {
        // 特征权重 (简化的线性模型, 可替换为真实 GBT)
        featureWeights: {
            followScore: 0.3,
            likeCount: 0.15,
            replyCount: 0.25,
            retweetCount: 0.1,
            profileViewCount: 0.1,
            dwellTimeMs: 0.001,
            recency: 0.1,
        },
        // Sigmoid 参数
        sigmoidScale: 0.1,
    },

    // 衰减任务配置
    decayJob: {
        batchSize: 5000,             // 每批处理数量
        maxDailyBatches: 100,        // 每天最大批次
    },

    // 查询限制
    query: {
        defaultTopN: 50,              // 默认返回 Top-N
        maxTopN: 500,                 // 最大 Top-N
    },
};

// ========== 辅助函数 ==========

/**
 * Sigmoid 函数 (用于将分数映射到 0-1 概率)
 */
function sigmoid(x: number, scale: number = 1): number {
    return 1 / (1 + Math.exp(-x * scale));
}

/**
 * 计算 recency 分数 (基于最后交互时间)
 */
function computeRecencyScore(lastInteractionAt: Date): number {
    const daysSince = (Date.now() - lastInteractionAt.getTime()) / (24 * 60 * 60 * 1000);
    // 指数衰减: 半衰期 7 天
    return Math.exp(-daysSince / 7);
}

// ========== 主服务类 ==========
export class RealGraphService {
    private static instance: RealGraphService;

    public static getInstance(): RealGraphService {
        if (!RealGraphService.instance) {
            RealGraphService.instance = new RealGraphService();
        }
        return RealGraphService.instance;
    }

    /**
     * 记录用户交互
     * 
     * 每次交互都会:
     * 1. 更新 dailyCounts 和 rollupCounts
     * 2. 重新计算 decayedSum
     * 3. 清除缓存
     */
    async recordInteraction(
        sourceUserId: string,
        targetUserId: string,
        interactionType: InteractionType,
        value: number = 1
    ): Promise<IRealGraphEdge> {
        // 使用模型的静态方法记录
        const edge = await RealGraphEdge.recordInteraction(
            sourceUserId,
            targetUserId,
            interactionType,
            value
        );

        // 清除缓存
        await this.invalidateCache(sourceUserId, targetUserId);

        return edge;
    }

    /**
     * 批量记录交互 (高效)
     */
    async recordInteractionsBatch(
        interactions: Array<{
            sourceUserId: string;
            targetUserId: string;
            interactionType: InteractionType;
            value?: number;
        }>
    ): Promise<void> {
        // 使用 bulkWrite 批量更新
        const operations = interactions.map(i => {
            const fieldMap: Record<InteractionType, keyof InteractionCounts> = {
                [InteractionType.FOLLOW]: 'followCount',
                [InteractionType.LIKE]: 'likeCount',
                [InteractionType.REPLY]: 'replyCount',
                [InteractionType.RETWEET]: 'retweetCount',
                [InteractionType.QUOTE]: 'quoteCount',
                [InteractionType.MENTION]: 'mentionCount',
                [InteractionType.PROFILE_VIEW]: 'profileViewCount',
                [InteractionType.TWEET_CLICK]: 'tweetClickCount',
                [InteractionType.DWELL]: 'dwellTimeMs',
                [InteractionType.MUTE]: 'muteCount',
                [InteractionType.BLOCK]: 'blockCount',
                [InteractionType.UNFOLLOW]: 'followCount',
                [InteractionType.REPORT]: 'reportCount',
                [InteractionType.ADDRESS_BOOK]: 'followCount',
            };

            const field = fieldMap[i.interactionType];
            const value = i.value ?? 1;
            const isUnfollow = i.interactionType === InteractionType.UNFOLLOW;

            return {
                updateOne: {
                    filter: { sourceUserId: i.sourceUserId, targetUserId: i.targetUserId },
                    update: {
                        $inc: {
                            [`dailyCounts.${field}`]: isUnfollow ? -value : value,
                            [`rollupCounts.${field}`]: isUnfollow ? -value : value,
                        },
                        $set: { lastInteractionAt: new Date() },
                        $setOnInsert: {
                            firstInteractionAt: new Date(),
                            lastDecayAppliedAt: new Date(),
                        },
                    },
                    upsert: true,
                },
            };
        });

        await RealGraphEdge.bulkWrite(operations);

        // 批量清除缓存
        const cacheKeys = interactions.map(i =>
            `${CONFIG.cache.keyPrefix}${i.sourceUserId}:${i.targetUserId}`
        );

        try {
            if (cacheKeys.length > 0) {
                await redis.del(...cacheKeys);
            }
        } catch {
            // 缓存失败不影响主流程
        }
    }

    /**
     * 获取边分数 (带缓存)
     */
    async getEdgeScore(
        sourceUserId: string,
        targetUserId: string
    ): Promise<number> {
        const cacheKey = `${CONFIG.cache.keyPrefix}${sourceUserId}:${targetUserId}`;

        // 1. 检查缓存
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return parseFloat(cached);
            }
        } catch {
            // Redis 不可用时继续从 DB 读取
        }

        // 2. 从数据库读取
        const score = await RealGraphEdge.getEdgeScore(sourceUserId, targetUserId);

        // 3. 写入缓存
        try {
            await redis.setex(cacheKey, CONFIG.cache.ttlSeconds, score.toString());
        } catch {
            // 缓存失败不影响主流程
        }

        return score;
    }

    /**
     * 获取用户 Top-N 亲密关系
     */
    async getTopConnections(
        userId: string,
        limit: number = CONFIG.query.defaultTopN
    ): Promise<IRealGraphEdge[]> {
        const safeLimit = Math.min(limit, CONFIG.query.maxTopN);
        return RealGraphEdge.getTopConnections(userId, safeLimit);
    }

    /**
     * 获取双向关系分数
     */
    async getMutualScore(userId1: string, userId2: string): Promise<number> {
        return RealGraphEdge.getMutualScore(userId1, userId2);
    }

    /**
     * 预测交互概率
     * 
     * 使用简化的线性模型 (可替换为真实的 GBT 模型)
     * 复刻 real-graph 的 ML 预测功能
     */
    async predictInteractionProbability(
        sourceUserId: string,
        targetUserId: string
    ): Promise<number> {
        const edge = await RealGraphEdge.findOne({ sourceUserId, targetUserId });

        if (!edge) {
            return 0.01; // 无历史交互的默认概率
        }

        const counts = edge.rollupCounts;
        const weights = CONFIG.model.featureWeights;

        // 计算特征加权和
        let score = 0;
        score += counts.followCount > 0 ? weights.followScore : 0;
        score += Math.log1p(counts.likeCount) * weights.likeCount;
        score += Math.log1p(counts.replyCount) * weights.replyCount;
        score += Math.log1p(counts.retweetCount) * weights.retweetCount;
        score += Math.log1p(counts.profileViewCount) * weights.profileViewCount;
        score += Math.log1p(counts.dwellTimeMs / 1000) * weights.dwellTimeMs;

        // 加入 recency 分数
        const recency = computeRecencyScore(edge.lastInteractionAt);
        score += recency * weights.recency;

        // 负向信号惩罚
        if (counts.muteCount > 0) score -= 0.5;
        if (counts.blockCount > 0) return 0;

        // Sigmoid 映射到概率
        return sigmoid(score, CONFIG.model.sigmoidScale);
    }

    /**
     * 批量预测交互概率
     */
    async predictInteractionProbabilityBatch(
        pairs: Array<{ sourceUserId: string; targetUserId: string }>
    ): Promise<Map<string, number>> {
        const result = new Map<string, number>();

        // 批量查询边
        const edges = await RealGraphEdge.find({
            $or: pairs.map(p => ({
                sourceUserId: p.sourceUserId,
                targetUserId: p.targetUserId
            })),
        });

        const edgeMap = new Map<string, IRealGraphEdge>();
        for (const edge of edges) {
            edgeMap.set(`${edge.sourceUserId}:${edge.targetUserId}`, edge);
        }

        // 计算概率
        for (const pair of pairs) {
            const key = `${pair.sourceUserId}:${pair.targetUserId}`;
            const edge = edgeMap.get(key);

            if (!edge) {
                result.set(key, 0.01);
                continue;
            }

            const counts = edge.rollupCounts;
            const weights = CONFIG.model.featureWeights;

            let score = 0;
            score += counts.followCount > 0 ? weights.followScore : 0;
            score += Math.log1p(counts.likeCount) * weights.likeCount;
            score += Math.log1p(counts.replyCount) * weights.replyCount;
            score += Math.log1p(counts.retweetCount) * weights.retweetCount;

            const recency = computeRecencyScore(edge.lastInteractionAt);
            score += recency * weights.recency;

            if (counts.blockCount > 0) {
                result.set(key, 0);
            } else {
                result.set(key, sigmoid(score, CONFIG.model.sigmoidScale));
            }
        }

        return result;
    }

    /**
     * 应用每日衰减 (定时任务)
     * 
     * 复刻 real-graph 的 rollup job:
     * 1. 衰减旧交互权重
     * 2. 重置每日计数
     * 3. 更新预测分数
     */
    async applyDailyDecay(): Promise<{
        totalProcessed: number;
        batches: number;
        errors: number;
    }> {
        let totalProcessed = 0;
        let batches = 0;
        let errors = 0;

        while (batches < CONFIG.decayJob.maxDailyBatches) {
            try {
                const processed = await RealGraphEdge.applyDailyDecay(
                    CONFIG.decayJob.batchSize
                );

                if (processed === 0) {
                    break; // 没有更多需要处理的边
                }

                totalProcessed += processed;
                batches++;

                console.log(`[RealGraph] Decay batch ${batches}: processed ${processed} edges`);

            } catch (error) {
                console.error('[RealGraph] Decay batch error:', error);
                errors++;

                if (errors > 3) {
                    break; // 连续错误时停止
                }
            }
        }

        console.log(`[RealGraph] Daily decay complete: ${totalProcessed} edges in ${batches} batches`);

        return { totalProcessed, batches, errors };
    }

    /**
     * 清除过期边 (可选的清理任务)
     */
    async cleanupStaleEdges(
        minScore: number = DECAY_CONFIG.minRetainScore,
        daysInactive: number = 90
    ): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

        const result = await RealGraphEdge.deleteMany({
            decayedSum: { $lt: minScore },
            lastInteractionAt: { $lt: cutoffDate },
        });

        console.log(`[RealGraph] Cleaned up ${result.deletedCount} stale edges`);

        return result.deletedCount;
    }

    /**
     * 获取用户社交图统计
     */
    async getUserGraphStats(userId: string): Promise<{
        outgoingEdges: number;
        incomingEdges: number;
        totalInteractions: number;
        avgOutgoingScore: number;
        avgIncomingScore: number;
    }> {
        const [outgoing, incoming] = await Promise.all([
            RealGraphEdge.aggregate([
                { $match: { sourceUserId: userId, decayedSum: { $gt: 0 } } },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        totalScore: { $sum: '$decayedSum' },
                    }
                },
            ]),
            RealGraphEdge.aggregate([
                { $match: { targetUserId: userId, decayedSum: { $gt: 0 } } },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        totalScore: { $sum: '$decayedSum' },
                    }
                },
            ]),
        ]);

        const outStats = outgoing[0] || { count: 0, totalScore: 0 };
        const inStats = incoming[0] || { count: 0, totalScore: 0 };

        return {
            outgoingEdges: outStats.count,
            incomingEdges: inStats.count,
            totalInteractions: outStats.count + inStats.count,
            avgOutgoingScore: outStats.count > 0 ? outStats.totalScore / outStats.count : 0,
            avgIncomingScore: inStats.count > 0 ? inStats.totalScore / inStats.count : 0,
        };
    }

    /**
     * 清除缓存
     */
    private async invalidateCache(
        sourceUserId: string,
        targetUserId: string
    ): Promise<void> {
        const cacheKey = `${CONFIG.cache.keyPrefix}${sourceUserId}:${targetUserId}`;
        try {
            await redis.del(cacheKey);
        } catch {
            // 忽略缓存错误
        }
    }
}

// ========== 导出单例 ==========
export const realGraphService = RealGraphService.getInstance();
export default realGraphService;
