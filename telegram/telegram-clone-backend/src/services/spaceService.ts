/**
 * Space 服务层
 * 处理空间动态的业务逻辑
 */

import mongoose from 'mongoose';
import Post, { IPost, MediaType } from '../models/Post';
import Like from '../models/Like';
import Repost, { RepostType } from '../models/Repost';
import Comment, { IComment } from '../models/Comment';
import UserAction, { ActionType } from '../models/UserAction';
import { createFeedCandidate, createFeedQuery, FeedCandidate, FeedQuery, getSpaceFeedMixer } from './recommendation';
import User from '../models/User';
import Contact, { ContactStatus } from '../models/Contact';
import SpaceProfile from '../models/SpaceProfile';
import { Op } from 'sequelize';
import { InNetworkTimelineService } from './recommendation/InNetworkTimelineService';
import { postFeatureSnapshotService } from './recommendation/contentFeatures';
import { HttpFeedRecommendClient, getDefaultMlServiceBaseUrl } from './recommendation/clients/FeedRecommendClient';
import {
    RustRecommendationClient,
    getDefaultRustRecommendationBaseUrl,
    getRustRecommendationMode,
    getRustRecommendationTimeoutMs,
} from './recommendation/clients/RustRecommendationClient';
import { UserFeaturesQueryHydrator } from './recommendation/hydrators/UserFeaturesQueryHydrator';
import { AuthorInfoHydrator } from './recommendation/hydrators/AuthorInfoHydrator';
import { UserInteractionHydrator } from './recommendation/hydrators/UserInteractionHydrator';
import { AuthorDiversityScorer } from './recommendation/scorers';
import {
    deserializeRecommendationCandidates,
    serializeRecommendationQuery,
} from './recommendation/rust/contracts';
import type { RecommendationTracePayload } from './recommendation/rust/contracts';
import { recommendationRuntimeMetrics } from './recommendation/rust/runtimeMetrics';
import type { RecommendationShadowComparison } from './recommendation/rust/runtimeMetrics';
import { recordRecommendationTrace } from './recommendation/observability/recommendationTrace';
import { attachRecommendationExplain } from './recommendation/explain/candidateExplain';
import { AuthorSuggestionService } from './recommendation/authorSuggestions';
import { getRelatedPostIds } from './recommendation/utils/relatedPostIds';
import {
  getNewsTrendsRustMode,
  newsTrendService,
  type SpaceTrendPostInput,
  type SpaceTrendResult,
} from './newsTrends';
import {
  AgeFilter,
  BlockedUserFilter,
  ConversationDedupFilter,
  DuplicateFilter,
  MutedKeywordFilter,
  PreviouslyServedFilter,
  RetweetDedupFilter,
  SeenPostFilter,
  SelfPostFilter,
} from './recommendation/filters';

const DEFAULT_TREND_WINDOW_HOURS = Number.parseInt(process.env.SPACE_TREND_WINDOW_HOURS || '72', 10);
const MAX_TREND_SCAN_POSTS = 500;

/**
 * 创建帖子参数
 */
export interface CreatePostParams {
    authorId: string;
    content: string;
    media?: { type: 'image' | 'video' | 'gif'; url: string }[];
    replyToPostId?: string;
    quotePostId?: string;
    quoteContent?: string;
}

export interface SpaceFeedPageResult {
    candidates: FeedCandidate[];
    hasMore: boolean;
    nextCursor?: string;
    servedIdsDelta: string[];
    rustServing?: {
        servingVersion?: string;
        stableOrderKey?: string;
        cursor?: string;
        nextCursor?: string;
        servedStateVersion?: string;
        hasMore?: boolean;
    };
    debug?: {
        requestId?: string;
        pipeline: string;
        owner?: string;
        fallbackMode?: string;
        selectedSourceCounts: Record<string, number>;
        inNetworkCount: number;
        outOfNetworkCount: number;
        degradedReasons: string[];
        shadowComparison?: RecommendationShadowComparison;
    };
}

export interface SpaceSearchPageResult {
    posts: IPost[];
    totalCount: number;
    hasMore: boolean;
    nextCursor?: string;
    query: string;
    tag?: string;
}

export interface RecommendedSpaceUser {
    id: string;
    username: string;
    avatarUrl?: string | null;
    isOnline?: boolean | null;
    reason?: string;
    isFollowed: boolean;
    recentPosts: number;
    engagementScore: number;
}

function buildRecommendationShadowComparison(
    baseline: FeedCandidate[],
    rustCandidates: FeedCandidate[],
): {
    overlapCount: number;
    overlapRatio: number;
    selectedCount: number;
    baselineCount: number;
} {
    const baselineIds = new Set(baseline.map((candidate) => candidate.postId.toString()));
    const overlapCount = rustCandidates.filter((candidate) =>
        baselineIds.has(candidate.postId.toString()),
    ).length;

    return {
        overlapCount,
        overlapRatio:
            rustCandidates.length > 0 ? overlapCount / rustCandidates.length : 0,
        selectedCount: rustCandidates.length,
        baselineCount: baseline.length,
    };
}

function buildSpaceFeedPageResult(
    candidates: FeedCandidate[],
    limit: number,
    pageMeta?: Partial<Omit<SpaceFeedPageResult, 'candidates' | 'servedIdsDelta'>>,
): SpaceFeedPageResult {
    const servedIdsDelta: string[] = [];
    const servedSeen = new Set<string>();

    for (const candidate of candidates) {
        for (const id of [
            ...getRelatedPostIds(candidate),
            ...getServedContextTokens(candidate),
        ]) {
            const value = String(id || '').trim();
            if (!value || servedSeen.has(value)) continue;
            servedSeen.add(value);
            servedIdsDelta.push(value);
        }
    }

    const lastCreatedAt = candidates.length > 0
        ? candidates[candidates.length - 1].createdAt
        : undefined;
    const derivedNextCursor = lastCreatedAt instanceof Date
        ? lastCreatedAt.toISOString()
        : typeof lastCreatedAt === 'string'
            ? new Date(lastCreatedAt).toISOString()
            : undefined;

    return {
        candidates,
        hasMore: pageMeta?.hasMore ?? candidates.length >= limit,
        nextCursor: pageMeta?.nextCursor ?? derivedNextCursor,
        servedIdsDelta,
        rustServing: pageMeta?.rustServing,
        debug: pageMeta?.debug,
    };
}

function getServedContextTokens(candidate: FeedCandidate): string[] {
    const tokens: string[] = [];
    const authorId = String(candidate.authorId || '').trim();
    if (authorId) {
        tokens.push(`author:${normalizeServedContextKey(authorId)}`);
    }

    const source = String(candidate.recallSource || candidate.retrievalLane || '').trim();
    if (source) {
        tokens.push(`source:${normalizeServedContextKey(source)}`);
    }

    const topic = getServedTopicContext(candidate);
    if (topic) {
        tokens.push(`topic:${topic}`);
    }

    return tokens;
}

