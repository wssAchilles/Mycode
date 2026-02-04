/**
 * 用户行为事件流服务
 * 收集用户行为并写入 Redis Stream 用于后续分析和模型训练
 */

import { Redis } from 'ioredis';

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
            console.warn('[EventStream] Redis URL not configured, events will be logged to console');
            this.isInitialized = true;
            return;
        }

        try {
            this.redis = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => Math.min(times * 50, 2000),
            });

            this.redis.on('error', (err) => {
                console.error('[EventStream] Redis error:', err.message);
            });

            this.redis.on('connect', () => {
                console.log('[EventStream] Connected to Redis');
                this.isInitialized = true;
            });
        } catch (error) {
            console.error('[EventStream] Failed to initialize Redis:', error);
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
                console.log(`[EventStream] Flushed ${eventsToFlush.length} events to Redis`);
            } catch (error) {
                console.error('[EventStream] Failed to flush events:', error);
                // 失败时将事件放回缓冲区
                this.buffer = [...eventsToFlush, ...this.buffer].slice(0, BATCH_SIZE * 10);
            }
        } else {
            // 没有 Redis 时只打印日志
            console.log(`[EventStream] Would flush ${eventsToFlush.length} events:`, 
                eventsToFlush.slice(0, 3).map(e => `${e.type}:${e.postId}`).join(', ')
            );
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
            console.error('[EventStream] Failed to read events:', error);
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
            console.error('[EventStream] Failed to get stats:', error);
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
