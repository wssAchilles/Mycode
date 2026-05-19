/**
 * ColdStartSource - 冷启动内容源
 * 为没有关注任何人的新用户提供内容
 * 增强策略：混合新闻 + 热门帖子，支持语言感知过滤
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';
import { URL } from 'url';
import { isSourceEnabledForQuery } from '../utils/sourceMixing';

/**
 * 配置参数
 */
const CONFIG = {
    MAX_RESULTS: 50,
    // 新闻语料默认不要求互动阈值
    PRIMARY_NEWS_MAX_AGE_DAYS: 14,
    SPARSE_NEWS_MAX_AGE_DAYS: 90,
    GLOBAL_MAX_AGE_DAYS: 180,
    // 热门帖子配置
    POPULAR_MAX_AGE_DAYS: 30,
    POPULAR_MIN_ENGAGEMENT: 1,
    // 混合比例：新闻占 60%，热门帖子占 40%
    NEWS_RATIO: 0.6,
    // 每个供给单元最多返回几条
    DIVERSITY_LIMIT: 3,
};

/** 常见语言 → 可能的内容语言标签映射 */
const LANGUAGE_CONTENT_HINTS: Record<string, string[]> = {
    zh: ['zh', 'cn', 'chinese'],
    en: ['en', 'english'],
    ja: ['ja', 'jp', 'japanese'],
    ko: ['ko', 'kr', 'korean'],
    de: ['de', 'german'],
    fr: ['fr', 'french'],
    es: ['es', 'spanish'],
    pt: ['pt', 'portuguese'],
    ru: ['ru', 'russian'],
    ar: ['ar', 'arabic'],
};

export class ColdStartSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'ColdStartSource';

    enable(query: FeedQuery): boolean {
        if (!isSourceEnabledForQuery(query, this.name)) {
            return false;
        }
        if (query.userStateContext) {
            return query.userStateContext.state === 'cold_start';
        }
        const followedCount = query.userFeatures?.followedUserIds?.length || 0;
        return followedCount === 0;
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        const newsTarget = Math.floor(CONFIG.MAX_RESULTS * CONFIG.NEWS_RATIO);
        const popularTarget = CONFIG.MAX_RESULTS - newsTarget;

        // 并行获取新闻和热门帖子
        const [newsPosts, popularPosts] = await Promise.all([
            this.fetchNewsPosts(query, newsTarget),
            this.fetchPopularPosts(query, popularTarget),
        ]);

        // 合并：新闻优先，热门帖子填充剩余位置
        const allPosts = [...newsPosts, ...popularPosts];

        // 应用语言感知排序（有 demographics 时优先匹配语言的内容）
        const sortedPosts = this.applyLanguagePriority(query, allPosts);

        // 应用供给单元多样性限制
        const diversifiedPosts = this.applySupplierDiversity(sortedPosts);

        return diversifiedPosts.map((post) => ({
            ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: false,
        }));
    }

    /**
     * 获取新闻帖子（三级降级策略）
     */
    private async fetchNewsPosts(query: FeedQuery, target: number): Promise<any[]> {
        const posts =
            (await this.findPosts(query, CONFIG.PRIMARY_NEWS_MAX_AGE_DAYS, true, target)) ||
            (await this.findPosts(query, CONFIG.SPARSE_NEWS_MAX_AGE_DAYS, true, target)) ||
            (await this.findPosts(query, CONFIG.GLOBAL_MAX_AGE_DAYS, true, target)) ||
            [];
        return posts;
    }

    /**
     * 获取热门非新闻帖子（按 engagementScore 排序）
     */
    private async fetchPopularPosts(query: FeedQuery, target: number): Promise<any[]> {
        const posts = await this.findPosts(
            query,
            CONFIG.POPULAR_MAX_AGE_DAYS,
            false,
            target,
            CONFIG.POPULAR_MIN_ENGAGEMENT,
        );
        return posts || [];
    }

    private async findPosts(
        query: FeedQuery,
        maxAgeDays: number,
        newsOnly: boolean,
        limit: number,
        minEngagement?: number,
    ): Promise<any[] | null> {
        const maxAgeCutoff = new Date();
        maxAgeCutoff.setDate(maxAgeCutoff.getDate() - maxAgeDays);

        const excludeAuthors = [
            query.userId,
            ...(query.userFeatures?.blockedUserIds || []),
        ].filter(Boolean);

        const mongoQuery: Record<string, unknown> = {
            authorId: { $nin: excludeAuthors },
            createdAt: query.cursor
                ? { $gte: maxAgeCutoff, $lt: query.cursor }
                : { $gte: maxAgeCutoff },
            deletedAt: null,
        };

        if (newsOnly) {
            mongoQuery.isNews = true;
        } else {
            mongoQuery.isNews = { $ne: true };
            if (minEngagement && minEngagement > 0) {
                mongoQuery.engagementScore = { $gte: minEngagement };
            }
        }

        const posts = await Post.find(mongoQuery)
            .sort({ createdAt: -1, engagementScore: -1, _id: -1 })
            .limit(limit * 2)
            .lean();

        return posts.length > 0 ? posts.slice(0, limit) : null;
    }

    /**
     * 语言感知排序：当用户有 demographics 时，将匹配语言的内容排在前面
     */
    private applyLanguagePriority(query: FeedQuery, posts: any[]): any[] {
        const userLang = query.demographics?.language || query.languageCode;
        if (!userLang) return posts;

        const hints = LANGUAGE_CONTENT_HINTS[userLang.toLowerCase()];
        if (!hints || hints.length === 0) return posts;

        const langPattern = new RegExp(hints.join('|'), 'i');

        const matched: any[] = [];
        const unmatched: any[] = [];

        for (const post of posts) {
            const content = [
                post.content || '',
                post.newsMetadata?.language || '',
                post.newsMetadata?.source || '',
            ].join(' ').toLowerCase();

            if (langPattern.test(content)) {
                matched.push(post);
            } else {
                unmatched.push(post);
            }
        }

        return [...matched, ...unmatched];
    }

    /**
     * 应用作者多样性限制
     * 避免冷启动 Feed 被少数活跃用户主导
     */
    private supplierKey(post: any): string {
        if (post?.isNews) {
            const meta = post?.newsMetadata || {};
            const url = meta.sourceUrl || meta.url || '';
            if (typeof url === 'string' && url) {
                try {
                    const parsed = new URL(url);
                    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                        return `news:domain:${parsed.hostname}`;
                    }
                } catch {
                    // ignore
                }
            }
            if (meta.clusterId !== undefined && meta.clusterId !== null) {
                return `news:cluster:${String(meta.clusterId)}`;
            }
            if (meta.source) {
                return `news:source:${String(meta.source)}`;
            }
            if (meta.externalId) {
                return `news:external:${String(meta.externalId)}`;
            }
            return `news:author:${String(post.authorId || '')}`;
        }
        return `author:${String(post.authorId || '')}`;
    }

    private applySupplierDiversity(posts: any[]): any[] {
        const supplierCounts = new Map<string, number>();
        const result: any[] = [];

        for (const post of posts) {
            const key = this.supplierKey(post);
            const currentCount = supplierCounts.get(key) || 0;

            if (currentCount < CONFIG.DIVERSITY_LIMIT) {
                result.push(post);
                supplierCounts.set(key, currentCount + 1);
            }

            if (result.length >= CONFIG.MAX_RESULTS) {
                break;
            }
        }

        return result;
    }
}
