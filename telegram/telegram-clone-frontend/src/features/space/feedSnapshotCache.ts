/**
 * Space 首页首屏本地快照缓存（Stale-While-Revalidate）
 * 按 userId + scope 隔离保存在 localStorage，支持秒开渲染与反序列化 Date 还原
 */
import type { PostData } from '../../components/space';
import { authStorage } from '../../utils/authStorage';

export type SpaceFeedScope = 'all' | 'friends';

export const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
export const MAX_SNAPSHOT_POSTS = 20;
const SNAPSHOT_KEY_PREFIX = 'space:feed:snapshot:v1';

interface StoredFeedSnapshot {
    savedAt: number;
    posts: PostData[];
}

export function resolveCurrentSpaceUserId(): string {
    if (typeof window === 'undefined') return 'anonymous';
    const user = authStorage.getUser();
    return user?.id ? String(user.id) : 'anonymous';
}

export function buildFeedSnapshotKey(scope: SpaceFeedScope, userId?: string | null): string {
    const resolvedUserId = (userId && String(userId).trim()) || resolveCurrentSpaceUserId();
    return `${SNAPSHOT_KEY_PREFIX}:${resolvedUserId}:${scope}`;
}

function reviveDate(value: unknown): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return new Date();
}

function reviveSnapshotPost(raw: PostData): PostData {
    return {
        ...raw,
        createdAt: reviveDate(raw.createdAt),
        ...(raw.originalPost
            ? {
                originalPost: {
                    ...raw.originalPost,
                    createdAt: reviveDate(raw.originalPost.createdAt),
                },
            }
            : {}),
    };
}

export function readFeedSnapshot(
    scope: SpaceFeedScope,
    userId?: string | null,
    nowMs: number = Date.now(),
): PostData[] | null {
    if (typeof window === 'undefined') return null;

    const key = buildFeedSnapshotKey(scope, userId);
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as StoredFeedSnapshot | null;
        if (
            !parsed ||
            typeof parsed.savedAt !== 'number' ||
            !Number.isFinite(parsed.savedAt) ||
            nowMs - parsed.savedAt > SNAPSHOT_TTL_MS ||
            !Array.isArray(parsed.posts) ||
            parsed.posts.length === 0
        ) {
            window.localStorage.removeItem(key);
            return null;
        }

        return parsed.posts
            .slice(0, MAX_SNAPSHOT_POSTS)
            .map(reviveSnapshotPost);
    } catch {
        try {
            window.localStorage.removeItem(key);
        } catch {
            // 忽略清理异常
        }
        return null;
    }
}

export function writeFeedSnapshot(
    scope: SpaceFeedScope,
    posts: PostData[],
    userId?: string | null,
    nowMs: number = Date.now(),
): void {
    if (typeof window === 'undefined') return;

    const key = buildFeedSnapshotKey(scope, userId);
    try {
        if (!Array.isArray(posts) || posts.length === 0) {
            window.localStorage.removeItem(key);
            return;
        }

        const payload: StoredFeedSnapshot = {
            savedAt: nowMs,
            posts: posts.slice(0, MAX_SNAPSHOT_POSTS),
        };
        window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
        // 忽略存储空间上限（QuotaExceededError）或隐私模式异常
    }
}

export function clearFeedSnapshots(userId?: string | null): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(buildFeedSnapshotKey('all', userId));
        window.localStorage.removeItem(buildFeedSnapshotKey('friends', userId));
    } catch {
        // 忽略清理异常
    }
}
