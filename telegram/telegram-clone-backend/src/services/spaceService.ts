/**
 * Space 服务层
 * 处理空间动态的业务逻辑
 */

import mongoose from 'mongoose';
import Post, { IPost, MediaType } from '../models/Post';
import Repost, { RepostType } from '../models/Repost';
import Comment, { IComment } from '../models/Comment';
import UserAction, { ActionType } from '../models/UserAction';
import Contact, { ContactStatus } from '../models/Contact';
import { newsService } from './newsService';
import {
  getNewsTrendsRustMode,
  newsTrendService,
  type SpaceTrendPostInput,
  type SpaceTrendResult,
} from './newsTrends';
import { createChildLogger } from '../utils/logger';
import type { FeedQuery } from './recommendation';
import type { FeedCandidate } from './recommendation';
import type { SpaceFeedPageResult } from './recommendation/feed/pageResult';
import {
    buildNewsSummary,
    buildTopicTextSearchQueries,
    computeRecencyScore,
    computeSimilarity,
    dedupeTrendsByTag,
    extractNewsKeywords,
    extractTrendKeywords,
    isValidTrendToken,
    mergeFeedTrendKeywords,
    normalizeTopicTag,
    sourceWeight,
    trendPostWeight
} from './space/internal/pureHelpers';
import {
    cleanupOldNews,
    createNewsPosts,
    getNewsClusterPosts,
    getNewsClusters,
    getNewsPosts
} from './space/news/newsQueries';
import {
    countExactTextSearchMatches,
    countTextSearchMatches,
    getTopicPosts,
    searchPostsPage
} from './space/search/searchQueries';
import {
    createPost,
    deletePost,
    getPost,
    getPostsByIds,
    pinPost,
    unpinPost
} from './space/posts/postMutations';

import {
    getUserMap
} from './space/internal/userMap';
import {
    createComment,
    getCommentsWithAuthors,
    getPostComments,
    likePost,
    repostPost,
    unlikePost,
    unrepostPost
} from './space/interactions/interactions';
import {
    getUserLikedPosts,
    getUserPosts,
    getUserProfile,
    setUserCover,
    updateSpaceProfileFields
} from './space/profiles/profileQueries';
import {
    getRecommendedUsers
} from './space/profiles/recommendedUsers';
import {
    getFeedPage as getFeedPageImpl,
    getInNetworkDirectFallback,
    recordServedFeedTrace
} from './space/feed/feedPage';

const log = createChildLogger('services:spaceService');

const DEFAULT_TREND_WINDOW_HOURS = Number.parseInt(process.env.SPACE_TREND_WINDOW_HOURS || '72', 10);
const MAX_TREND_SCAN_POSTS = 500;

import type {
    CreatePostParams,
    RecommendedSpaceUser,
    SpaceSearchPageResult,
} from './space/types';

export type {
    CreatePostParams,
    RecommendedSpaceUser,
    SpaceSearchPageResult,
};

/**
 * Space 服务类
 */
class SpaceService {
    private feedTrendKeywordCache?: { expiresAt: number; keywords: string[] };

    async getFeed(
        userId: string,
        limit: number = 20,
        cursor?: Date,
        includeSelf: boolean = false,
        options?: {
            requestId?: string;
            clientRequestId?: string;
            seenIds?: string[];
            servedIds?: string[];
            isBottomRequest?: boolean;
            clientAppId?: number;
            countryCode?: string;
            languageCode?: string;
            inNetworkOnly?: boolean;
        }
    ): Promise<FeedCandidate[]> {
        const page = await this.getFeedPage(userId, limit, cursor, includeSelf, options);
        return page.candidates;
    }

    /**
     * 批量获取用户信息 (用于作者/通知/评论)
     */
    private async getUserMap(userIds: string[]): Promise<Map<string, { id: string; username: string; avatarUrl?: string | null; isOnline?: boolean | null }>> {
        return getUserMap(userIds);
    }

    /**
     * 获取当前用户已关注列表 (Space 使用 Contact.accepted 作为关注)
     */


