/**
 * Space recommended-follow domain.
 * Extracted from spaceService with identical control flow.
 */
import { Op } from 'sequelize';
import Post, { IPost } from '../../../models/Post';
import User from '../../../models/User';
import { AuthorSuggestionService } from '../../recommendation/authorSuggestions';
import { createChildLogger } from '../../../utils/logger';
import type { RecommendedSpaceUser } from '../types';
import { getFollowedSet } from './profileQueries';
import { getUserMap } from '../internal/userMap';

const log = createChildLogger('services:spaceService');

// One instance per process — matches SpaceService singleton field.
const authorSuggestionService = new AuthorSuggestionService();

async function getFastFallbackUsers(excludedIds: string[], limit: number): Promise<RecommendedSpaceUser[]> {
    const users = await User.findAll({
        where: excludedIds.length > 0
            ? { id: { [Op.notIn]: excludedIds } }
            : {},
        attributes: ['id', 'username', 'avatarUrl', 'isOnline'],
        order: [['createdAt', 'DESC']],
        limit,
    });

    return users.map((user) => ({
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isOnline: user.isOnline,
        reason: '近期活跃用户',
        isFollowed: false,
        recentPosts: 0,
        engagementScore: 0,
    }));
}

async function getFastRecommendedUsers(
    userId: string,
    limit: number,
    excludeIds: string[] = [],
): Promise<RecommendedSpaceUser[]> {
    const safeLimit = Math.max(1, Math.min(12, limit));
    const followed = await getFollowedSet(userId);
    const excluded = new Set<string>([userId, ...followed, ...excludeIds.map(String).filter(Boolean)]);
    const excludedIds = Array.from(excluded);

    const recentPosts = await Post.find({
        deletedAt: null,
        isNews: { $ne: true },
        ...(excludedIds.length > 0 ? { authorId: { $nin: excludedIds } } : {}),
    })
        .sort({ createdAt: -1, _id: -1 })
        .limit(120)
        .select('authorId stats')
        .lean<Array<{ authorId?: string; stats?: Partial<IPost['stats']> }>>();

    const authorStats = new Map<string, { recentPosts: number; engagementScore: number }>();
    for (const post of recentPosts) {
        if (!post.authorId || excluded.has(post.authorId)) continue;
        const stats = post.stats || {};
        const current = authorStats.get(post.authorId) || { recentPosts: 0, engagementScore: 0 };
        current.recentPosts += 1;
        current.engagementScore +=
            Number(stats.likeCount || 0) +
            Number(stats.commentCount || 0) * 2 +
            Number(stats.repostCount || 0) * 3;
        authorStats.set(post.authorId, current);
    }

    const rankedAuthorIds = Array.from(authorStats.entries())
        .sort((left, right) =>
            right[1].engagementScore - left[1].engagementScore ||
            right[1].recentPosts - left[1].recentPosts ||
            left[0].localeCompare(right[0])
        )
        .slice(0, safeLimit)
        .map(([authorId]) => authorId);

    if (rankedAuthorIds.length === 0) {
        return getFastFallbackUsers(excludedIds, safeLimit);
    }

    const userMap = await getUserMap(rankedAuthorIds);
    return rankedAuthorIds
        .map((authorId): RecommendedSpaceUser | null => {
            const user = userMap.get(authorId);
            const stats = authorStats.get(authorId);
            if (!user || !stats) return null;
            return {
                id: authorId,
                username: user.username,
                avatarUrl: user.avatarUrl,
                isOnline: user.isOnline,
                reason: '近期高质量讨论',
                isFollowed: false,
                recentPosts: stats.recentPosts,
                engagementScore: stats.engagementScore,
            };
        })
        .filter((user): user is RecommendedSpaceUser => user !== null);
}

async function withRecommendedUsersFallback(
    work: Promise<RecommendedSpaceUser[]>,
    fallback: () => Promise<RecommendedSpaceUser[]>,
): Promise<RecommendedSpaceUser[]> {
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const guardedWork = work.catch(async (error) => {
        log.warn({ err: (error as any)?.message || error }, '[SpaceService] author suggestions failed');
        return timedOut ? [] : fallback();
    });
    const timeout = new Promise<RecommendedSpaceUser[]>((resolve) => {
        timer = setTimeout(async () => {
            timedOut = true;
            log.warn('[SpaceService] author suggestions timed out, using fast fallback');
            resolve(await fallback());
        }, 1800);
    });

    try {
        return await Promise.race([guardedWork, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function getRecommendedUsers(
    userId: string,
    limit: number = 4,
    excludeIds: string[] = [],
): Promise<RecommendedSpaceUser[]> {
    const cleanExcludeIds = Array.from(new Set(excludeIds.map((id) => String(id).trim()).filter(Boolean)));
    const excludeSet = new Set(cleanExcludeIds);
    const fetchLimit = excludeSet.size > 0 ? Math.min(12, limit + excludeSet.size) : limit;
    const raw = await withRecommendedUsersFallback(
        authorSuggestionService.getRecommendedUsers(userId, fetchLimit),
        () => getFastRecommendedUsers(userId, fetchLimit, cleanExcludeIds),
    );
    const filtered = excludeSet.size > 0
        ? raw.filter((user) => !excludeSet.has(String(user.id)))
        : raw;
    if (filtered.length >= limit || excludeSet.size === 0) {
        return filtered.slice(0, limit);
    }
    const extra = await getFastRecommendedUsers(
        userId,
        limit,
        [...cleanExcludeIds, ...filtered.map((user) => String(user.id))],
    );
    const seen = new Set(filtered.map((user) => String(user.id)));
    const merged = [...filtered];
    for (const item of extra) {
        if (!seen.has(String(item.id))) {
            seen.add(String(item.id));
            merged.push(item);
        }
        if (merged.length >= limit) break;
    }
    return merged.slice(0, limit);
}
