/**
 * UserSignalService - 用户信号服务
 * 
 * 复刻 X Algorithm 的 User Signal Service (USS)
 * 参考: https://github.com/twitter/the-algorithm/blob/main/user-signal-service/README.md
 * 
 * 核心功能:
 * - 记录显式和隐式用户信号
 * - 提供统一的信号查询接口
 * - 为候选召回和排序提供特征
 * - 信号聚合和统计
 */

import UserSignal, {
    IUserSignal,
    SignalType,
    ProductSurface,
    TargetType,
    SIGNAL_CONFIG,
    UserSignalInput,
} from '../../models/UserSignal';
import RealGraphEdge, { InteractionType } from '../../models/RealGraphEdge';
import { realGraphService } from './RealGraphService';
import { redis } from '../../config/redis';

// ========== 配置常量 ==========
const CONFIG = {
    // 缓存配置
    cache: {
        ttlSeconds: 60 * 60,         // 1 小时
        keyPrefix: 'uss:signals:',
        maxCachedSignals: 100,       // 缓存最多 100 条信号
    },

    // 实时信号配置
    realtime: {
        bufferSize: 1000,            // 内存缓冲大小
        flushIntervalMs: 5000,       // 刷新间隔 (5秒)
    },

    // 查询限制
    query: {
        defaultLimit: 100,
        maxLimit: 500,
        defaultDays: 7,
    },

    // 信号到 RealGraph 交互类型的映射
    signalToInteraction: {
        [SignalType.FAVORITE]: InteractionType.LIKE,
        [SignalType.RETWEET]: InteractionType.RETWEET,
        [SignalType.REPLY]: InteractionType.REPLY,
        [SignalType.QUOTE]: InteractionType.QUOTE,
        [SignalType.FOLLOW]: InteractionType.FOLLOW,
        [SignalType.UNFOLLOW]: InteractionType.UNFOLLOW,
        [SignalType.BLOCK]: InteractionType.BLOCK,
        [SignalType.MUTE]: InteractionType.MUTE,
        [SignalType.PROFILE_CLICK]: InteractionType.PROFILE_VIEW,
        [SignalType.TWEET_CLICK]: InteractionType.TWEET_CLICK,
        [SignalType.DWELL]: InteractionType.DWELL,
    } as Record<SignalType, InteractionType>,
};

// ========== 信号缓冲区 (用于高吞吐写入) ==========
class SignalBuffer {
    private buffer: UserSignalInput[] = [];
    private flushTimer: NodeJS.Timeout | null = null;

    constructor(
        private maxSize: number,
        private flushIntervalMs: number,
        private onFlush: (signals: UserSignalInput[]) => Promise<void>
    ) {
        this.startFlushTimer();
    }

    add(signal: UserSignalInput): void {
        this.buffer.push(signal);

        if (this.buffer.length >= this.maxSize) {
            this.flush();
        }
    }

    async flush(): Promise<void> {
        if (this.buffer.length === 0) return;

        const toFlush = this.buffer;
        this.buffer = [];

        try {
            await this.onFlush(toFlush);
        } catch (error) {
            console.error('[USS] Buffer flush error:', error);
            // 失败的信号会丢失 (可以添加重试逻辑)
        }
    }

    private startFlushTimer(): void {
        this.flushTimer = setInterval(() => {
            this.flush();
        }, this.flushIntervalMs);
    }

    stop(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        this.flush(); // 最后刷新
    }
}

// ========== 主服务类 ==========
export class UserSignalService {
    private static instance: UserSignalService;
    private signalBuffer: SignalBuffer;

    private constructor() {
        // 初始化信号缓冲区
        this.signalBuffer = new SignalBuffer(
            CONFIG.realtime.bufferSize,
            CONFIG.realtime.flushIntervalMs,
            async (signals) => {
                await UserSignal.logSignalsBatch(signals);
            }
        );
    }

    public static getInstance(): UserSignalService {
        if (!UserSignalService.instance) {
            UserSignalService.instance = new UserSignalService();
        }
        return UserSignalService.instance;
    }

