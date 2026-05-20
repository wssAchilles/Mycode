/**
 * 用户行为事件流服务
 * 收集用户行为并写入 Redis Stream 用于后续分析和模型训练
 */

import { Redis } from 'ioredis';
import UserSignal, { SignalType, TargetType, ProductSurface, UserSignalInput } from '../models/UserSignal';
import UserAction, { ActionType } from '../models/UserAction';
import { createChildLogger } from '../utils/logger';
const log = createChildLogger('services:eventStreamService');

// 事件类型
export interface UserBehaviorEvent {
    type: 'impression' | 'click' | 'like' | 'reply' | 'repost' | 'share' | 'scroll' | 'dwell';
    postId: string;
    userId: string;
    timestamp: Date;
    metadata?: {
        source?: string;
        position?: number;
        experimentId?: string;
        bucketId?: string;
        dwellTime?: number;
        scrollDepth?: number;
    };
}

// 聚合事件 (用于批量写入)
export interface AggregatedEvent {
    userId: string;
    postId: string;
    impressions: number;
    clicks: number;
    likes: number;
    replies: number;
    reposts: number;
    shares: number;
    totalDwell: number;
    maxScrollDepth: number;
    source?: string;
    experimentId?: string;
    bucketId?: string;
    firstSeen: Date;
    lastSeen: Date;
}

// 配置
const STREAM_KEY = 'user_events_stream';
const STREAM_MAX_LEN = 100000; // 保留最近 10 万条事件
const BATCH_SIZE = 100;

export class EventStreamService {
    private redis: Redis | null = null;
    private buffer: UserBehaviorEvent[] = [];
    private flushTimer: NodeJS.Timeout | null = null;
    private isInitialized = false;

    constructor() {
        this.initRedis();
    }

    private async initRedis() {
        const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;
        
        if (!redisUrl) {
            log.warn('[EventStream] Redis URL not configured, events will be logged to console');
            this.isInitialized = true;
            return;
        }

        try {
            this.redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => Math.min(times * 50, 2000),
            });

            this.redis.on('error', (err) => {
                log.error({ data: err.message }, '[EventStream] Redis error');
            });

