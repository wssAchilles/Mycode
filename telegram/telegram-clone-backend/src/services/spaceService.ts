/**
 * Space 服务层
 * 处理空间动态的业务逻辑
 */

import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import Post, { IPost, MediaType } from '../models/Post';
import Like from '../models/Like';
import Repost, { RepostType } from '../models/Repost';
import Comment, { IComment } from '../models/Comment';
import UserAction, { ActionType } from '../models/UserAction';
import { createFeedCandidate, createFeedQuery, FeedCandidate, FeedQuery, getSpaceFeedMixer } from './recommendation';
import { recordRecommendationEvent, recordRecommendationEvents } from './recommendation/events';
import User from '../models/User';
import Contact, { ContactStatus } from '../models/Contact';
import SpaceProfile from '../models/SpaceProfile';
import { Op } from 'sequelize';
import { newsService } from './newsService';
import { InNetworkTimelineService } from './recommendation/InNetworkTimelineService';
import { postFeatureSnapshotService } from './recommendation/contentFeatures';
import { HttpFeedRecommendClient, getDefaultMlServiceBaseUrl } from './recommendation/clients/FeedRecommendClient';
import { UserFeaturesQueryHydrator } from './recommendation/hydrators/UserFeaturesQueryHydrator';
import { AuthorInfoHydrator } from './recommendation/hydrators/AuthorInfoHydrator';
import { UserInteractionHydrator } from './recommendation/hydrators/UserInteractionHydrator';
import { AuthorDiversityScorer } from './recommendation/scorers';
import type { RecommendationTracePayload } from './recommendation/rust/contracts';
import { recordRecommendationTrace } from './recommendation/observability/recommendationTrace';
import {
    buildRecommendationDecisionLogV1,
    isRecommendationDecisionLogV1Enabled,
    persistRecommendationDecisionLogV1,
} from './recommendation/decisionLog/write';
import { attachRecommendationExplain } from './recommendation/explain/candidateExplain';
import {
    buildSpaceFeedDebugInfo,
} from './recommendation/feed/debugInfo';
import {
    resolveFeedRuntime,
} from './recommendation/feed/rustFeedRuntime';
import {
    buildSpaceFeedPageResult,
    type SpaceFeedPageResult,
} from './recommendation/feed/pageResult';
import { AuthorSuggestionService } from './recommendation/authorSuggestions';
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
import { createChildLogger } from '../utils/logger';
import {
    buildExactTextSearchQuery,
    buildNewsSummary,
    buildTextSearchQuery,
    buildTopicTextSearchQueries,
    computeRecencyScore,
    computeSimilarity,
    dedupePostsById,
    dedupeTrendsByTag,
    escapeRegexLiteral,
    extractKeywords,
    extractNewsKeywords,
    extractTextTrendKeywords,
    extractTrendKeywords,
    isValidTrendToken,
    mergeFeedTrendKeywords,
    normalizeSearchLimit,
    normalizeTopicTag,
    sourceWeight,
    trendPostWeight,
} from './space/internal/pureHelpers';
import {
    cleanupOldNews,
    createNewsPosts,
    getNewsClusterPosts,
    getNewsClusters,
    getNewsPosts,
} from './space/news/newsQueries';
import {
    countExactTextSearchMatches,
    countTextSearchMatches,
    getTopicPosts,
    newsArticleToSpacePost,
    searchNewsTopicPosts,
    searchPostsByExactTextPage,
    searchPostsPage,
} from './space/search/searchQueries';
import {
    createPost,
    deletePost,
    getPost,
    getPostsByIds,
    pinPost,
    unpinPost,
} from './space/posts/postMutations';
import { refreshPostFeatureSnapshots } from './space/internal/postFeatureSnapshots';
import { getUserMap } from './space/internal/userMap';
import {
    createComment,
    getCommentsWithAuthors,
    getPostComments,
    likePost,
    repostPost,
    unlikePost,
    unrepostPost,
} from './space/interactions/interactions';

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
    private readonly authorSuggestionService = new AuthorSuggestionService();
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
    private async getFollowedSet(userId: string): Promise<Set<string>> {
        try {
            const contacts = await Contact.findAll({
                where: { userId, status: ContactStatus.ACCEPTED },
                attributes: ['contactId'],
            });
            return new Set(contacts.map((c: { contactId: string }) => c.contactId));
        } catch (error) {
            log.error({ err: error }, '[SpaceService] Failed to load followed users');
            return new Set();
        }
    }

    private refreshPostFeatureSnapshots(postIds: Array<string | mongoose.Types.ObjectId | undefined | null>): void {
        refreshPostFeatureSnapshots(postIds);
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
            log.error({ err: error }, '[SpaceService] in-network direct fallback failed');
            return [];
        }
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
        const useMlFeed = String(process.env.ML_FEED_ENABLED ?? 'false').toLowerCase() === 'true';
        const inNetworkOnly = options?.inNetworkOnly ?? false;
        const requestId = options?.requestId ?? uuidv4();
        const decisionId = uuidv4();
        const clientRequestId = options?.clientRequestId;
        const pageIdentity = { requestId, decisionId, clientRequestId };

        const createBaseQuery = () =>
            createFeedQuery(userId, limit, inNetworkOnly, {
                cursor,
                requestId,
                decisionId,
                clientRequestId,
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
                requestId,
                decisionId,
                clientRequestId,
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
                log.warn({ err: (error as any)?.message || error }, '[SpaceService] diversity scoring skipped');
            }

            const conversationResult = await new ConversationDedupFilter().filter(query, kept);
            kept = conversationResult.kept;

            const feed = kept.slice(0, limit);

            if (feed.length > 0) {
                recordRecommendationEvents(
                    feed.map((candidate) => ({
                        userId,
                        eventType: 'delivery',
                        targetId: candidate.postId,
                        targetAuthorId: candidate.authorId,
                        productSurface: 'space_feed',
                        requestId: query.requestId,
                        occurredAt: new Date(),
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
                log.warn(
                    '[SpaceService] ML feed failed, falling back to local pipeline:',
                    (err as any)?.message || err,
                );
                return runLocalMixerFeed();
            }
        };

        const runtimeResult = await resolveFeedRuntime({
            userId,
            limit,
            requestId,
            createBaseQuery,
            runBaselineFeed,
            withFeedTrendKeywords: (query) => this.withFeedTrendKeywords(query),
        });
        if (runtimeResult.safetyContextUnavailable) {
            return buildSpaceFeedPageResult([], limit, {
                ...runtimeResult.pageMeta,
                ...pageIdentity,
                debug: runtimeResult.debugInfo,
            });
        }
        let feed = runtimeResult.feed;
        const pageMeta = runtimeResult.pageMeta;
        const debugInfo = runtimeResult.debugInfo;
        const rustTraceForServedFeed = runtimeResult.rustTraceForServedFeed;
        const finalFeedQuery = runtimeResult.finalFeedQuery;

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

        try {
            feed = await new AuthorInfoHydrator().hydrate(finalFeedQuery, feed);
        } catch (error) {
            log.warn({ err: (error as any)?.message || error }, '[SpaceService] author hydration skipped');
        }

        feed = attachRecommendationExplain(feed, finalFeedQuery);
        const policyFeed = feed;
        let finalServedCandidates = policyFeed;
        let finalDebugInfo = debugInfo;
        const terminalCursorAbstention = cursor !== undefined
            && pageMeta?.continuationAbstained === true;

        if (includeSelf && !terminalCursorAbstention) {
            const selfLimit = Math.min(5, limit);
            const [selfPosts, userMap] = await Promise.all([
                this.getUserPosts(userId, selfLimit, cursor),
                this.getUserMap([userId]),
            ]);

            if (selfPosts.length > 0) {
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
                const merged = [...selfCandidates, ...policyFeed].sort((a, b) => {
                    return b.createdAt.getTime() - a.createdAt.getTime();
                });
                const seen = new Set<string>();
                finalServedCandidates = [];
                for (const item of merged) {
                    const id = item.postId.toString();
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    finalServedCandidates.push(item);
                    if (finalServedCandidates.length > limit) break;
                }
                finalDebugInfo = buildSpaceFeedDebugInfo(finalServedCandidates.slice(0, limit), {
                    requestId: debugInfo?.requestId,
                    pipeline: debugInfo?.pipeline || 'node_baseline',
                    runtimeMode: debugInfo.runtimeMode,
                    configuredServingOwner: debugInfo.configuredServingOwner,
                    servingOwner: debugInfo.servingOwner,
                    evaluatedOwner: debugInfo.evaluatedOwner,
                    fallbackOwner: debugInfo.fallbackOwner,
                    fallbackReason: debugInfo.fallbackReason,
                    fallbackMode: debugInfo?.fallbackMode,
                    degradedReasons: debugInfo?.degradedReasons,
                    shadowComparison: debugInfo?.shadowComparison,
                });
            }
        }

        const policyCandidateIds = new Set(policyFeed.map((candidate) => candidate.postId.toString()));
        const decisionActionCandidateIds = Array.from(new Set(
            finalServedCandidates
                .map((candidate) => candidate.postId.toString())
                .filter((candidateId) => policyCandidateIds.has(candidateId)),
        ));
        const page = buildSpaceFeedPageResult(finalServedCandidates, limit, {
            ...pageMeta,
            decisionActionCandidateIds,
            debug: finalDebugInfo,
            ...pageIdentity,
        });
        const decisionAt = new Date();
        void this.recordServedFeedTrace(
            finalFeedQuery,
            policyFeed,
            page.candidates,
            finalDebugInfo,
            page.rustServing,
            rustTraceForServedFeed,
            decisionAt,
        );
        return page;
    }

    private async recordServedFeedTrace(
        query: FeedQuery,
        policyFeed: FeedCandidate[],
        finalServedCandidates: FeedCandidate[],
        debugInfo: SpaceFeedPageResult['debug'] | undefined,
        serving: SpaceFeedPageResult['rustServing'] | undefined,
        rustTrace: RecommendationTracePayload | undefined,
        decisionAt: Date,
    ): Promise<void> {
        try {
            await recordRecommendationTrace(query, policyFeed, {
                pipeline: debugInfo?.pipeline,
                runtimeMode: debugInfo?.runtimeMode,
                servingOwner: debugInfo?.servingOwner,
                fallbackReason: debugInfo?.fallbackReason,
                owner: debugInfo?.owner,
                fallbackMode: debugInfo?.fallbackMode,
                degradedReasons: debugInfo?.degradedReasons,
                shadowComparison: debugInfo?.shadowComparison,
                serving,
                rustTrace,
            });
        } catch (error) {
            log.warn({ err: (error as any)?.message || error }, '[SpaceService] recommendation trace skipped');
        }

        if (!isRecommendationDecisionLogV1Enabled()) return;
        try {
            const decisionLog = buildRecommendationDecisionLogV1({
                query,
                policyCandidates: policyFeed,
                finalServedCandidates,
                debugInfo,
                rustTrace,
                decisionAt,
            });
            await persistRecommendationDecisionLogV1(decisionLog);
        } catch (error) {
            log.warn({
                code: (error as any)?.code,
                err: (error as any)?.message || error,
            }, '[SpaceService] recommendation decision log skipped');
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

    private async searchNewsTopicPosts(
        tag: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<SpaceSearchPageResult> {
        return searchNewsTopicPosts(tag, limit, cursor);
    }

    private newsArticleToSpacePost(article: Awaited<ReturnType<typeof newsService.searchTopicArticles>>['articles'][number]) {
        return newsArticleToSpacePost(article);
    }

    private normalizeSearchLimit(limit: number): number {
        return normalizeSearchLimit(limit);
    }

    private buildTextSearchQuery(query: string, cursor?: Date): Record<string, unknown> {
        return buildTextSearchQuery(query, cursor);
    }

    private async searchPostsByExactTextPage(
        query: string,
        limit: number = 20,
        cursor?: Date
    ): Promise<SpaceSearchPageResult> {
        return searchPostsByExactTextPage(query, limit, cursor);
    }

    private buildExactTextSearchQuery(query: string, cursor?: Date): Record<string, unknown> {
        return buildExactTextSearchQuery(query, cursor);
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

    private escapeRegexLiteral(value: string): string {
        return escapeRegexLiteral(value);
    }

    private dedupePostsById(posts: IPost[]): IPost[] {
        return dedupePostsById(posts);
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

    private extractTextTrendKeywords(text: string): string[] {
        return extractTextTrendKeywords(text);
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
    private extractKeywords(content: string): string[] {
        return extractKeywords(content);
    }

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