    /**
     * 记录信号 (核心方法)
     * 
     * 流程:
     * 1. 写入信号缓冲区 (异步批量写入 DB)
     * 2. 同步更新 RealGraph 边 (如果是用户间交互)
     * 3. 更新缓存
     */
    async logSignal(signal: {
        userId: string;
        signalType: SignalType;
        targetId: string;
        targetType: TargetType;
        targetAuthorId?: string;
        productSurface: ProductSurface;
        metadata?: Record<string, any>;
    }): Promise<void> {
        // 1. 添加到缓冲区 (异步写入 DB)
        this.signalBuffer.add(signal);

        // 2. 同步更新 RealGraph (用户间交互)
        if (signal.targetAuthorId && signal.targetType === TargetType.POST) {
            const interactionType = CONFIG.signalToInteraction[signal.signalType];

            if (interactionType) {
                // 异步更新 RealGraph (不阻塞主流程)
                realGraphService.recordInteraction(
                    signal.userId,
                    signal.targetAuthorId,
                    interactionType,
                    signal.signalType === SignalType.DWELL
                        ? signal.metadata?.dwellTimeMs
                        : 1
                ).catch(err => {
                    console.error('[USS] RealGraph update error:', err);
                });
            }
        }

        // 3. 更新缓存
        await this.invalidateCache(signal.userId);
    }

    /**
     * 批量记录信号 (高吞吐场景)
     */
    async logSignalsBatch(signals: Array<{
        userId: string;
        signalType: SignalType;
        targetId: string;
        targetType: TargetType;
        targetAuthorId?: string;
        productSurface: ProductSurface;
        metadata?: Record<string, any>;
    }>): Promise<void> {
        // 直接写入 DB (绕过缓冲区)
        await UserSignal.logSignalsBatch(signals);

        // 批量更新 RealGraph
        const interactions: Array<{
            sourceUserId: string;
            targetUserId: string;
            interactionType: InteractionType;
            value?: number;
        }> = [];

        for (const signal of signals) {
            if (signal.targetAuthorId && signal.targetType === TargetType.POST) {
                const interactionType = CONFIG.signalToInteraction[signal.signalType];
                if (interactionType) {
                    interactions.push({
                        sourceUserId: signal.userId,
                        targetUserId: signal.targetAuthorId,
                        interactionType,
                        value: signal.signalType === SignalType.DWELL
                            ? signal.metadata?.dwellTimeMs
                            : 1,
                    });
                }
            }
        }

        if (interactions.length > 0) {
            await realGraphService.recordInteractionsBatch(interactions);
        }

        // 批量清除缓存
        const userIds = [...new Set(signals.map(s => s.userId))];
        await Promise.all(userIds.map(id => this.invalidateCache(id)));
    }