            this.redis.on('connect', () => {
                log.info('[EventStream] Connected to Redis');
                this.isInitialized = true;
            });
        } catch (error) {
            log.error({ err: error }, '[EventStream] Failed to initialize Redis');
            this.isInitialized = true; // 继续运行，但只记录日志
        }
    }

    /**
     * 记录单个事件
     */
    async logEvent(event: UserBehaviorEvent): Promise<void> {
        this.buffer.push(event);

        // 缓冲区满时刷新
        if (this.buffer.length >= BATCH_SIZE) {
            await this.flush();
        }

        // 设置定时刷新
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), 5000);
        }
    }

    /**
     * 批量记录事件
     */
    async logBatch(events: UserBehaviorEvent[]): Promise<void> {
        this.buffer.push(...events);

        if (this.buffer.length >= BATCH_SIZE) {
            await this.flush();
        }
    }

    /**
     * 刷新缓冲区到 Redis Stream
     */
    async flush(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        if (this.buffer.length === 0) return;

        const eventsToFlush = [...this.buffer];
        this.buffer = [];

        if (this.redis) {
            try {
                // 使用 pipeline 批量写入
                const pipeline = this.redis.pipeline();

                for (const event of eventsToFlush) {
                    pipeline.xadd(
                        STREAM_KEY,
                        'MAXLEN', '~', STREAM_MAX_LEN.toString(),
                        '*',
                        'type', event.type,
                        'postId', event.postId,
                        'userId', event.userId,
                        'timestamp', event.timestamp.toISOString(),
                        'metadata', JSON.stringify(event.metadata || {})
                    );
                }

                await pipeline.exec();
                log.info(`[EventStream] Flushed ${eventsToFlush.length} events to Redis`);

                // 桥接到推荐管道的 MongoDB 集合 (fire-and-forget)
                this.bridgeToRecommendationPipeline(eventsToFlush).catch(() => {});
            } catch (error) {
                log.error({ err: error }, '[EventStream] Failed to flush events');
                // 失败时将事件放回缓冲区
                this.buffer = [...eventsToFlush, ...this.buffer].slice(0, BATCH_SIZE * 10);
            }
        } else {
            // 没有 Redis 时只打印日志
            log.info({
              sample: eventsToFlush.slice(0, 3).map(e => `${e.type}:${e.postId}`).join(', '),
              total: eventsToFlush.length,
            }, '[EventStream] Would flush events');
        }
    }

    /**
     * 读取最近的事件 (用于调试和分析)
     */
    async readRecentEvents(count: number = 100): Promise<UserBehaviorEvent[]> {
        if (!this.redis) return [];

        try {
            const results = await this.redis.xrevrange(STREAM_KEY, '+', '-', 'COUNT', count.toString());
            
            return results.map(([_id, fields]) => {
                const fieldMap: Record<string, string> = {};
                for (let i = 0; i < fields.length; i += 2) {
                    fieldMap[fields[i]] = fields[i + 1];
                }

                return {
                    type: fieldMap.type as UserBehaviorEvent['type'],
                    postId: fieldMap.postId,
                    userId: fieldMap.userId,
                    timestamp: new Date(fieldMap.timestamp),
                    metadata: JSON.parse(fieldMap.metadata || '{}'),
                };
            });
        } catch (error) {
            log.error({ err: error }, '[EventStream] Failed to read events');
            return [];
        }
    }

    /**
     * 获取事件统计
     */
    async getStats(): Promise<{
        totalEvents: number;
        byType: Record<string, number>;
        recentRate: number; // 最近 1 分钟的事件数/秒
    }> {
        if (!this.redis) {
            return { totalEvents: 0, byType: {}, recentRate: 0 };
        }

        try {
            const info = await this.redis.xinfo('STREAM', STREAM_KEY) as unknown[];
            const totalEvents = (info[1] as number) || 0;

            // 读取最近 1000 个事件统计类型
            const recentEvents = await this.readRecentEvents(1000);
            const byType: Record<string, number> = {};
            for (const event of recentEvents) {
                byType[event.type] = (byType[event.type] || 0) + 1;
            }

            // 计算最近 1 分钟的速率
            const oneMinuteAgo = new Date(Date.now() - 60000);
            const recentCount = recentEvents.filter(e => e.timestamp > oneMinuteAgo).length;
            const recentRate = recentCount / 60;

            return { totalEvents, byType, recentRate };
        } catch (error) {
            log.error({ err: error }, '[EventStream] Failed to get stats');
            return { totalEvents: 0, byType: {}, recentRate: 0 };
        }
    }

    /**
     * 导出事件用于模型训练
     */
    async exportForTraining(
        startTime: Date,
        endTime: Date,
        limit: number = 10000
    ): Promise<AggregatedEvent[]> {
        const events = await this.readRecentEvents(limit);
        
        // 过滤时间范围
        const filtered = events.filter(
            e => e.timestamp >= startTime && e.timestamp <= endTime
        );

        // 聚合事件
        const aggregated = new Map<string, AggregatedEvent>();

        for (const event of filtered) {
            const key = `${event.userId}:${event.postId}`;
            
            if (!aggregated.has(key)) {
                aggregated.set(key, {
                    userId: event.userId,
                    postId: event.postId,
                    impressions: 0,
                    clicks: 0,
                    likes: 0,
                    replies: 0,
                    reposts: 0,
                    shares: 0,
                    totalDwell: 0,
                    maxScrollDepth: 0,
                    source: event.metadata?.source,
                    experimentId: event.metadata?.experimentId,
                    bucketId: event.metadata?.bucketId,
                    firstSeen: event.timestamp,
                    lastSeen: event.timestamp,
                });
            }

            const agg = aggregated.get(key)!;

            switch (event.type) {
                case 'impression': agg.impressions++; break;
                case 'click': agg.clicks++; break;
                case 'like': agg.likes++; break;
                case 'reply': agg.replies++; break;
                case 'repost': agg.reposts++; break;
                case 'share': agg.shares++; break;
                case 'dwell':
                    agg.totalDwell += event.metadata?.dwellTime || 0;
                    break;
                case 'scroll':
                    agg.maxScrollDepth = Math.max(
                        agg.maxScrollDepth,
                        event.metadata?.scrollDepth || 0
                    );
                    break;
            }

            if (event.timestamp < agg.firstSeen) agg.firstSeen = event.timestamp;
            if (event.timestamp > agg.lastSeen) agg.lastSeen = event.timestamp;
        }

        return Array.from(aggregated.values());
    }

    /**
     * 桥接前端事件到推荐管道的 MongoDB 集合
     * 将 UserBehaviorEvent 映射为 UserSignal + UserAction 记录
     */
    private async bridgeToRecommendationPipeline(events: UserBehaviorEvent[]): Promise<void> {
        const signalInputs: UserSignalInput[] = [];
        const actionInputs: Record<string, any>[] = [];

        for (const event of events) {
            const signalType = this.mapEventToSignalType(event.type);
            const actionType = this.mapEventToActionType(event.type);

            if (signalType) {
                signalInputs.push({
                    userId: event.userId,
                    signalType,
                    targetId: event.postId,
                    targetType: TargetType.POST,
                    productSurface: ProductSurface.HOME_FEED,
                    metadata: {
                        dwellTimeMs: event.type === 'dwell' ? event.metadata?.dwellTime : undefined,
                        recommendationPosition: event.metadata?.position,
                        recommendationSource: event.metadata?.source,
                    },
                });
            }

            if (actionType) {
                actionInputs.push({
                    userId: event.userId,
                    action: actionType,
                    targetPostId: event.postId as any,
                    dwellTimeMs: event.type === 'dwell' ? event.metadata?.dwellTime : undefined,
                    productSurface: 'feed',
                    experimentKeys: event.metadata?.experimentId
                        ? [`${event.metadata.experimentId}:${event.metadata.bucketId || ''}`]
                        : undefined,
                });
            }
        }

        // Fire-and-forget: 不阻塞主流程
        const promises: Promise<void>[] = [];

        if (signalInputs.length > 0) {
            promises.push(
                UserSignal.logSignalsBatch(signalInputs).catch((err) =>
                    log.error({ data: err.message }, '[EventStream] Failed to bridge signals')
                )
            );
        }

        if (actionInputs.length > 0) {
            promises.push(
                UserAction.logActions(actionInputs as any).catch((err) =>
                    log.error({ data: err.message }, '[EventStream] Failed to bridge actions')
                )
            );
        }

        if (promises.length > 0) {
            await Promise.allSettled(promises);
        }
    }

    private mapEventToSignalType(eventType: UserBehaviorEvent['type']): SignalType | null {
        const mapping: Record<string, SignalType> = {
            impression: SignalType.IMPRESSION,
            click: SignalType.TWEET_CLICK,
            like: SignalType.FAVORITE,
            reply: SignalType.REPLY,
            repost: SignalType.RETWEET,
            share: SignalType.SHARE,
            dwell: SignalType.DWELL,
        };
        return mapping[eventType] || null;
    }

    private mapEventToActionType(eventType: UserBehaviorEvent['type']): ActionType | null {
        const mapping: Record<string, ActionType> = {
            impression: ActionType.IMPRESSION,
            click: ActionType.CLICK,
            like: ActionType.LIKE,
            reply: ActionType.REPLY,
            repost: ActionType.REPOST,
            share: ActionType.SHARE,
            dwell: ActionType.DWELL,
        };
        return mapping[eventType] || null;
    }

    /**
     * 关闭连接
     */
    async close(): Promise<void> {
        await this.flush();
        if (this.redis) {
            await this.redis.quit();
        }
    }
}

