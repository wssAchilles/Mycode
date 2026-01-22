/**
 * ServeCacheSideEffect - 将本次推荐的 postIds 写入用户缓存
 * 用于后续“已送”过滤或训练样本生成
 */

import { SideEffect } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

import { getRedis } from '../utils/redisClient';

// 简单内存缓存作为回退
const servedCache = new Map<string, Set<string>>();
const MAX_CACHE_SIZE = 500;
const TTL_SECONDS = 24 * 60 * 60;

export class ServeCacheSideEffect implements SideEffect<FeedQuery, FeedCandidate> {
    readonly name = 'ServeCacheSideEffect';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async run(query: FeedQuery, selectedCandidates: FeedCandidate[]): Promise<void> {
        const redis = getRedis();
        if (redis) {
            const key = this.redisKey(query.userId);
            const ids = selectedCandidates
                .map((c) => c.postId?.toString())
                .filter((v): v is string => Boolean(v));
            if (ids.length > 0) {
                await redis.sadd(key, ...ids as string[]);
                await redis.expire(key, TTL_SECONDS);
            }
            return;
        }

        const set = servedCache.get(query.userId) || new Set<string>();
        for (const c of selectedCandidates) {
            const id = c.postId.toString();
            set.add(id);
            if (set.size > MAX_CACHE_SIZE) {
                // 简单裁剪：删除最早插入的项
                const first = set.values().next().value;
                set.delete(first);
            }
        }
        servedCache.set(query.userId, set);
    }

    static hasServed(userId: string, postId: string): boolean {
        const redis = getRedis();
        const key = `serve:${userId}`;
        if (redis) {
            // Redis 检查需要同步调用的包装
            // 注意：调用方是异步 filter，可 await
            return false;
        }
        return servedCache.get(userId)?.has(postId) ?? false;
    }

    static async hasServedAsync(userId: string, postId: string): Promise<boolean> {
        const redis = getRedis();
        if (redis) {
            const res = await redis.sismember(`serve:${userId}`, postId);
            return res === 1;
        }
        return ServeCacheSideEffect.hasServed(userId, postId);
    }

    private redisKey(userId: string): string {
        return `serve:${userId}`;
    }
}