    /**
     * In-network hard fallback:
     * when mixer/pipeline cannot produce non-self candidates, query accepted contacts directly.
     * This avoids "好友流只显示自己" under sparse graph / stale timeline conditions.
     */
    private async getInNetworkDirectFallback(
        userId: string,
        limit: number,
        cursor?: Date
    ): Promise<FeedCandidate[]> {
        return getInNetworkDirectFallback(userId, limit, cursor);
    }
    /**
     * 创建帖子
     */
    async createPost(params: CreatePostParams): Promise<IPost> {
        return createPost(params);
    }

    /**
     * 批量创建新闻帖子 (Crawler Hook)
     */
    async createNewsPosts(articles: any[]): Promise<number> {
        return createNewsPosts(articles);
    }

    /**
     * 获取帖子详情
     */
    async getPost(postId: string, userId?: string): Promise<IPost | null> {
        return getPost(postId, userId);
    }

    /**
     * 获取热门新闻话题聚合
     */
    async getNewsClusters(limit: number = 5): Promise<any[]> {
        return getNewsClusters(limit);
    }



    /**
     * 批量获取帖子 (保持输入 ID 顺序)
     */
    async getPostsByIds(postIds: string[]): Promise<IPost[]> {
        return getPostsByIds(postIds);
    }

    /**
     * 删除帖子
     */
    async deletePost(postId: string, userId: string): Promise<boolean> {
        return deletePost(postId, userId);
    }

    /**
     * 点赞帖子
     */
    async likePost(postId: string, userId: string): Promise<boolean> {
        return likePost(postId, userId);
    }

    /**
     * 取消点赞
     */
    async unlikePost(postId: string, userId: string): Promise<boolean> {
        return unlikePost(postId, userId);
    }

    /**
     * 转发帖子
     */
    async repostPost(postId: string, userId: string): Promise<IPost | null> {
        return repostPost(postId, userId);
    }

    /**
     * 取消转发
     */
    async unrepostPost(postId: string, userId: string): Promise<boolean> {
        return unrepostPost(postId, userId);
    }

    /**
     * 发表评论
     */
    async createComment(
        postId: string,
        userId: string,
        content: string,
        parentId?: string
    ): Promise<IComment> {
        return createComment(postId, userId, content, parentId);
    }