// 单例
let eventStreamInstance: EventStreamService | null = null;

export function getEventStreamService(): EventStreamService {
    if (!eventStreamInstance) {
        eventStreamInstance = new EventStreamService();
    }
    return eventStreamInstance;
}

export default EventStreamService;

/**
 * 实时特征计算服务
 * 从 Redis Stream 实时计算用户特征，用于推荐系统
 */
export class RealtimeFeatureService {
    private redis: Redis | null = null;

    constructor(redis: Redis | null) {
        this.redis = redis;
    }

    /**
     * 获取用户近期兴趣特征
     * 基于最近 1000 个事件计算用户对不同话题的兴趣权重
     */
    async getUserInterestFeatures(userId: string, windowSize: number = 1000): Promise<Record<string, number>> {
        if (!this.redis) return {};

        try {
            // 从 Redis Stream 读取用户最近的事件
            const events = await this.redis.xrevrange(
                'user_events_stream',
                '+', '-',
                'COUNT', windowSize.toString()
            );

            // 过滤该用户的事件
            const userEvents = events
                .map(([_id, fields]) => {
                    const fieldMap: Record<string, string> = {};
                    for (let i = 0; i < fields.length; i += 2) {
                        fieldMap[fields[i]] = fields[i + 1];
                    }
                    return fieldMap;
                })
                .filter(e => e.userId === userId);

            // 计算事件类型权重
            const weights: Record<string, number> = {
                impression: 0.1,
                click: 0.3,
                like: 0.5,
                reply: 0.7,
                repost: 0.6,
                share: 0.8,
                dwell: 0.2,
                scroll: 0.1,
            };

            // 聚合特征
            const features: Record<string, number> = {};
            for (const event of userEvents) {
                const weight = weights[event.type] || 0;
                const source = event.metadata ? JSON.parse(event.metadata).source : 'unknown';
                features[source] = (features[source] || 0) + weight;
            }

            // 归一化
            const maxWeight = Math.max(...Object.values(features), 1);
            for (const key in features) {
                features[key] = features[key] / maxWeight;
            }

            return features;
        } catch (error) {
            log.error({ err: error }, 'Failed to compute user interest features');
            return {};
        }
    }

