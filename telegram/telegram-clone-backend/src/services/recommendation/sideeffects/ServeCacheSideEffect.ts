/**
 * ServeCacheSideEffect - 将本次推荐的 postIds 写入用户缓存
 * 用于后续“已送”过滤或训练样本生成
 */

import { SideEffect } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

import { getRedis } from '../utils/redisClient';
import UserAction, { ActionType } from '../../../models/UserAction';

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
            try {
                const key = this.redisKey(query.userId);
                const ids = selectedCandidates
                    .map((c) => c.postId?.toString())
                    .filter((v): v is string => Boolean(v));
                if (ids.length > 0) {
                    const stringIds: string[] = ids;
                    await redis.sadd(key, ...stringIds);
                    await redis.expire(key, TTL_SECONDS);
                }
            } catch (err) {
                // Best-effort: do not block serving on Redis outages.
                console.warn('[ServeCacheSideEffect] redis write failed', err);
            }
        }

        const set = servedCache.get(query.userId) || new Set<string>();
        for (const c of selectedCandidates) {
            const id = c.postId.toString();
            set.add(id);
            if (set.size > MAX_CACHE_SIZE) {
                // 简单裁剪：删除最早插入的项
                const first = set.values().next().value as string | undefined;
                if (first) {
                    set.delete(first);
                }
            }
        }
        servedCache.set(query.userId, set);

        // 异步持久化送达日志到 Mongo（不阻塞主流程）
        this.logDeliveries(query.userId, query.requestId, selectedCandidates).catch((err) => {
            console.error('[ServeCacheSideEffect] log deliveries failed', err);
        });
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
            try {
                const res = await redis.sismember(`serve:${userId}`, postId);
                return res === 1;
            } catch {
                return ServeCacheSideEffect.hasServed(userId, postId);
            }
        }
        return ServeCacheSideEffect.hasServed(userId, postId);
    }

    private redisKey(userId: string): string {
        return `serve:${userId}`;
    }

    private async logDeliveries(userId: string, requestId: string, candidates: FeedCandidate[]): Promise<void> {
        if (candidates.length === 0) return;
        const actions = candidates
            .map((c) => {
                const pid = c.postId?.toString();
                if (!pid) return null;
                return {
                    userId,
                    action: ActionType.DELIVERY,
                    targetPostId: c.postId,
                    targetAuthorId: c.authorId,
                    productSurface: 'space_feed',
                    requestId,
                    timestamp: new Date(),
                };
            })
            .filter(Boolean) as any[];
        if (actions.length > 0) {
            await UserAction.logActions(actions);
        }
    }
}
