/**
 * FollowingTimelineCache - 简单双层内存时间线
 * 用于缓存关注用户的近期帖子，降低数据库查询频率
 */
import Post, { IPost } from '../../../models/Post';

type AuthorId = string;

interface TimelineEntry {
    posts: IPost[];
    refreshedAt: number;
}

export class FollowingTimelineCache {
    private cache = new Map<AuthorId, TimelineEntry>();
    private readonly ttlMs: number;
    private readonly maxPerAuthor: number;
    private readonly maxAgeDays: number;

    constructor(options?: { ttlMs?: number; maxPerAuthor?: number; maxAgeDays?: number }) {
        this.ttlMs = options?.ttlMs ?? 60_000; // 默认 60s 刷新
        this.maxPerAuthor = options?.maxPerAuthor ?? 200;
        this.maxAgeDays = options?.maxAgeDays ?? 7;
    }

    /**
    * 获取关注用户的近期帖子，按作者聚合缓存
    */
    async getPostsForAuthors(authorIds: AuthorId[], cursor?: Date): Promise<IPost[]> {
        const now = Date.now();
        const ageCutoff = this.computeAgeCutoff();

        // 找出需要刷新缓存的作者
        const toRefresh: AuthorId[] = [];
        for (const id of authorIds) {
            const entry = this.cache.get(id);
            const isStale = !entry || now - entry.refreshedAt > this.ttlMs;
            if (isStale) {
                toRefresh.push(id);
            }
        }

        if (toRefresh.length > 0) {
            const freshPosts = await Post.find({
                authorId: { $in: toRefresh },
                createdAt: { $gte: ageCutoff },
                isNews: { $ne: true },
                deletedAt: null,
            })
                .sort({ createdAt: -1 })
                .limit(this.maxPerAuthor * toRefresh.length)
                .lean();

            const grouped = new Map<AuthorId, IPost[]>();
            for (const post of freshPosts) {
                const list = grouped.get(post.authorId) || [];
                if (list.length < this.maxPerAuthor) {
                    list.push(post as unknown as IPost);
                }
                grouped.set(post.authorId, list);
            }

            for (const id of toRefresh) {
                const list = grouped.get(id) || [];
                this.cache.set(id, { posts: list, refreshedAt: now });
            }
        }

        // 汇总缓存，并应用 cursor 过滤
        const result: IPost[] = [];
        for (const id of authorIds) {
            const entry = this.cache.get(id);
            if (!entry) continue;
            const posts = entry.posts.filter((p) => {
                if (cursor) {
                    return p.createdAt < cursor && p.createdAt >= ageCutoff;
                }
                return p.createdAt >= ageCutoff;
            });
            result.push(...posts);
        }

        // 按时间降序返回
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    private computeAgeCutoff(): Date {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - this.maxAgeDays);
        return cutoff;
    }
}

// 单例实例，供 Source 直接使用
export const followingTimelineCache = new FollowingTimelineCache();
