/**
 * Space 动态详情与作者主页短时内存缓存
 * 支撑点击进入详情页/个人主页零骨架秒开，并在后台并行拉取最新数据对齐
 */
import type { PostData } from '../../components/space';
import type { UserProfile } from '../../services/spaceApi';
import { useSpaceStore } from '../../stores/useSpaceStore';

export interface CachedProfileBundle {
    savedAt: number;
    profile: UserProfile;
    pinnedPosts: PostData[];
    posts: PostData[];
    hasMore: boolean;
    nextCursor?: string;
}

const PROFILE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHED_PROFILES = 30;
const profileCache = new Map<string, CachedProfileBundle>();

/**
 * 从当前 Space Store 各候选列表中同步定位已缓存主帖（零网络延迟）
 */
export function findCachedSpacePost(postId?: string): PostData | null {
    if (!postId) return null;
    const state = useSpaceStore.getState();
    const pools = [
        state.posts,
        state.allFeed.posts,
        state.friendsFeed.posts,
        state.searchResults,
    ];
    for (const pool of pools) {
        const hit = pool.find((item) => item.id === postId);
        if (hit) return hit;
    }
    for (const bundle of profileCache.values()) {
        const pinnedHit = bundle.pinnedPosts.find((item) => item.id === postId);
        if (pinnedHit) return pinnedHit;
        const postHit = bundle.posts.find((item) => item.id === postId);
        if (postHit) return postHit;
    }
    return null;
}

export function readProfileCache(userId?: string, nowMs: number = Date.now()): CachedProfileBundle | null {
    if (!userId) return null;
    const entry = profileCache.get(userId);
    if (!entry) return null;
    if (nowMs - entry.savedAt > PROFILE_CACHE_TTL_MS) {
        profileCache.delete(userId);
        return null;
    }
    return entry;
}

export function writeProfileCache(
    userId: string,
    bundle: Omit<CachedProfileBundle, 'savedAt'>,
    nowMs: number = Date.now(),
): void {
    if (!userId) return;
    if (profileCache.size >= MAX_CACHED_PROFILES && !profileCache.has(userId)) {
        const oldestKey = profileCache.keys().next().value;
        if (oldestKey) profileCache.delete(oldestKey);
    }
    profileCache.set(userId, { ...bundle, savedAt: nowMs });
}

export function patchProfileFollowCache(userId: string, isFollowed: boolean, followersDelta: number): void {
    const entry = profileCache.get(userId);
    if (!entry) return;
    profileCache.set(userId, {
        ...entry,
        profile: {
            ...entry.profile,
            isFollowed,
            stats: {
                ...entry.profile.stats,
                followers: Math.max(0, entry.profile.stats.followers + followersDelta),
            },
        },
    });
}

export function invalidateProfileCache(userId?: string): void {
    if (!userId) {
        profileCache.clear();
        return;
    }
    profileCache.delete(userId);
}