    /**
     * 获取用户活跃度特征
     * 基于最近 24 小时的事件计算用户活跃度
     */
    async getUserActivityFeatures(userId: string): Promise<{
        eventsLast1h: number;
        eventsLast24h: number;
        lastActiveAt: Date | null;
        avgSessionDuration: number;
    }> {
        if (!this.redis) {
            return { eventsLast1h: 0, eventsLast24h: 0, lastActiveAt: null, avgSessionDuration: 0 };
        }

        try {
            const now = Date.now();
            const oneHourAgo = now - 3600000;
            const oneDayAgo = now - 86400000;

            // 读取最近的事件
            const events = await this.redis.xrevrange(
                'user_events_stream',
                '+', '-',
                'COUNT', '5000'
            );

            let eventsLast1h = 0;
            let eventsLast24h = 0;
            let lastActiveAt: Date | null = null;

            for (const [_id, fields] of events) {
                const fieldMap: Record<string, string> = {};
                for (let i = 0; i < fields.length; i += 2) {
                    fieldMap[fields[i]] = fields[i + 1];
                }

                if (fieldMap.userId !== userId) continue;

                const eventTime = new Date(fieldMap.timestamp).getTime();
                if (eventTime > oneHourAgo) eventsLast1h++;
                if (eventTime > oneDayAgo) eventsLast24h++;

                if (!lastActiveAt || eventTime > lastActiveAt.getTime()) {
                    lastActiveAt = new Date(fieldMap.timestamp);
                }
            }

            return {
                eventsLast1h,
                eventsLast24h,
                lastActiveAt,
                avgSessionDuration: eventsLast24h > 0 ? 86400 / eventsLast24h : 0,
            };
        } catch (error) {
            log.error({ err: error }, 'Failed to compute user activity features');
            return { eventsLast1h: 0, eventsLast24h: 0, lastActiveAt: null, avgSessionDuration: 0 };
        }
    }
}