function getServedTopicContext(candidate: FeedCandidate): string | undefined {
    const clusterId = candidate.newsMetadata?.clusterId;
    if (clusterId !== undefined && clusterId !== null) {
        return `news_cluster:${String(clusterId)}`;
    }
    const conversationId = String(candidate.conversationId || '').trim();
    if (conversationId) {
        return `conversation:${normalizeServedContextKey(conversationId)}`;
    }
    const interestPoolKind = String(candidate.interestPoolKind || '').trim();
    if (interestPoolKind) {
        return `interest_pool:${normalizeServedContextKey(interestPoolKind)}`;
    }
    if (candidate.isNews) return 'format:news';
    if (candidate.hasVideo) return 'format:video';
    if (candidate.hasImage) return 'format:image';
    if (candidate.isReply) return 'format:reply';
    if (candidate.isRepost) return 'format:repost';
    return 'format:text';
}

function normalizeServedContextKey(value: string): string {
    return value.trim().toLowerCase();
}

function summarizeSelectedSourceCounts(candidates: FeedCandidate[]): Record<string, number> {
    return candidates.reduce<Record<string, number>>((acc, candidate) => {
        const key = typeof candidate.recallSource === 'string' && candidate.recallSource
            ? candidate.recallSource
            : 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function buildSpaceFeedDebugInfo(
    candidates: FeedCandidate[],
    options: {
        requestId?: string;
        pipeline: string;
        owner?: string;
        fallbackMode?: string;
        degradedReasons?: string[];
        shadowComparison?: RecommendationShadowComparison;
    },
): NonNullable<SpaceFeedPageResult['debug']> {
    const inNetworkCount = candidates.filter((candidate) => Boolean(candidate.inNetwork)).length;
    return {
        requestId: options.requestId,
        pipeline: options.pipeline,
        owner: options.owner,
        fallbackMode: options.fallbackMode,
        selectedSourceCounts: summarizeSelectedSourceCounts(candidates),
        inNetworkCount,
        outOfNetworkCount: Math.max(candidates.length - inNetworkCount, 0),
        degradedReasons: options.degradedReasons ?? [],
        shadowComparison: options.shadowComparison,
    };
}

function mergeFeedTrendKeywords(
    current: string[] | undefined,
    next: Array<string | null | undefined>,
): string[] {
    const normalized: string[] = [];
    for (const value of [...(current || []), ...next]) {
        const text = String(value || '')
            .replace(/^#+/, '')
            .replace(/[_-]+/g, ' ')
            .trim()
            .toLowerCase();
        if (!text) continue;

        const parts = text.split(/\s+/).filter((part) => part.length >= 2);
        normalized.push(text);
        normalized.push(...parts);
    }

    return Array.from(new Set(
        normalized
            .map((value) => value.trim())
            .filter((value) => value.length >= 2 && value.length <= 48),
    )).slice(0, 32);
}

/**
 * Space 服务类
 */
class SpaceService {
    private readonly authorSuggestionService = new AuthorSuggestionService();
    private feedTrendKeywordCache?: { expiresAt: number; keywords: string[] };

    async getFeed(
        userId: string,
        limit: number = 20,
        cursor?: Date,
        includeSelf: boolean = false,
        options?: {
            requestId?: string;
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
        const isUuid = (value: string) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        const uniqueIds = Array.from(new Set(userIds.filter((id) => id && isUuid(id))));
        if (uniqueIds.length === 0) return new Map();

        const users = await User.findAll({
            where: { id: uniqueIds },
            attributes: ['id', 'username', 'avatarUrl', 'isOnline'],
        });

        const map = new Map<string, { id: string; username: string; avatarUrl?: string | null; isOnline?: boolean | null }>();
        users.forEach((u) => {
            map.set(u.id, {
                id: u.id,
                username: u.username,
                avatarUrl: u.avatarUrl,
                isOnline: u.isOnline,
            });
        });
        return map;
    }

    /**
     * 获取当前用户已关注列表 (Space 使用 Contact.accepted 作为关注)
     */
    private async getFollowedSet(userId: string): Promise<Set<string>> {
        try {
            const contacts = await Contact.findAll({
                where: { userId, status: ContactStatus.ACCEPTED },
                attributes: ['contactId'],
            });
            return new Set(contacts.map((c: { contactId: string }) => c.contactId));
        } catch (error) {
            console.error('[SpaceService] Failed to load followed users:', error);
            return new Set();
        }
    }

    private refreshPostFeatureSnapshots(postIds: Array<string | mongoose.Types.ObjectId | undefined | null>): void {
        const uniquePostIds = Array.from(
            new Map(
                postIds
                    .map((postId) => {
                        const normalized = typeof postId === 'string'
                            ? postId
                            : postId?.toString();
                        if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
                            return null;
                        }
                        return [
                            normalized,
                            new mongoose.Types.ObjectId(normalized),
                        ] as const;
                    })
                    .filter(Boolean) as Array<readonly [string, mongoose.Types.ObjectId]>,
            ).values(),
        );

        if (uniquePostIds.length === 0) {
            return;
        }

        postFeatureSnapshotService
            .refreshSnapshotsByPostIds(uniquePostIds)
            .catch((error) => {
                console.warn('[SpaceService] post feature snapshot refresh failed:', error);
            });
    }

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
        try {
            const relations = await Contact.findAll({
                where: {
                    status: ContactStatus.ACCEPTED,
                    [Op.or]: [{ userId }, { contactId: userId }],
                } as any,
                attributes: ['userId', 'contactId'],
                limit: 5000,
            });

            const authorSet = new Set<string>();
            for (const r of relations as Array<{ userId: string; contactId: string }>) {
                const other = r.userId === userId ? r.contactId : r.userId;
                if (other && other !== userId) authorSet.add(other);
            }
            if (authorSet.size === 0) return [];

            const query: Record<string, unknown> = {
                authorId: { $in: Array.from(authorSet) },
                isNews: { $ne: true },
                deletedAt: null,
            };
            if (cursor) query.createdAt = { $lt: cursor };

            const posts = await Post.find(query)
                .sort({ createdAt: -1 })
                .limit(Math.max(limit * 2, 40))
                .lean();
            if (posts.length === 0) return [];

            const authorIds = Array.from(new Set(posts.map((p: any) => String(p.authorId)).filter(Boolean)));
            const userMap = await this.getUserMap(authorIds);

            return posts.map((post: any) => {
                const base = createFeedCandidate(post);
                const author = userMap.get(String(post.authorId));
                return {
                    ...base,
                    inNetwork: true,
                    authorUsername: author?.username || base.authorUsername,
                    authorAvatarUrl: author?.avatarUrl ?? base.authorAvatarUrl,
                };
            });
        } catch (error) {
            console.error('[SpaceService] in-network direct fallback failed:', error);
            return [];
        }
    }
    /**
     * 创建帖子
     */
    async createPost(params: CreatePostParams): Promise<IPost> {
        const { authorId, content, media, replyToPostId, quotePostId, quoteContent } = params;

        // 提取关键词 (用于 MutedKeywordFilter)
        const keywords = this.extractKeywords(content);

        const postData: Partial<IPost> = {
            authorId,
            content,
            keywords,
            media: media?.map(m => ({ ...m, type: m.type as MediaType })) || [],
        };

        // 处理回复
        if (replyToPostId) {
            postData.isReply = true;
            postData.replyToPostId = new mongoose.Types.ObjectId(replyToPostId);

            // 获取对话根帖子
            const parentPost = await Post.findById(replyToPostId);
            if (parentPost) {
                postData.conversationId = (parentPost.conversationId || parentPost._id) as mongoose.Types.ObjectId;
                // 增加父帖子评论数
                await Post.incrementStat(parentPost._id as mongoose.Types.ObjectId, 'commentCount', 1);
            }
        }

        // 处理引用转发
        if (quotePostId) {
            postData.isRepost = true;
            postData.originalPostId = new mongoose.Types.ObjectId(quotePostId);
            postData.quoteContent = quoteContent;

            // 增加原帖引用数和转发数
            await Post.incrementStat(new mongoose.Types.ObjectId(quotePostId), 'quoteCount', 1);
            await Post.incrementStat(new mongoose.Types.ObjectId(quotePostId), 'repostCount', 1);
        }

        const post = new Post(postData);
        await post.save();

        // Write-light in-network timeline: one Redis ZSET write per post.
        // Best-effort: feed can fall back to DB-based paths if Redis is unavailable.
        InNetworkTimelineService.addPost(authorId, String(post._id), post.createdAt).catch((err) => {
            console.warn('[SpaceService] timeline addPost failed', err);
        });

        this.refreshPostFeatureSnapshots([
            post._id as mongoose.Types.ObjectId,
            replyToPostId,
            quotePostId,
        ]);

        return post;
    }

    /**
     * 批量创建新闻帖子 (Crawler Hook)
     */
    async createNewsPosts(articles: any[]): Promise<number> {
        let count = 0;
        const NEWS_BOT_ID = 'news_bot_official';

        for (const article of articles) {
            if (!article?.url) continue;

            const title = article.title || '新闻速递';
            const rawContent = article.content || `${title}\n\n${article.summary || ''}`;
            const summary = this.buildNewsSummary(article.summary || rawContent);
            const keywords = this.extractNewsKeywords(`${title}\n${summary}`);
            const createdAt = article.published ? new Date(article.published) : new Date();

            const postData: Partial<IPost> = {
                authorId: NEWS_BOT_ID,
                content: rawContent,
                keywords,
                isNews: true,
                newsMetadata: {
                    title,
                    source: article.source || 'news',
                    url: article.url,
                    clusterId: article.cluster_id,
                    summary,
                },
                media: article.top_image ? [{ type: MediaType.IMAGE, url: article.top_image }] : [],
                createdAt,
            };

            const result = await Post.updateOne(
                { 'newsMetadata.url': article.url },
                { $setOnInsert: postData },
                { upsert: true }
            );

            if ((result as any).upsertedCount > 0) {
                count++;
            }
        }
        return count;
    }

    /**
     * 获取帖子详情
     */
    async getPost(postId: string, userId?: string): Promise<IPost | null> {
        if (!mongoose.Types.ObjectId.isValid(postId)) return null;

        const post = await Post.findOne({
            _id: postId,
            deletedAt: null,
        });

        if (!post) return null;

        // 记录浏览行为
        if (userId) {
            await UserAction.logActions([
                {
                    userId,
                    action: ActionType.CLICK,
                    targetPostId: post._id as mongoose.Types.ObjectId,
                    targetAuthorId: post.authorId,
                },
            ]);

            // 增加浏览数
            await Post.incrementStat(post._id as mongoose.Types.ObjectId, 'viewCount', 1);
        }
        return post;
    }

    /**
     * 获取热门新闻话题聚合
     */
    async getNewsClusters(limit: number = 5): Promise<any[]> {
        // 聚合最近 24 小时的新闻
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

        return Post.aggregate([
            {
                $match: {
                    isNews: true,
                    createdAt: { $gte: since },
                    deletedAt: null
                }
            },
            {
                $group: {
                    _id: "$newsMetadata.clusterId",
                    count: { $sum: 1 },
                    representativePost: { $first: "$$ROOT" }, // 取最新的一条作为代表
                    avgScore: { $avg: "$engagementScore" } // 假设有分数
                }
            },
            { $sort: { count: -1 } }, // 按热度排序
            { $limit: limit },
            {
                $project: {
                    clusterId: "$_id",
                    postId: "$representativePost._id",
                    count: 1,
                    title: { $ifNull: ["$representativePost.newsMetadata.title", "$representativePost.content"] },
                    summary: "$representativePost.newsMetadata.summary",
                    source: "$representativePost.newsMetadata.source",
                    coverUrl: {
                        $ifNull: [
                            { $arrayElemAt: ["$representativePost.media.url", 0] },
                            null,
                        ],
                    },
                    latestAt: "$representativePost.createdAt"
                }
            }
        ]);
    }



    /**
     * 批量获取帖子 (保持输入 ID 顺序)
     */
    async getPostsByIds(postIds: string[]): Promise<IPost[]> {
        if (!postIds || postIds.length === 0) return [];

        const normalizedIds = postIds.map((id) => String(id || '').trim()).filter(Boolean);
        const objectIdStrings = normalizedIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
        const externalIds = normalizedIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));

        const orQuery: Record<string, unknown>[] = [];
        if (objectIdStrings.length > 0) {
            orQuery.push({
                _id: { $in: objectIdStrings.map((id) => new mongoose.Types.ObjectId(id)) },
            });
        }
        if (externalIds.length > 0) {
            orQuery.push({
                'newsMetadata.externalId': { $in: externalIds },
            });
        }
        if (orQuery.length === 0) return [];

        const posts = await Post.find({
            deletedAt: null,
            $or: orQuery,
        });

        // 内存中重新排序 (MongoDB $in 不保证顺序)，同时支持 objectId 和 externalId 两种语料 ID
        const objectIdMap = new Map<string, IPost>();
        const externalIdMap = new Map<string, IPost>();
        for (const p of posts) {
            const idStr = p._id?.toString?.();
            if (idStr) objectIdMap.set(idStr, p);
            const ext = p.newsMetadata?.externalId ? String(p.newsMetadata.externalId) : '';
            if (ext) externalIdMap.set(ext, p);
        }

        return normalizedIds
            .map((id) => {
                if (mongoose.Types.ObjectId.isValid(id)) {
                    return objectIdMap.get(id) || externalIdMap.get(id);
                }
                return externalIdMap.get(id);
            })
            .filter((p): p is IPost => !!p);
    }

    /**
     * 删除帖子
     */
    async deletePost(postId: string, userId: string): Promise<boolean> {
        const post = await Post.findOne({
            _id: postId,
            authorId: userId,
            deletedAt: null,
        });

        if (!post) return false;

        post.deletedAt = new Date();
        await post.save();

        // Best-effort removal from Redis in-network timeline.
        InNetworkTimelineService.removePost(post.authorId, String(post._id)).catch(() => undefined);
        return true;
    }

    /**
     * 点赞帖子
     */
    async likePost(postId: string, userId: string): Promise<boolean> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        const post = await Post.findById(postObjId);

        if (!post) return false;

        try {
            await Like.create({
                userId,
                postId: postObjId,
                authorId: post.authorId,
            });

            // 增加点赞数
            await Post.incrementStat(postObjId, 'likeCount', 1);

            // 记录行为
            await UserAction.logActions([
                {
                    userId,
                    action: ActionType.LIKE,
                    targetPostId: postObjId,
                    targetAuthorId: post.authorId,
                },
            ]);

            this.refreshPostFeatureSnapshots([postObjId]);

            return true;
        } catch (error: unknown) {
            // 重复点赞
            if ((error as { code?: number }).code === 11000) {
                return false;
            }
            throw error;
        }
    }

    /**
     * 取消点赞
     */
    async unlikePost(postId: string, userId: string): Promise<boolean> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        const result = await Like.deleteOne({ userId, postId: postObjId });

        if (result.deletedCount > 0) {
            await Post.incrementStat(postObjId, 'likeCount', -1);
            this.refreshPostFeatureSnapshots([postObjId]);
            return true;
        }

        return false;
    }

    /**
     * 转发帖子
     */
    async repostPost(postId: string, userId: string): Promise<IPost | null> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        const post = await Post.findById(postObjId);

        if (!post) return null;

        try {
            await Repost.create({
                userId,
                postId: postObjId,
                type: RepostType.REPOST,
            });

            // 增加转发数
            await Post.incrementStat(postObjId, 'repostCount', 1);

            // 记录行为
            await UserAction.logActions([
                {
                    userId,
                    action: ActionType.REPOST,
                    targetPostId: postObjId,
                    targetAuthorId: post.authorId,
                },
            ]);

            this.refreshPostFeatureSnapshots([postObjId]);

            // 返回更新后的帖子
            const updated = await Post.findById(postObjId);
            return updated;
        } catch (error: unknown) {
            if ((error as { code?: number }).code === 11000) {
                return null;
            }
            throw error;
        }
    }

    /**
     * 取消转发
     */
    async unrepostPost(postId: string, userId: string): Promise<boolean> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        const result = await Repost.deleteOne({
            userId,
            postId: postObjId,
            type: RepostType.REPOST,
        });

        if (result.deletedCount > 0) {
            await Post.incrementStat(postObjId, 'repostCount', -1);
            this.refreshPostFeatureSnapshots([postObjId]);
            return true;
        }

        return false;
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
        const postObjId = new mongoose.Types.ObjectId(postId);
        const post = await Post.findById(postObjId);

        if (!post) {
            throw new Error('帖子不存在');
        }

        const comment = new Comment({
            userId,
            postId: postObjId,
            content,
            parentId: parentId ? new mongoose.Types.ObjectId(parentId) : undefined,
        });

        await comment.save();

        // 增加评论数
        await Post.incrementStat(postObjId, 'commentCount', 1);

        // 记录行为
        await UserAction.logActions([
            {
                userId,
                action: ActionType.REPLY,
                targetPostId: postObjId,
                targetCommentId: comment._id as unknown as mongoose.Types.ObjectId,
                targetAuthorId: post.authorId,
                actionText: String(content || '').slice(0, 280),
            },
        ]);

        this.refreshPostFeatureSnapshots([postObjId]);

        return comment;
    }

    /**
     * 获取帖子评论
     */
    async getPostComments(
        postId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<IComment[]> {
        const postObjId = new mongoose.Types.ObjectId(postId);
        return Comment.getPostComments(postObjId, limit, cursor);
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
            seenIds?: string[];
            servedIds?: string[];
            isBottomRequest?: boolean;
            clientAppId?: number;
            countryCode?: string;
            languageCode?: string;
            inNetworkOnly?: boolean;
        }
    ): Promise<SpaceFeedPageResult> {
        const rustRecommendationMode = getRustRecommendationMode();
        const useMlFeed = String(process.env.ML_FEED_ENABLED ?? 'false').toLowerCase() === 'true';
        const inNetworkOnly = options?.inNetworkOnly ?? false;
        const requestId =
            options?.requestId ??
            createFeedQuery(userId, limit, inNetworkOnly).requestId;

        const createBaseQuery = () =>
            createFeedQuery(userId, limit, inNetworkOnly, {
                cursor,
                requestId,
                seenIds: options?.seenIds ?? [],
                servedIds: options?.servedIds ?? [],
                isBottomRequest: options?.isBottomRequest ?? Boolean(cursor),
                clientAppId: options?.clientAppId,
                countryCode: options?.countryCode,
                languageCode: options?.languageCode,
            });

        const runLocalMixerFeed = async (): Promise<FeedCandidate[]> => {
            const mixer = getSpaceFeedMixer({ debug: true });
            return mixer.getFeed(userId, limit, cursor, inNetworkOnly, {
                requestId: options?.requestId,
                seenIds: options?.seenIds,
                servedIds: options?.servedIds,
                isBottomRequest: options?.isBottomRequest,
                clientAppId: options?.clientAppId,
                countryCode: options?.countryCode,
                languageCode: options?.languageCode,
            });
        };

        const runMlFeed = async (): Promise<FeedCandidate[]> => {
            // 1) Build query context (blocked/muted/following list)
            const baseQuery = createBaseQuery();
            const query = await new UserFeaturesQueryHydrator().hydrate(baseQuery);

            // 2) In-network candidate IDs from Redis author timelines
            const followed = query.userFeatures?.followedUserIds ?? [];
            const inNetworkCandidateIds = await InNetworkTimelineService.getMergedPostIdsForAuthors({
                authorIds: followed,
                cursor,
                maxResults: 200,
            });

            // 3) Single-call ML: ANN + Rank + VF
            const mlClient = new HttpFeedRecommendClient(getDefaultMlServiceBaseUrl(), 4500);
            const rec = await mlClient.recommend({
                userId,
                limit,
                cursor: cursor ? cursor.toISOString() : undefined,
                request_id: query.requestId,
                in_network_only: inNetworkOnly,
                is_bottom_request: query.isBottomRequest,
                inNetworkCandidateIds: inNetworkCandidateIds,
                seen_ids: query.seenIds,
                served_ids: query.servedIds,
            });

            const items = rec.candidates;
            const scoredMap = new Map(items.map((c) => [c.postId, c]));
            const ids = items.map((c) => c.postId);

            // 4) Hydrate posts and attach ML scores
            const posts = await this.getPostsByIds(ids);
            if (posts.length === 0) {
                throw new Error('ml_feed_empty_or_unhydrated');
            }

            let candidates: FeedCandidate[] = posts.map((post) => {
                const pid = String(post._id);
                const info = scoredMap.get(pid);
                const base = createFeedCandidate(post.toObject());
                return {
                    ...base,
                    inNetwork: info?.inNetwork ?? false,
                    phoenixScores: info?.phoenixScores,
                    weightedScore: info?.score ?? 0,
                    score: info?.score ?? 0,
                };
            });

            // 5) Local hydrators (author info + user interactions)
            candidates = await new AuthorInfoHydrator().hydrate(query, candidates);
            candidates = await new UserInteractionHydrator().hydrate(query, candidates);

            // 6) Local hard filters (still required even if ML did VF)
            const filters = [
                new DuplicateFilter(),
                new SelfPostFilter(),
                new RetweetDedupFilter(),
                new AgeFilter(7),
                new BlockedUserFilter(),
                new MutedKeywordFilter(),
                new SeenPostFilter(),
                new PreviouslyServedFilter(),
            ];

            let kept = candidates;
            for (const filter of filters) {
                if (!filter.enable(query)) continue;
                const result = await filter.filter(query, kept);
                kept = result.kept;
            }

            try {
                const scorer = new AuthorDiversityScorer();
                const scored = await scorer.score(query, kept);
                kept = scored.map((entry) => entry.candidate);
                kept.sort((left, right) => (right.score || 0) - (left.score || 0));
            } catch (error) {
                console.warn('[SpaceService] diversity scoring skipped:', (error as any)?.message || error);
            }

            const conversationResult = await new ConversationDedupFilter().filter(query, kept);
            kept = conversationResult.kept;

            const feed = kept.slice(0, limit);

            if (feed.length > 0) {
                UserAction.logActions(
                    feed.map((candidate) => ({
                        userId,
                        action: ActionType.DELIVERY,
                        targetPostId: candidate.postId,
                        targetAuthorId: candidate.authorId,
                        productSurface: 'space_feed',
                        requestId: query.requestId,
                        timestamp: new Date(),
                    })),
                ).catch(() => undefined);
            }

            return feed;
        };

        const runBaselineFeed = async (): Promise<FeedCandidate[]> => {
            if (!useMlFeed) {
                return runLocalMixerFeed();
            }

            try {
                return await runMlFeed();
            } catch (err) {
                console.warn(
                    '[SpaceService] ML feed failed, falling back to local pipeline:',
                    (err as any)?.message || err,
                );
                return runLocalMixerFeed();
            }
        };

        let feed: FeedCandidate[];
        let pageMeta: Partial<Omit<SpaceFeedPageResult, 'candidates' | 'servedIdsDelta'>> | undefined;
        let debugInfo: SpaceFeedPageResult['debug'];
        let rustTraceForServedFeed: RecommendationTracePayload | undefined;
        let finalFeedQuery = createBaseQuery();

        if (rustRecommendationMode === 'primary') {
            try {
                const rustClient = new RustRecommendationClient(
                    getDefaultRustRecommendationBaseUrl(),
                    getRustRecommendationTimeoutMs(),
                );
                const rustQuery = await this.withFeedTrendKeywords(createBaseQuery());
                finalFeedQuery = rustQuery;
                const rustResult = await rustClient.getCandidates(
                    serializeRecommendationQuery(rustQuery),
                );
                recommendationRuntimeMetrics.recordPrimary(rustResult.summary);
                const rustCandidates = deserializeRecommendationCandidates(rustResult.candidates);
                pageMeta = {
                    hasMore: rustResult.hasMore,
                    nextCursor: rustResult.nextCursor,
                    rustServing: {
                        servingVersion: rustResult.servingVersion,
                        stableOrderKey: rustResult.stableOrderKey,
                        cursor: rustResult.cursor,
                        nextCursor: rustResult.nextCursor,
                        servedStateVersion: rustResult.servedStateVersion,
                        hasMore: rustResult.hasMore,
                    },
                };

                if (rustCandidates.length === 0) {
                    console.warn(
                        '[SpaceService] Rust recommendation primary returned empty selection, falling back to baseline pipeline',
                    );
                    feed = await runBaselineFeed();
                    finalFeedQuery = createBaseQuery();
                    debugInfo = buildSpaceFeedDebugInfo(feed, {
                        requestId,
                        pipeline: 'rust_primary_empty_fallback_node',
                        owner: rustResult.summary.owner,
                        fallbackMode: rustResult.summary.fallbackMode,
                        degradedReasons: [
                            ...rustResult.summary.degradedReasons,
                            'rust_primary_empty_selection',
                        ],
                    });
                } else {
                    feed = rustCandidates;
                    rustTraceForServedFeed = rustResult.summary.trace;
                    debugInfo = buildSpaceFeedDebugInfo(feed, {
                        requestId,
                        pipeline: 'rust_primary',
                        owner: rustResult.summary.owner,
                        fallbackMode: rustResult.summary.fallbackMode,
                        degradedReasons: rustResult.summary.degradedReasons,
                    });
                }
            } catch (error) {
                console.warn(
                    '[SpaceService] Rust recommendation primary failed, falling back to baseline pipeline:',
                    (error as any)?.message || error,
                );
                feed = await runBaselineFeed();
                finalFeedQuery = createBaseQuery();
                debugInfo = buildSpaceFeedDebugInfo(feed, {
                    requestId,
                    pipeline: 'rust_primary_error_fallback_node',
                    owner: 'node',
                    fallbackMode: 'rust_primary_failed',
                    degradedReasons: [String((error as any)?.message || error || 'rust_primary_failed')],
                });
            }
        } else {
            feed = await runBaselineFeed();
            debugInfo = buildSpaceFeedDebugInfo(feed, {
                requestId,
                pipeline: rustRecommendationMode === 'shadow' ? 'node_baseline_with_rust_shadow' : 'node_baseline',
                owner: 'node',
                fallbackMode: rustRecommendationMode === 'shadow' ? 'shadow_compare_only' : 'node_local_mixer',
            });

            if (rustRecommendationMode === 'shadow') {
                try {
                    const rustClient = new RustRecommendationClient(
                        getDefaultRustRecommendationBaseUrl(),
                        getRustRecommendationTimeoutMs(),
                    );
                    const rustQuery = await this.withFeedTrendKeywords(createBaseQuery());
                    const rustResult = await rustClient.getCandidates(
                        serializeRecommendationQuery(rustQuery),
                    );
                    const rustCandidates = deserializeRecommendationCandidates(rustResult.candidates);
                    const shadowComparison = buildRecommendationShadowComparison(feed, rustCandidates);
                    recommendationRuntimeMetrics.recordShadow(
                        rustResult.summary,
                        shadowComparison,
                    );
                    debugInfo = buildSpaceFeedDebugInfo(feed, {
                        requestId,
                        pipeline: 'node_baseline_with_rust_shadow',
                        owner: 'node',
                        fallbackMode: rustResult.summary.fallbackMode,
                        degradedReasons: rustResult.summary.degradedReasons,
                        shadowComparison,
                    });
                } catch (error) {
                    console.warn(
                        '[SpaceService] Rust recommendation shadow failed:',
                        (error as any)?.message || error,
                    );
                    debugInfo = buildSpaceFeedDebugInfo(feed, {
                        requestId,
                        pipeline: 'node_baseline_shadow_failed',
                        owner: 'node',
                        fallbackMode: 'shadow_failed',
                        degradedReasons: [String((error as any)?.message || error || 'rust_shadow_failed')],
                    });
                }
            }
        }

        if (inNetworkOnly) {
            const hasOtherAuthors = feed.some((item) => item.authorId && String(item.authorId) !== userId);
            if (!hasOtherAuthors) {
                const directFallback = await this.getInNetworkDirectFallback(userId, limit, cursor);
                if (directFallback.length > 0) {
                    const seen = new Set(feed.map((item) => String(item.postId)));
                    for (const candidate of directFallback) {
                        const id = String(candidate.postId);
                        if (!id || seen.has(id)) continue;
                        seen.add(id);
                        feed.push(candidate);
                        if (feed.length >= Math.max(limit * 2, 40)) break;
                    }
                    feed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                }
            }
        }

        feed = attachRecommendationExplain(feed, finalFeedQuery);

        void this.recordServedFeedTrace(
            finalFeedQuery,
            feed,
            debugInfo,
            pageMeta?.rustServing,
            rustTraceForServedFeed,
        );

        if (!includeSelf) {
            return buildSpaceFeedPageResult(feed, limit, {
                ...pageMeta,
                debug: debugInfo,
            });
        }

        const selfLimit = Math.min(5, limit);
        const [selfPosts, userMap] = await Promise.all([
            this.getUserPosts(userId, selfLimit, cursor),
            this.getUserMap([userId]),
        ]);

        if (selfPosts.length === 0) {
            return buildSpaceFeedPageResult(feed, limit, {
                ...pageMeta,
                debug: debugInfo,
            });
        }

        const user = userMap.get(userId);
        const selfCandidates: FeedCandidate[] = selfPosts.map((post) => {
            const base = createFeedCandidate(post.toObject());
            return {
                ...base,
                authorUsername: user?.username || 'Unknown',
                authorAvatarUrl: user?.avatarUrl ?? undefined,
                isLikedByUser: false,
                isRepostedByUser: false,
            };
        });

        const merged = [...selfCandidates, ...feed].sort((a, b) => {
            return b.createdAt.getTime() - a.createdAt.getTime();
        });

        const seen = new Set<string>();
        const result: FeedCandidate[] = [];

        for (const item of merged) {
            const id = item.postId.toString();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            result.push(item);
            if (result.length >= limit) break;
        }

        return buildSpaceFeedPageResult(result, limit, {
            ...pageMeta,
            debug: buildSpaceFeedDebugInfo(result, {
                requestId: debugInfo?.requestId,
                pipeline: debugInfo?.pipeline || 'node_baseline',
                owner: debugInfo?.owner,
                fallbackMode: debugInfo?.fallbackMode,
                degradedReasons: debugInfo?.degradedReasons,
                shadowComparison: debugInfo?.shadowComparison,
            }),
        });
    }

    private async recordServedFeedTrace(
        query: FeedQuery,
        feed: FeedCandidate[],
        debugInfo?: SpaceFeedPageResult['debug'],
        serving?: SpaceFeedPageResult['rustServing'],
        rustTrace?: RecommendationTracePayload,
    ): Promise<void> {
        try {
            await recordRecommendationTrace(query, feed, {
                pipeline: debugInfo?.pipeline,
                owner: debugInfo?.owner,
                fallbackMode: debugInfo?.fallbackMode,
                degradedReasons: debugInfo?.degradedReasons,
                shadowComparison: debugInfo?.shadowComparison,
                serving,
                rustTrace,
            });
        } catch (error) {
            console.warn('[SpaceService] recommendation trace skipped:', (error as any)?.message || error);
        }
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
            console.warn('[SpaceService] feed trend keyword policy skipped:', (error as any)?.message || error);
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
        const query: Record<string, unknown> = {
            authorId,
            deletedAt: null,
        };

        if (cursor) {
            query.createdAt = { $lt: cursor };
        }

        return Post.find(query).sort({ createdAt: -1 }).limit(limit);
    }

    /**
     * 获取新闻帖子（按时间倒序）
     */
    async getNewsPosts(
        limit: number = 20,
        cursor?: Date,
        days: number = 1
    ): Promise<{ posts: IPost[]; hasMore: boolean; nextCursor?: string }> {
        const since = new Date();
        since.setDate(since.getDate() - Math.max(days, 1));

        const query: Record<string, unknown> = {
            isNews: true,
            deletedAt: null,
            createdAt: { $gte: since },
        };

        if (cursor) {
            query.createdAt = { $gte: since, $lt: cursor };
        }

        const posts = await Post.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        const nextCursor = posts.length > 0
            ? new Date(posts[posts.length - 1].createdAt).toISOString()
            : undefined;

        return {
            posts: posts as unknown as IPost[],
            hasMore: posts.length >= limit,
            nextCursor,
        };
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

        return scored
            .sort((a, b) => b.score - a.score)
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
        const likeQuery: Record<string, unknown> = { userId: targetUserId };
        if (cursor) {
            likeQuery.createdAt = { $lt: cursor };
        }

        const likes = await Like.find(likeQuery)
            .sort({ createdAt: -1 })
            .select('postId createdAt')
            .limit(limit)
            .lean();

        const nextCursor = likes.length > 0
            ? new Date(likes[likes.length - 1].createdAt).toISOString()
            : undefined;

        const postIds = likes
            .map((like: { postId?: mongoose.Types.ObjectId }) => like.postId)
            .filter((id: mongoose.Types.ObjectId | undefined): id is mongoose.Types.ObjectId => !!id);

        if (postIds.length === 0) {
            return { posts: [], hasMore: likes.length >= limit, nextCursor };
        }

        const idStrings = postIds.map((id) => id.toString());
        const posts = await this.getPostsByIds(idStrings);

        const objectIds = postIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
        const [likedSet, repostedSet] = viewerId
            ? await Promise.all([
                Like.getLikedPostIds(viewerId, objectIds),
                Repost.getRepostedPostIds(viewerId, objectIds),
            ])
            : [new Set<string>(), new Set<string>()];

        const enriched = posts.map((post) => {
            const raw = post.toObject ? post.toObject() : post;
            const id = raw._id?.toString() || raw.id;
            return {
                ...raw,
                isLikedByUser: viewerId ? likedSet.has(id) : false,
                isRepostedByUser: viewerId ? repostedSet.has(id) : false,
            };
        });

        return {
            posts: enriched,
            hasMore: likes.length >= limit,
            nextCursor,
        };
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
        const user = await User.findByPk(targetUserId, {
            attributes: ['id', 'username', 'avatarUrl', 'isOnline', 'lastSeen', 'createdAt'],
        });

        if (!user) return null;

        const [postsCount, followersCount, followingCount, followRecord, profileDoc, pinnedPost] = await Promise.all([
            Post.countDocuments({ authorId: targetUserId, deletedAt: null }),
            Contact.count({ where: { contactId: targetUserId, status: ContactStatus.ACCEPTED } }),
            Contact.count({ where: { userId: targetUserId, status: ContactStatus.ACCEPTED } }),
            viewerId
                ? Contact.findOne({
                    where: {
                        userId: viewerId,
                        contactId: targetUserId,
                        status: ContactStatus.ACCEPTED,
                    },
                })
                : Promise.resolve(null),
            SpaceProfile.findOne({ userId: targetUserId }).lean(),
            Post.findOne({ authorId: targetUserId, isPinned: true, deletedAt: null }),
        ]);

        return {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl ?? null,
            isOnline: user.isOnline ?? null,
            lastSeen: user.lastSeen ?? null,
            createdAt: user.createdAt ?? null,
            displayName: profileDoc?.displayName ?? null,
            bio: profileDoc?.bio ?? null,
            location: profileDoc?.location ?? null,
            website: profileDoc?.website ?? null,
            coverUrl: profileDoc?.coverUrl ?? null,
            stats: {
                posts: postsCount,
                followers: followersCount,
                following: followingCount,
            },
            isFollowed: !!followRecord,
            pinnedPost,
        };
    }

    /**
     * 更新用户空间封面
     */
    async setUserCover(userId: string, coverUrl: string | null): Promise<string | null> {
        const updated = await SpaceProfile.findOneAndUpdate(
            { userId },
            { coverUrl },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return updated?.coverUrl ?? null;
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
        const $set: Record<string, unknown> = {};
        if (updates.displayName !== undefined) $set.displayName = updates.displayName;
        if (updates.bio !== undefined) $set.bio = updates.bio;
        if (updates.location !== undefined) $set.location = updates.location;
        if (updates.website !== undefined) $set.website = updates.website;

        const updated = await SpaceProfile.findOneAndUpdate(
            { userId },
            { $set },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        return {
            displayName: (updated as any)?.displayName ?? null,
            bio: (updated as any)?.bio ?? null,
            location: (updated as any)?.location ?? null,
            website: (updated as any)?.website ?? null,
        };
    }

    /**
     * 置顶动态
     */
    async pinPost(postId: string, userId: string): Promise<IPost | null> {
        if (!mongoose.Types.ObjectId.isValid(postId)) return null;
        const postObjectId = new mongoose.Types.ObjectId(postId);

        const post = await Post.findOne({ _id: postObjectId, authorId: userId, deletedAt: null });
        if (!post) return null;

        await Post.updateMany({ authorId: userId, isPinned: true }, { $set: { isPinned: false } });
        post.isPinned = true;
        await post.save();

        return post;
    }

    /**
     * 取消置顶动态
     */
    async unpinPost(postId: string, userId: string): Promise<IPost | null> {
        if (!mongoose.Types.ObjectId.isValid(postId)) return null;
        const postObjectId = new mongoose.Types.ObjectId(postId);

        const post = await Post.findOne({ _id: postObjectId, authorId: userId, deletedAt: null });
        if (!post) return null;

        post.isPinned = false;
        await post.save();

        return post;
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
        const normalizedQuery = String(query || '').trim();
        const safeLimit = this.normalizeSearchLimit(limit);

        if (!normalizedQuery) {
            return {
                posts: [],
                totalCount: 0,
                hasMore: false,
                query: normalizedQuery,
            };
        }

        const [totalCount, fetchedPosts] = await Promise.all([
            this.countTextSearchMatches(normalizedQuery),
            this.fetchTextSearchPosts(normalizedQuery, safeLimit + 1, cursor),
        ]);

        const hasMore = fetchedPosts.length > safeLimit;
        const posts = hasMore ? fetchedPosts.slice(0, safeLimit) : fetchedPosts;
        const lastPost = posts[posts.length - 1];
        const nextCursor = hasMore && lastPost?.createdAt
            ? new Date(lastPost.createdAt).toISOString()
            : undefined;

        return {
            posts,
            totalCount,
            hasMore,
            nextCursor,
            query: normalizedQuery,
        };
    }

    async getTopicPosts(
        tag: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<SpaceSearchPageResult> {
        const normalizedTag = this.normalizeTopicTag(tag);
        if (!normalizedTag) {
            return {
                posts: [],
                totalCount: 0,
                hasMore: false,
                query: '',
                tag: normalizedTag,
            };
        }

        const query = `#${normalizedTag}`;
        const result = await this.searchPostsPage(query, limit, cursor);
        return {
            ...result,
            query,
            tag: normalizedTag,
        };
    }

    private normalizeSearchLimit(limit: number): number {
        if (!Number.isFinite(limit)) return 20;
        return Math.max(1, Math.min(Math.trunc(limit), 50));
    }

    private buildTextSearchQuery(query: string, cursor?: Date): Record<string, unknown> {
        const searchQuery: Record<string, unknown> = {
            deletedAt: null,
            $text: { $search: query },
        };

        if (cursor) {
            searchQuery.createdAt = { $lt: cursor };
        }

        return searchQuery;
    }

    private async fetchTextSearchPosts(
        query: string,
        limit: number,
        cursor?: Date
    ): Promise<IPost[]> {
        return Post.find(this.buildTextSearchQuery(query, cursor))
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit)
            .exec();
    }

    private async countTextSearchMatches(query: string): Promise<number> {
        const normalizedQuery = String(query || '').trim();
        if (!normalizedQuery) return 0;
        return Post.countDocuments(this.buildTextSearchQuery(normalizedQuery)).exec();
    }

    /**
     * 获取话题下的新闻帖子
     */
    async getNewsClusterPosts(clusterId: number, limit: number = 20): Promise<IPost[]> {
        return Post.find({
            'newsMetadata.clusterId': clusterId,
            isNews: true,
            deletedAt: null
        })
            .sort({ createdAt: -1 })
            .limit(limit);
    }

    /**
     * 清理过期新闻 (7天前)
     */
    async cleanupOldNews(): Promise<number> {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const result = await Post.deleteMany({
            isNews: true,
            createdAt: { $lt: sevenDaysAgo }
        });

        console.log(`[Cleanup] Deleted ${result.deletedCount} old news posts.`);
        return result.deletedCount;
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
                    console.warn('[SpaceService] rust space trends shadow failed:', error);
                });
            } else {
                try {
                    const rustTrends = await rustRequest();
                    if (rustTrends.length > 0) {
                        const trends = await this.withSearchMatchCounts(this.dedupeTrendsByTag(rustTrends));
                        return trends.slice(0, limit);
                    }
                } catch (error) {
                    console.warn('[SpaceService] rust space trends primary failed, falling back:', error);
                }
            }
        }

        const tags = await this.collectTrendingTags(limit, windowHours);

        const max = tags.reduce((acc, t) => Math.max(acc, t.count), 1);
        return tags.slice(0, limit).map((t) => ({
            tag: t.tag,
            count: t.count,
            heat: Math.round((t.count / max) * 100),
        }));
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
            return await this.countTextSearchMatches(`#${normalizedTag}`);
        } catch (error) {
            console.warn('[SpaceService] trend search count failed:', { tag: normalizedTag, error });
            return 0;
        }
    }

    private dedupeTrendsByTag(trends: SpaceTrendResult[]): SpaceTrendResult[] {
        const byTag = new Map<string, SpaceTrendResult>();

        for (const trend of trends) {
            const key = this.normalizeTopicTag(trend.tag);
            if (!key) continue;

            const normalizedTrend: SpaceTrendResult = {
                ...trend,
                tag: key,
            };
            const existing = byTag.get(key);

            if (!existing) {
                byTag.set(key, normalizedTrend);
                continue;
            }

            const existingScore = existing.score ?? existing.heat ?? existing.count ?? 0;
            const nextScore = normalizedTrend.score ?? normalizedTrend.heat ?? normalizedTrend.count ?? 0;
            const winner = nextScore > existingScore ? normalizedTrend : existing;
            byTag.set(key, {
                ...winner,
                count: Math.max(existing.count, normalizedTrend.count),
                heat: Math.max(existing.heat, normalizedTrend.heat),
                canonicalKeywords: Array.from(new Set([
                    ...(existing.canonicalKeywords || []),
                    ...(normalizedTrend.canonicalKeywords || []),
                ])).slice(0, 8),
            });
        }

        return Array.from(byTag.values()).sort((left, right) =>
            (right.score ?? 0) - (left.score ?? 0)
            || right.heat - left.heat
            || right.count - left.count
            || left.tag.localeCompare(right.tag)
        );
    }

    private normalizeTopicTag(tag: string): string {
        return String(tag || '').trim().replace(/^#+/, '').toLowerCase();
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
        const explicit = Array.isArray(post.keywords)
            ? post.keywords.map((keyword) => String(keyword || '').trim().toLowerCase()).filter(Boolean)
            : [];
        if (explicit.length > 0) return explicit;

        const sourceText = post.isNews
            ? `${post.newsMetadata?.title || ''}\n${post.newsMetadata?.summary || ''}\n${post.content || ''}`
            : post.content || '';
        return this.extractTextTrendKeywords(sourceText);
    }

    private extractTextTrendKeywords(text: string): string[] {
        const cleaned = (text || '')
            .replace(/https?:\/\/\S+/g, ' ')
            .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
            .toLowerCase();
        const tokens = cleaned.match(/[a-zA-Z]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
        return Array.from(new Set(tokens.filter((token) => this.isValidTrendToken(token)))).slice(0, 12);
    }

    private isValidTrendToken(token: string): boolean {
        const t = token.trim().toLowerCase();
        if (!t) return false;
        if (t.length < 2 || t.length > 24) return false;
        if (/^\d+$/.test(t)) return false;
        if (t.includes('http') || t.includes('/') || t.includes(':')) return false;
        return !/^(the|and|for|with|from|that|this|have|has|were|was|are|but|not|you|your|they|them|their|into|than|over|after|before|about|today|yesterday|tomorrow|company|says|said|will|can|could|would|should|while|during|under|again|more|less|very|demo|cohort|note)$/.test(t);
    }

    private trendPostWeight(
        post: Pick<SpaceTrendPostInput, 'stats' | 'engagementScore' | 'isNews'>
    ): number {
        const stats = post.stats || {};
        const engagement =
            Number(post.engagementScore || 0) ||
            Number(stats.likeCount || 0) +
                Number(stats.commentCount || 0) * 2 +
                Number(stats.repostCount || 0) * 3;
        const engagementBoost = Math.min(4, Math.floor(Math.max(0, engagement) / 20));
        return Math.max(1, 1 + engagementBoost + (post.isNews ? 1 : 0));
    }

    /**
     * 推荐关注
     */
    async getRecommendedUsers(userId: string, limit: number = 4): Promise<RecommendedSpaceUser[]> {
        return this.withRecommendedUsersFallback(
            this.authorSuggestionService.getRecommendedUsers(userId, limit),
            () => this.getFastRecommendedUsers(userId, limit),
        );
    }

    private async withRecommendedUsersFallback(
        work: Promise<RecommendedSpaceUser[]>,
        fallback: () => Promise<RecommendedSpaceUser[]>,
    ): Promise<RecommendedSpaceUser[]> {
        let timedOut = false;
        let timer: NodeJS.Timeout | undefined;
        const guardedWork = work.catch(async (error) => {
            console.warn('[SpaceService] author suggestions failed:', (error as any)?.message || error);
            return timedOut ? [] : fallback();
        });
        const timeout = new Promise<RecommendedSpaceUser[]>((resolve) => {
            timer = setTimeout(async () => {
                timedOut = true;
                console.warn('[SpaceService] author suggestions timed out, using fast fallback');
                resolve(await fallback());
            }, 1800);
        });

        try {
            return await Promise.race([guardedWork, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async getFastRecommendedUsers(userId: string, limit: number): Promise<RecommendedSpaceUser[]> {
        const safeLimit = Math.max(1, Math.min(12, limit));
        const followed = await this.getFollowedSet(userId);
        const excluded = new Set<string>([userId, ...followed]);
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
            return this.getFastFallbackUsers(excludedIds, safeLimit);
        }

        const userMap = await this.getUserMap(rankedAuthorIds);
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

    private async getFastFallbackUsers(excludedIds: string[], limit: number): Promise<RecommendedSpaceUser[]> {
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

    /**
     * 获取通知 (基于用户互动行为)
     */
    async getNotifications(
        userId: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<{ items: Array<any>; hasMore: boolean; nextCursor?: string }> {
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
            .limit(limit)
            .lean();

        const actorIds = Array.from(new Set(actions.map((a: any) => a.userId)));
        const postIds = Array.from(new Set(actions.map((a: any) => a.targetPostId).filter(Boolean)));
        const commentIdsRaw = actions
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

        const items = actions.map((a: any) => {
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
            hasMore: actions.length >= limit,
            nextCursor: actions.length > 0
                ? (actions[actions.length - 1].timestamp as Date).toISOString()
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
        const postObjId = new mongoose.Types.ObjectId(postId);
        const comments = await Comment.getPostComments(postObjId, limit, cursor);

        const userIds = comments.map((c) => c.userId);
        const userMap = await this.getUserMap(userIds);

        const transformed = comments.map((c) => {
            const author = userMap.get(c.userId);
            return {
                id: c._id?.toString(),
                postId: c.postId?.toString(),
                content: c.content,
                author: author
                    ? {
                        id: author.id,
                        username: author.username,
                        avatarUrl: author.avatarUrl,
                        isOnline: author.isOnline,
                    }
                    : { id: c.userId, username: 'Unknown' },
                likeCount: c.likeCount || 0,
                parentId: c.parentId?.toString(),
                replyToUserId: c.replyToUserId,
                createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
            };
        });

        return {
            comments: transformed,
            hasMore: comments.length >= limit,
            nextCursor: comments.length > 0
                ? comments[comments.length - 1].createdAt.toISOString()
                : undefined,
        };
    }

    /**
     * 提取关键词 (简单实现)
     */
    private extractKeywords(content: string): string[] {
        // 简单实现: 提取 hashtags 和分词
        const hashtags = content.match(/#[\u4e00-\u9fa5\w]+/g) || [];
        return hashtags.map((tag) => tag.slice(1));
    }

    private buildNewsSummary(text: string): string {
        const cleaned = (text || '').replace(/\s+/g, ' ').trim();
        if (cleaned.length <= 160) return cleaned;
        return `${cleaned.slice(0, 160)}...`;
    }

    private extractNewsKeywords(text: string): string[] {
        const cleaned = (text || '').replace(/https?:\/\/\S+/g, ' ');
        const english = cleaned.match(/[a-zA-Z]{3,}/g) || [];
        const numbers = cleaned.match(/\b\d{2,}\b/g) || [];
        const chinese = cleaned.match(/[\u4e00-\u9fff]{2,}/g) || [];
        const tokens = [...english, ...numbers, ...chinese]
            .map((t) => t.toLowerCase())
            .slice(0, 30);
        return Array.from(new Set(tokens));
    }

    private computeSimilarity(
        interest: Map<string, number>,
        candidateKeywords: string[]
    ): number {
        if (interest.size === 0 || candidateKeywords.length === 0) return 0;
        let score = 0;
        let norm = 0;
        for (const val of interest.values()) norm += val;
        for (const kw of candidateKeywords) {
            if (interest.has(kw)) score += interest.get(kw) || 0;
        }
        return score / Math.max(norm, 1);
    }

    private computeRecencyScore(createdAt: Date | string): number {
        const ts = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
        const hours = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
        return Math.exp(-hours / 12);
    }

    private sourceWeight(source?: string): number {
        const key = (source || '').toLowerCase();
        if (key.includes('reuters')) return 1.0;
        if (key.includes('bbc')) return 0.9;
        if (key.includes('cnn')) return 0.85;
        return 0.7;
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