    /**
     * 获取帖子评论
     */
    async getPostComments(
        postId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<IComment[]> {
        return getPostComments(postId, limit, cursor);
    }

    /**
     * 获取推荐 Feed
     * 使用 SpaceFeedMixer 调用推荐管道
     */
    async getFeedPage(
        userId: string,
        limit: number = 20,
        cursor?: Date,
        includeSelf: boolean = false,
        options?: {
            requestId?: string;
            clientRequestId?: string;
            seenIds?: string[];
            servedIds?: string[];
            isBottomRequest?: boolean;
            clientAppId?: number;
            countryCode?: string;
            languageCode?: string;
            inNetworkOnly?: boolean;
        }
    ): Promise<SpaceFeedPageResult> {
        return getFeedPageImpl(userId, limit, cursor, includeSelf, options, {
            withFeedTrendKeywords: (query) => this.withFeedTrendKeywords(query),
            recordServedFeedTrace: (...args) => this.recordServedFeedTrace(...args),
            getUserPosts: (...args) => this.getUserPosts(...args),
            getUserMap: (...args) => this.getUserMap(...args),
            getPostsByIds: (...args) => this.getPostsByIds(...args),
            getInNetworkDirectFallback: (...args) => this.getInNetworkDirectFallback(...args),
        });
    }

    private async recordServedFeedTrace(...args: Parameters<typeof recordServedFeedTrace>): ReturnType<typeof recordServedFeedTrace> {
        return recordServedFeedTrace(...args);
    }


    private async withFeedTrendKeywords(query: FeedQuery): Promise<FeedQuery> {
        if (query.inNetworkOnly) {
            return query;
        }

        const trendKeywords = await this.getCachedFeedTrendKeywords();
        if (trendKeywords.length === 0) {
            return query;
        }

        return {
            ...query,
            rankingPolicy: {
                ...(query.rankingPolicy || {}),
                trendKeywords: mergeFeedTrendKeywords(
                    query.rankingPolicy?.trendKeywords,
                    trendKeywords,
                ),
            },
        };
    }

    private async getCachedFeedTrendKeywords(): Promise<string[]> {
        const now = Date.now();
        if (this.feedTrendKeywordCache && this.feedTrendKeywordCache.expiresAt > now) {
            return this.feedTrendKeywordCache.keywords;
        }

        try {
            const trends = await this.getTrendingTags(8, DEFAULT_TREND_WINDOW_HOURS);
            const keywords = mergeFeedTrendKeywords(
                [],
                trends.flatMap((trend) => [
                    trend.tag,
                    trend.displayName,
                    ...(trend.canonicalKeywords || []),
                ]),
            );
            const ttlMs = Math.max(
                10_000,
                Number.parseInt(process.env.RECOMMENDATION_FEED_TREND_KEYWORD_CACHE_MS || '60000', 10) || 60_000,
            );
            this.feedTrendKeywordCache = {
                expiresAt: now + ttlMs,
                keywords,
            };
            return keywords;
        } catch (error) {
            log.warn({ err: (error as any)?.message || error }, '[SpaceService] feed trend keyword policy skipped');
            return this.feedTrendKeywordCache?.keywords || [];
        }
    }

    /**
     * 获取用户的帖子列表
     */
    async getUserPosts(
        authorId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<IPost[]> {
        return getUserPosts(authorId, limit, cursor);
    }

    /**
     * 获取新闻帖子（按时间倒序）
     */
    async getNewsPosts(
        limit: number = 20,
        cursor?: Date,
        days: number = 1
    ): Promise<{ posts: IPost[]; hasMore: boolean; nextCursor?: string }> {
        return getNewsPosts(limit, cursor, days);
    }

    /**
     * 获取新闻简报（Home 顶部模块）
     */
    async getNewsBrief(
        userId: string,
        limit: number = 5,
        sinceHours: number = 24
    ): Promise<any[]> {
        const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
        const poolSize = Math.max(limit * 6, 30);

        const candidates = await Post.find({
            isNews: true,
            deletedAt: null,
            createdAt: { $gte: since },
        })
            .sort({ createdAt: -1 })
            .limit(poolSize)
            .lean();

        if (candidates.length === 0) return [];

        const interest = await this.buildUserInterestKeywords(userId, 200);

        const scored = candidates.map((post: any) => {
            const keywords = (post.keywords as string[])?.length
                ? (post.keywords as string[])
                : this.extractNewsKeywords(`${post.newsMetadata?.title || ''}\n${post.newsMetadata?.summary || post.content || ''}`);
            const similarity = this.computeSimilarity(interest, keywords);
            const recency = this.computeRecencyScore(post.createdAt);
            const sourceBoost = this.sourceWeight(post.newsMetadata?.source);
            const score = similarity * 0.5 + recency * 0.4 + sourceBoost * 0.1;
            return { post, score };
        });

        const ranked = scored.sort((a, b) => b.score - a.score);
        const mediaRanked = ranked.filter(({ post }) => {
            const coverUrl = String(post.media?.[0]?.url || '').trim();
            return /^https?:\/\//i.test(coverUrl) || coverUrl.startsWith('/api/');
        });
        const selected = mediaRanked.length >= limit ? mediaRanked : ranked;

        return selected
            .slice(0, limit)
            .map(({ post }) => ({
                postId: post._id?.toString(),
                title: post.newsMetadata?.title || (post.content || '').split('\n')[0] || '新闻速递',
                summary: post.newsMetadata?.summary || this.buildNewsSummary(post.content || ''),
                source: post.newsMetadata?.source || 'news',
                url: post.newsMetadata?.url,
                coverUrl: post.media?.[0]?.url,
                clusterId: post.newsMetadata?.clusterId,
                createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : post.createdAt,
            }));
    }

    /**
     * 获取用户点赞过的帖子列表
     */
    async getUserLikedPosts(
        targetUserId: string,
        viewerId?: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<{ posts: any[]; hasMore: boolean; nextCursor?: string }> {
        return getUserLikedPosts(targetUserId, viewerId, limit, cursor);
    }

    /**
     * 获取用户空间主页信息
     */
    async getUserProfile(
        targetUserId: string,
        viewerId?: string
    ): Promise<{
        id: string;
        username: string;
        avatarUrl?: string | null;
        isOnline?: boolean | null;
        lastSeen?: Date | null;
        createdAt?: Date | null;
        displayName?: string | null;
        bio?: string | null;
        location?: string | null;
        website?: string | null;
        coverUrl?: string | null;
        stats: {
            posts: number;
            followers: number;
            following: number;
        };
        isFollowed: boolean;
        pinnedPost?: IPost | null;
    } | null> {
        return getUserProfile(targetUserId, viewerId);
    }

    /**
     * 更新用户空间封面
     */
    async setUserCover(userId: string, coverUrl: string | null): Promise<string | null> {
        return setUserCover(userId, coverUrl);
    }

    /**
     * 更新用户 Space 个性化资料（displayName/bio/location/website）
     * 工业级：与登录用户名解耦，避免“改名=改账号”。
     */
    async updateSpaceProfileFields(
        userId: string,
        updates: {
            displayName?: string | null;
            bio?: string | null;
            location?: string | null;
            website?: string | null;
        }
    ): Promise<{
        displayName: string | null;
        bio: string | null;
        location: string | null;
        website: string | null;
    }> {
        return updateSpaceProfileFields(userId, updates);
    }

    /**
     * 置顶动态
     */
    async pinPost(postId: string, userId: string): Promise<IPost | null> {
        return pinPost(postId, userId);
    }

    /**
     * 取消置顶动态
     */
    async unpinPost(postId: string, userId: string): Promise<IPost | null> {
        return unpinPost(postId, userId);
    }

    /**
     * 搜索帖子 (关键词兜底)
     */
    async searchPosts(
        query: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<IPost[]> {
        const result = await this.searchPostsPage(query, limit, cursor);
        return result.posts;
    }

    async searchPostsPage(
        query: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<SpaceSearchPageResult> {
        return searchPostsPage(query, limit, cursor);
    }

    async getTopicPosts(
        tag: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<SpaceSearchPageResult> {
        return getTopicPosts(tag, limit, cursor);
    }







    /**
     * 获取话题下的新闻帖子
     */
    async getNewsClusterPosts(clusterId: number, limit: number = 20): Promise<IPost[]> {
        return getNewsClusterPosts(clusterId, limit);
    }

    /**
     * 清理过期新闻 (7天前)
     */
    async cleanupOldNews(): Promise<number> {
        return cleanupOldNews();
    }

    /**
     * 获取热门话题 (显式 keywords 优先，缺失时从正文/新闻元信息提取)
     */
    async getTrendingTags(limit: number = 6, sinceHours: number = DEFAULT_TREND_WINDOW_HOURS): Promise<SpaceTrendResult[]> {
        const windowHours = Number.isFinite(sinceHours) && sinceHours > 0
            ? sinceHours
            : DEFAULT_TREND_WINDOW_HOURS;
        const mode = getNewsTrendsRustMode();

        if (mode !== 'off') {
            const rustRequest = async () => {
                const posts = await this.loadTrendingPostsForWindow(windowHours);
                return newsTrendService.computeSpaceTrends({ posts, limit, windowHours });
            };
            if (mode === 'shadow') {
                rustRequest().catch((error) => {
                    log.warn({ err: error }, '[SpaceService] rust space trends shadow failed');
                });
            } else {
                try {
                    const rustTrends = await rustRequest();
                    if (rustTrends.length > 0) {
                        const trends = await this.withSearchMatchCounts(this.dedupeTrendsByTag(rustTrends));
                        return trends.slice(0, limit);
                    }
                } catch (error) {
                    log.warn({ err: error }, '[SpaceService] rust space trends primary failed, falling back');
                }
            }
        }

        const tags = await this.collectTrendingTags(limit, windowHours);

        const max = tags.reduce((acc, t) => Math.max(acc, t.count), 1);
        const socialTrends = tags.slice(0, limit).map((t) => ({
            tag: t.tag,
            count: t.count,
            heat: Math.round((t.count / max) * 100),
        }));
        if (socialTrends.length >= limit) {
            return socialTrends;
        }

        const newsTrends = await this.getNewsTopicTrendFallback(limit - socialTrends.length);
        return this.dedupeTrendsByTag([...socialTrends, ...newsTrends]).slice(0, limit);
    }

    private async getNewsTopicTrendFallback(limit: number): Promise<SpaceTrendResult[]> {
        if (limit <= 0) return [];
        try {
            const topics = await newsService.getTopics(limit);
            return topics
                .map((topic): SpaceTrendResult | undefined => {
                    const tag = this.normalizeTopicTag(topic.tag || topic.title || topic.displayName || '');
                    if (!tag) return undefined;
                    return {
                        tag,
                        count: topic.count,
                        heat: topic.heat ?? Math.max(1, Math.min(100, topic.count * 10)),
                        displayName: topic.displayName || topic.title,
                        kind: topic.kind || 'news_event',
                        score: topic.score,
                        canonicalKeywords: topic.canonicalKeywords,
                    } satisfies SpaceTrendResult;
                })
                .filter((trend): trend is SpaceTrendResult => Boolean(trend));
        } catch (error) {
            log.warn({ err: error }, '[SpaceService] news topic trend fallback failed');
            return [];
        }
    }

    private async withSearchMatchCounts(trends: SpaceTrendResult[]): Promise<SpaceTrendResult[]> {
        return Promise.all(
            trends.map(async (trend) => {
                const searchCount = await this.countSearchMatchesForTrendTag(trend.tag);
                return {
                    ...trend,
                    count: Math.max(trend.count, searchCount),
                };
            })
        );
    }

    private async countSearchMatchesForTrendTag(tag: string): Promise<number> {
        const normalizedTag = this.normalizeTopicTag(tag);
        if (!normalizedTag) return 0;
        try {
            const counts = await Promise.all(
                this.buildTopicTextSearchQueries(normalizedTag)
                    .flatMap((query) => [
                        countTextSearchMatches(query),
                        countExactTextSearchMatches(query),
                    ])
            );
            return Math.max(0, ...counts);
        } catch (error) {
            log.warn({ data: { tag: normalizedTag, error } }, '[SpaceService] trend search count failed');
            return 0;
        }
    }

    private buildTopicTextSearchQueries(normalizedTag: string): string[] {
        return buildTopicTextSearchQueries(normalizedTag);
    }



    private dedupeTrendsByTag(trends: SpaceTrendResult[]): SpaceTrendResult[] {
        return dedupeTrendsByTag(trends);
    }

    private normalizeTopicTag(tag: string): string {
        return normalizeTopicTag(tag);
    }

    private async collectTrendingTags(limit: number, sinceHours: number): Promise<Array<{ tag: string; count: number }>> {
        const primary = await this.collectTrendingTagsForWindow(limit, sinceHours);
        if (primary.length >= limit || sinceHours >= 168) return primary;
        const extended = await this.collectTrendingTagsForWindow(limit, 168);
        const merged = new Map(primary.map((tag) => [tag.tag, tag]));
        for (const tag of extended) {
            if (!merged.has(tag.tag)) merged.set(tag.tag, tag);
            if (merged.size >= limit) break;
        }
        return Array.from(merged.values());
    }

    private async collectTrendingTagsForWindow(limit: number, sinceHours: number): Promise<Array<{ tag: string; count: number }>> {
        const posts = await this.loadTrendingPostsForWindow(sinceHours);

        const counts = new Map<string, { tag: string; count: number; latestAt: number }>();
        for (const post of posts) {
            const keywords = this.extractTrendKeywords(post);
            const uniqueKeywords = Array.from(new Set(keywords.map((tag) => tag.toLowerCase())));
            const weight = this.trendPostWeight(post);
            const createdAt = post.createdAt ? new Date(post.createdAt) : new Date();
            const latestAt = Number.isFinite(createdAt.getTime()) ? createdAt.getTime() : Date.now();

            for (const key of uniqueKeywords) {
                if (!this.isValidTrendToken(key)) continue;
                const existing = counts.get(key);
                if (existing) {
                    existing.count += weight;
                    existing.latestAt = Math.max(existing.latestAt, latestAt);
                } else {
                    counts.set(key, { tag: key, count: weight, latestAt });
                }
            }
        }

        return Array.from(counts.values())
            .sort((a, b) => b.count - a.count || b.latestAt - a.latestAt || a.tag.localeCompare(b.tag))
            .slice(0, limit)
            .map(({ tag, count }) => ({ tag, count }));
    }

    private async loadTrendingPostsForWindow(sinceHours: number): Promise<SpaceTrendPostInput[]> {
        const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
        return Post.find({
            deletedAt: null,
            createdAt: { $gte: since },
        })
            .sort({ createdAt: -1 })
            .limit(MAX_TREND_SCAN_POSTS)
            .select('content keywords isNews newsMetadata.title newsMetadata.summary newsMetadata.source newsMetadata.url newsMetadata.sourceUrl newsMetadata.clusterId stats engagementScore createdAt updatedAt')
            .lean<SpaceTrendPostInput[]>();
    }

    private extractTrendKeywords(
        post: Pick<SpaceTrendPostInput, 'content' | 'keywords' | 'isNews' | 'newsMetadata'>
    ): string[] {
        return extractTrendKeywords(post);
    }


    private isValidTrendToken(token: string): boolean {
        return isValidTrendToken(token);
    }

    private trendPostWeight(
        post: Pick<SpaceTrendPostInput, 'stats' | 'engagementScore' | 'isNews'>
    ): number {
        return trendPostWeight(post);
    }

    /**
     * 推荐关注
     */
    async getRecommendedUsers(userId: string, limit: number = 4): Promise<RecommendedSpaceUser[]> {
        return getRecommendedUsers(userId, limit);
    }




    /**
     * 获取通知 (基于用户互动行为)
     */
    async getNotifications(
        userId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<{ items: Array<any>; hasMore: boolean; nextCursor?: string }> {
        const safeLimit = Math.max(1, Math.min(limit, 50));
        const scanLimit = Math.min(safeLimit * 3, 150);
        const query: Record<string, unknown> = {
            targetAuthorId: userId,
            userId: { $ne: userId },
            action: { $in: [ActionType.LIKE, ActionType.REPLY, ActionType.REPOST, ActionType.QUOTE] },
        };
        if (cursor) {
            query.timestamp = { $lt: cursor };
        }

        const actions = await UserAction.find(query)
            .sort({ timestamp: -1 })
            .limit(scanLimit)
            .lean();

        const dedupedActions: any[] = [];
        const seenNotifications = new Set<string>();
        for (const action of actions) {
            const key = [
                action.userId,
                action.action,
                action.targetPostId ? action.targetPostId.toString() : '',
            ].join(':');
            if (seenNotifications.has(key)) {
                continue;
            }
            seenNotifications.add(key);
            dedupedActions.push(action);
            if (dedupedActions.length >= safeLimit) {
                break;
            }
        }

        const actorIds = Array.from(new Set(dedupedActions.map((a: any) => a.userId)));
        const postIds = Array.from(new Set(dedupedActions.map((a: any) => a.targetPostId).filter(Boolean)));
        const commentIdsRaw = dedupedActions
            .filter((a: any) => a.action === ActionType.REPLY && a.targetCommentId)
            .map((a: any) => String(a.targetCommentId))
            .filter(Boolean);
        const commentObjIds = commentIdsRaw
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        const [userMap, posts, comments] = await Promise.all([
            this.getUserMap(actorIds),
            postIds.length > 0
                ? Post.find({ _id: { $in: postIds }, deletedAt: null })
                    .select('content')
                    .lean()
                : Promise.resolve([]),
            commentObjIds.length > 0
                ? Comment.find({ _id: { $in: commentObjIds }, deletedAt: null })
                    .select('content')
                    .lean()
                : Promise.resolve([]),
        ]);

        const postMap = new Map<string, { content: string }>();
        (posts as any[]).forEach((p) => {
            if (p._id) postMap.set(p._id.toString(), { content: p.content });
        });

        const commentMap = new Map<string, { content: string }>();
        (comments as any[]).forEach((c) => {
            if (c._id) commentMap.set(c._id.toString(), { content: c.content });
        });

        const items = dedupedActions.map((a: any) => {
            const actor = userMap.get(a.userId);
            const post = a.targetPostId ? postMap.get(a.targetPostId.toString()) : null;
            const snippet = post?.content ? post.content.slice(0, 80) : '';
            const commentId = a.targetCommentId ? String(a.targetCommentId) : undefined;
            const actionTextRaw = a.actionText
                ? String(a.actionText)
                : (commentId ? commentMap.get(commentId)?.content : '');
            const actionText = actionTextRaw ? String(actionTextRaw).slice(0, 160) : undefined;
            return {
                id: a._id?.toString(),
                type: a.action,
                actor: actor
                    ? {
                        id: actor.id,
                        username: actor.username,
                        avatarUrl: actor.avatarUrl,
                        isOnline: actor.isOnline,
                    }
                    : { id: a.userId, username: 'Unknown' },
                postId: a.targetPostId?.toString(),
                postSnippet: snippet,
                commentId,
                actionText,
                createdAt: a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp,
            };
        });

        return {
            items,
            hasMore: actions.length >= scanLimit || dedupedActions.length >= safeLimit,
            nextCursor: dedupedActions.length > 0
                ? (dedupedActions[dedupedActions.length - 1].timestamp as Date).toISOString()
                : undefined,
        };
    }

    /**
     * 获取评论 + 作者信息
     */
    async getCommentsWithAuthors(
        postId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<{ comments: Array<any>; hasMore: boolean; nextCursor?: string }> {
        return getCommentsWithAuthors(postId, limit, cursor);
    }

    /**
     * 提取关键词 (简单实现)
     */

    private buildNewsSummary(text: string): string {
        return buildNewsSummary(text);
    }

    private extractNewsKeywords(text: string): string[] {
        return extractNewsKeywords(text);
    }

    private computeSimilarity(
        interest: Map<string, number>,
        candidateKeywords: string[]
    ): number {
        return computeSimilarity(interest, candidateKeywords);
    }

    private computeRecencyScore(createdAt: Date | string): number {
        return computeRecencyScore(createdAt);
    }

    private sourceWeight(source?: string): number {
        return sourceWeight(source);
    }

    private async buildUserInterestKeywords(userId: string, limit: number = 200): Promise<Map<string, number>> {
        const since = new Date();
        since.setDate(since.getDate() - 30);

        const actions = await UserAction.find({
            userId,
            timestamp: { $gte: since },
            action: { $in: [ActionType.LIKE, ActionType.REPLY, ActionType.REPOST, ActionType.CLICK, ActionType.DWELL] },
            targetPostId: { $exists: true, $ne: null },
        })
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();

        const postIds = actions
            .map((a: any) => a.targetPostId)
            .filter(Boolean);

        if (postIds.length === 0) return new Map();

        const posts = await Post.find({ _id: { $in: postIds }, deletedAt: null })
            .select('keywords content')
            .lean();

        const postMap = new Map(posts.map((p: any) => [p._id.toString(), p]));
        const weights = new Map<string, number>();

        const actionWeight = (action: string, dwellTime?: number) => {
            if (action === ActionType.LIKE) return 3;
            if (action === ActionType.REPOST || action === ActionType.REPLY) return 2.5;
            if (action === ActionType.CLICK) return 1.5;
            if (action === ActionType.DWELL) return 1 + Math.min((dwellTime || 0) / 10000, 1);
            return 1;
        };

        for (const action of actions) {
            const post = postMap.get(action.targetPostId?.toString?.() || '');
            if (!post) continue;
            const kws = (post.keywords as string[])?.length
                ? (post.keywords as string[])
                : this.extractNewsKeywords(post.content || '');
            const weight = actionWeight(action.action, action.dwellTimeMs);
            for (const kw of kws) {
                weights.set(kw, (weights.get(kw) || 0) + weight);
            }
        }

        return weights;
    }
}

// 导出单例
export const spaceService = new SpaceService();
