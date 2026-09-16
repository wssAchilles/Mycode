/**
 * Space feed page orchestration.
 * Extracted from spaceService with identical control flow.
 */
import { v4 as uuidv4 } from 'uuid';
import Contact, { ContactStatus } from '../../../models/Contact';
import { Op } from 'sequelize';
import {
    createFeedCandidate,
    createFeedQuery,
    FeedCandidate,
    FeedQuery,
    getSpaceFeedMixer,
} from '../../recommendation';
import { recordRecommendationEvents } from '../../recommendation/events';
import { InNetworkTimelineService } from '../../recommendation/InNetworkTimelineService';
import { HttpFeedRecommendClient, getDefaultMlServiceBaseUrl } from '../../recommendation/clients/FeedRecommendClient';
import { UserFeaturesQueryHydrator } from '../../recommendation/hydrators/UserFeaturesQueryHydrator';
import { AuthorInfoHydrator } from '../../recommendation/hydrators/AuthorInfoHydrator';
import { UserInteractionHydrator } from '../../recommendation/hydrators/UserInteractionHydrator';
import { AuthorDiversityScorer } from '../../recommendation/scorers';
import type { RecommendationTracePayload } from '../../recommendation/rust/contracts';
import { recordRecommendationTrace } from '../../recommendation/observability/recommendationTrace';
import {
    buildRecommendationDecisionLogV1,
    isRecommendationDecisionLogV1Enabled,
    persistRecommendationDecisionLogV1,
} from '../../recommendation/decisionLog/write';
import { attachRecommendationExplain } from '../../recommendation/explain/candidateExplain';
import { buildSpaceFeedDebugInfo } from '../../recommendation/feed/debugInfo';
import { resolveFeedRuntime } from '../../recommendation/feed/rustFeedRuntime';
import {
    buildSpaceFeedPageResult,
    type SpaceFeedPageResult,
} from '../../recommendation/feed/pageResult';
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
} from '../../recommendation/filters';
import { getPostsByIds } from '../posts/postMutations';
import { getUserMap } from '../internal/userMap';
import { getUserPosts } from '../profiles/profileQueries';
import Post from '../../../models/Post';
import { createChildLogger } from '../../../utils/logger';

const log = createChildLogger('services:spaceService');

export async function getInNetworkDirectFallback(
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
            const userMap = await getUserMap(authorIds);

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

export async function recordServedFeedTrace(
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

export async function getFeedPage(
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
        },
        deps: {
            withFeedTrendKeywords: (query: FeedQuery) => Promise<FeedQuery>;
            recordServedFeedTrace?: typeof recordServedFeedTrace;
            getUserPosts?: typeof getUserPosts;
            getUserMap?: typeof getUserMap;
            getPostsByIds?: typeof getPostsByIds;
            getInNetworkDirectFallback?: typeof getInNetworkDirectFallback;
        } | undefined = undefined,
    ): Promise<SpaceFeedPageResult> {
        if (!deps) {
            throw new Error('feed_page_deps_required');
        }
        const recordTrace = deps.recordServedFeedTrace ?? recordServedFeedTrace;
        const resolveUserPosts = deps.getUserPosts ?? getUserPosts;
        const resolveUserMap = deps.getUserMap ?? getUserMap;
        const resolvePostsByIds = deps.getPostsByIds ?? getPostsByIds;
        const resolveInNetworkFallback = deps.getInNetworkDirectFallback ?? getInNetworkDirectFallback;
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
            const posts = await resolvePostsByIds(ids);
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
            withFeedTrendKeywords: (query) => deps.withFeedTrendKeywords(query),
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
                const directFallback = await resolveInNetworkFallback(userId, limit, cursor);
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
                resolveUserPosts(userId, selfLimit, cursor),
                resolveUserMap([userId]),
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
        void recordTrace(
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
