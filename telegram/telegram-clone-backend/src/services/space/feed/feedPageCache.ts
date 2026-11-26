/**
 * Space 首页首屏 Feed 结果 Redis 短时缓存（15 秒 TTL）
 * 仅用于无游标、非 bottom、无 seenIds 的首屏请求，切 Tab/刷新时快速返回并支持写后立即失效
 */
import mongoose from 'mongoose';
import { redis } from '../../../config/redis';
import type { FeedCandidate } from '../../recommendation';
import type { SpaceFeedPageResult } from '../../recommendation/feed/pageResult';

const FEED_PAGE_CACHE_TTL_SEC = 15;
const FEED_PAGE_CACHE_READ_TIMEOUT_MS = 80;
const FEED_PAGE_CACHE_PREFIX = 'space:feed:page:v1';

export interface FeedPageCacheIdentity {
    userId: string;
    inNetworkOnly: boolean;
    includeSelf: boolean;
    limit: number;
}

export function buildFeedPageCacheKey(identity: FeedPageCacheIdentity): string {
    const scope = identity.inNetworkOnly ? 'friends' : 'all';
    const selfFlag = identity.includeSelf ? '1' : '0';
    return `${FEED_PAGE_CACHE_PREFIX}:${identity.userId}:${scope}:${selfFlag}:${identity.limit}`;
}

export function isFirstPageFeedCacheable(params: {
    cursor?: Date;
    isBottomRequest?: boolean;
    seenIds?: string[];
}): boolean {
    if (params.cursor !== undefined) return false;
    if (params.isBottomRequest) return false;
    if (Array.isArray(params.seenIds) && params.seenIds.length > 0) return false;
    return true;
}

function reviveObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
    if (!value) return undefined;
    if (value instanceof mongoose.Types.ObjectId) return value;
    const raw = String(value).trim();
    if (mongoose.Types.ObjectId.isValid(raw)) {
        return new mongoose.Types.ObjectId(raw);
    }
    return undefined;
}

export function reviveCachedFeedCandidate(raw: Record<string, any>): FeedCandidate {
    const revivedPostId = reviveObjectId(raw.postId) ?? raw.postId;
    const revivedCreatedAt = raw.createdAt instanceof Date
        ? raw.createdAt
        : new Date(raw.createdAt);

    return {
        ...(raw as FeedCandidate),
        postId: revivedPostId,
        createdAt: Number.isNaN(revivedCreatedAt.getTime()) ? new Date() : revivedCreatedAt,
        replyToPostId: reviveObjectId(raw.replyToPostId) ?? raw.replyToPostId,
        originalPostId: reviveObjectId(raw.originalPostId) ?? raw.originalPostId,
        conversationId: reviveObjectId(raw.conversationId) ?? raw.conversationId,
    };
}

export function serializeFeedPageResult(page: SpaceFeedPageResult): string {
    return JSON.stringify(page);
}

export function deserializeFeedPageResult(
    raw: string,
    overrideIdentity?: { requestId: string; decisionId: string; clientRequestId?: string },
): SpaceFeedPageResult | null {
    try {
        const parsed = JSON.parse(raw) as SpaceFeedPageResult | null;
        if (!parsed || !Array.isArray(parsed.candidates)) {
            return null;
        }
        return {
            ...parsed,
            requestId: overrideIdentity?.requestId ?? parsed.requestId,
            decisionId: overrideIdentity?.decisionId ?? parsed.decisionId,
            clientRequestId: overrideIdentity?.clientRequestId ?? parsed.clientRequestId,
            candidates: parsed.candidates.map((item) =>
                reviveCachedFeedCandidate(item as unknown as Record<string, any>),
            ),
        };
    } catch {
        return null;
    }
}

/**
 * 读取首屏缓存；Redis 未就绪或超时时静默返回 null
 */
export async function readFeedPageCache(
    identity: FeedPageCacheIdentity,
    overrideIdentity?: { requestId: string; decisionId: string; clientRequestId?: string },
): Promise<SpaceFeedPageResult | null> {
    if (redis.status !== 'ready') {
        return null;
    }

    const key = buildFeedPageCacheKey(identity);
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        const timeoutPromise = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), FEED_PAGE_CACHE_READ_TIMEOUT_MS);
        });
        const raw = await Promise.race([
            redis.get(key).catch(() => null),
            timeoutPromise,
        ]);
        if (!raw) return null;
        return deserializeFeedPageResult(raw, overrideIdentity);
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 异步写入首屏缓存（跳过空页，避免把瞬时降级空态缓存住）
 */
export function writeFeedPageCache(
    identity: FeedPageCacheIdentity,
    page: SpaceFeedPageResult,
): void {
    if (redis.status !== 'ready' || !Array.isArray(page.candidates) || page.candidates.length === 0) {
        return;
    }

    try {
        const key = buildFeedPageCacheKey(identity);
        const serialized = serializeFeedPageResult(page);
        void redis.set(key, serialized, 'EX', FEED_PAGE_CACHE_TTL_SEC).catch(() => undefined);
    } catch {
        // 忽略序列化或 Redis 写入异常
    }
}

/**
 * 在发帖、删帖或置顶变更后失效指定用户常见组合的首屏缓存
 */
export async function invalidateUserFeedPageCache(userId: string): Promise<void> {
    if (!userId || redis.status !== 'ready') {
        return;
    }

    const commonLimits = [20, 10, 30, 50];
    const keys: string[] = [];
    for (const inNetworkOnly of [false, true]) {
        for (const includeSelf of [false, true]) {
            for (const limit of commonLimits) {
                keys.push(buildFeedPageCacheKey({ userId, inNetworkOnly, includeSelf, limit }));
            }
        }
    }

    try {
        await redis.del(...keys);
    } catch {
        // 失效失败最多自然过期（15s），不阻断写路径
    }
}
