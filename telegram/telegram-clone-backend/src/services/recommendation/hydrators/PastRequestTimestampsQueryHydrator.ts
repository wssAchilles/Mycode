/**
 * PastRequestTimestampsQueryHydrator - 最近推荐请求时间戳丰富器
 * 从 Redis 读取用户最近的 feed 请求时间戳列表，
 * 注入 FeedQuery.pastRequestTimestamps 供 Rust 推荐管道进行频率控制。
 * 同时将当前请求时间戳写入 Redis 以供后续请求使用。
 */

import { QueryHydrator } from '../framework';
import type { FeedQuery } from '../types/FeedQuery';
import { getRedis } from '../utils/redisClient';

/** 保留最近的请求时间戳数量 */
const MAX_TIMESTAMPS = 10;

/** Redis key TTL (24 小时) */
const TTL_SECONDS = 24 * 60 * 60;

export class PastRequestTimestampsQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'PastRequestTimestampsQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        const redis = getRedis();
        if (!redis) return query;

        try {
            const key = this.redisKey(query.userId);

            // 读取最近的时间戳 (按分数升序排列)
            const raw = await redis.zrange(key, 0, -1);
            const timestamps = raw
                .map((s) => new Date(s))
                .filter((d) => !isNaN(d.getTime()));

            // 将当前请求时间戳写入 Redis (pipeline 批处理)
            const now = new Date();
            const score = now.getTime();
            const pipe = redis.pipeline();
            pipe.zadd(key, score, now.toISOString());
            pipe.zremrangebyrank(key, 0, -(MAX_TIMESTAMPS + 1));
            pipe.expire(key, TTL_SECONDS);
            pipe.exec().catch(() => undefined);

            return {
                ...query,
                pastRequestTimestamps: timestamps,
            };
        } catch {
            // Best-effort: Redis 故障不阻塞推荐管道
            return query;
        }
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            pastRequestTimestamps: hydrated.pastRequestTimestamps ?? query.pastRequestTimestamps,
        };
    }

    private redisKey(userId: string): string {
        return `feed_req_ts:${userId}`;
    }
}