    /**
     * 获取用户最近信号 (带缓存)
     */
    async getRecentSignals(
        userId: string,
        signalTypes?: SignalType[],
        limit: number = CONFIG.query.defaultLimit
    ): Promise<IUserSignal[]> {
        const cacheKey = `${CONFIG.cache.keyPrefix}${userId}`;

        // 1. 尝试从缓存读取
        if (!signalTypes || signalTypes.length === 0) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    const signals = JSON.parse(cached) as IUserSignal[];
                    return signals.slice(0, limit);
                }
            } catch {
                // 缓存失败继续从 DB 读取
            }
        }

        // 2. 从 DB 读取
        const safeLimit = Math.min(limit, CONFIG.query.maxLimit);
        const signals = await UserSignal.getRecentSignals(userId, signalTypes, safeLimit);

        // 3. 更新缓存 (仅当没有过滤条件时)
        if (!signalTypes || signalTypes.length === 0) {
            try {
                await redis.setex(
                    cacheKey,
                    CONFIG.cache.ttlSeconds,
                    JSON.stringify(signals.slice(0, CONFIG.cache.maxCachedSignals))
                );
            } catch {
                // 缓存失败不影响主流程
            }
        }

        return signals;
    }

    /**
     * 获取用户对特定作者的信号
     */
    async getSignalsForAuthor(
        userId: string,
        authorId: string,
        days: number = CONFIG.query.defaultDays
    ): Promise<IUserSignal[]> {
        return UserSignal.getSignalsForAuthor(userId, authorId, days);
    }

    /**
     * 聚合统计用户信号
     */
    async aggregateSignals(
        userId: string,
        days: number = CONFIG.query.defaultDays
    ): Promise<{
        counts: Record<SignalType, number>;
        weightedScore: number;
    }> {
        return UserSignal.aggregateSignals(userId, days);
    }

    /**
     * 检查用户是否有特定信号
     */
    async hasSignal(
        userId: string,
        targetId: string,
        signalType: SignalType
    ): Promise<boolean> {
        return UserSignal.hasSignal(userId, targetId, signalType);
    }

    /**
     * 获取用户信号特征 (用于 ML 排序)
     * 
     * 返回用于 Phoenix 排序的特征向量
     */
    async getUserSignalFeatures(
        userId: string,
        days: number = 7
    ): Promise<{
        // 显式信号计数
        favoriteCount: number;
        retweetCount: number;
        replyCount: number;
        quoteCount: number;
        followCount: number;

        // 隐式信号计数
        clickCount: number;
        videoViewCount: number;
        dwellTimeMs: number;

        // 聚合分数
        engagementScore: number;
        explicitScore: number;
        implicitScore: number;
    }> {
        const { counts, weightedScore } = await this.aggregateSignals(userId, days);

        // 显式信号
        const favoriteCount = counts[SignalType.FAVORITE] || 0;
        const retweetCount = counts[SignalType.RETWEET] || 0;
        const replyCount = counts[SignalType.REPLY] || 0;
        const quoteCount = counts[SignalType.QUOTE] || 0;
        const followCount = counts[SignalType.FOLLOW] || 0;

        // 隐式信号
        const clickCount = counts[SignalType.TWEET_CLICK] || 0;
        const videoViewCount = (counts[SignalType.VIDEO_VIEW] || 0) +
            (counts[SignalType.VIDEO_QUALITY_VIEW] || 0);
        const dwellTimeMs = counts[SignalType.DWELL] || 0;

        // 计算子分数
        const explicitScore = favoriteCount + retweetCount * 2 + replyCount * 3 +
            quoteCount * 2.5 + followCount * 5;
        const implicitScore = clickCount * 0.3 + videoViewCount * 0.5 +
            Math.log1p(dwellTimeMs / 1000) * 0.1;

        return {
            favoriteCount,
            retweetCount,
            replyCount,
            quoteCount,
            followCount,
            clickCount,
            videoViewCount,
            dwellTimeMs,
            engagementScore: weightedScore,
            explicitScore,
            implicitScore,
        };
    }

    /**
     * 获取帖子的信号统计
     */
    async getPostSignalStats(postId: string): Promise<{
        favoriteCount: number;
        retweetCount: number;
        replyCount: number;
        viewCount: number;
        clickCount: number;
    }> {
        const since = new Date();
        since.setDate(since.getDate() - 30);

        const results = await UserSignal.aggregate([
            {
                $match: {
                    targetId: postId,
                    timestamp: { $gte: since },
                },
            },
            {
                $group: {
                    _id: '$signalType',
                    count: { $sum: 1 },
                },
            },
        ]);

        const counts: Record<string, number> = {};
        for (const r of results) {
            counts[r._id] = r.count;
        }

        return {
            favoriteCount: counts[SignalType.FAVORITE] || 0,
            retweetCount: counts[SignalType.RETWEET] || 0,
            replyCount: counts[SignalType.REPLY] || 0,
            viewCount: counts[SignalType.IMPRESSION] || 0,
            clickCount: counts[SignalType.TWEET_CLICK] || 0,
        };
    }

    /**
     * 获取信号权重
     */
    getSignalWeight(signalType: SignalType): number {
        return SIGNAL_CONFIG.weights[signalType] || 0;
    }

    /**
     * 刷新信号缓冲区 (优雅关闭时调用)
     */
    async flush(): Promise<void> {
        await this.signalBuffer.flush();
    }

    /**
     * 停止服务 (优雅关闭)
     */
    stop(): void {
        this.signalBuffer.stop();
    }

    /**
     * 清除缓存
     */
    private async invalidateCache(userId: string): Promise<void> {
        const cacheKey = `${CONFIG.cache.keyPrefix}${userId}`;
        try {
            await redis.del(cacheKey);
        } catch {
            // 忽略缓存错误
        }
    }
}

// ========== 导出单例 ==========
export const userSignalService = UserSignalService.getInstance();
export default userSignalService;
