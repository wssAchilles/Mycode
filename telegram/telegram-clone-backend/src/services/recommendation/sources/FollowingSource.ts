/**
 * FollowingSource - 关注网络内容源
 * 复刻 x-algorithm thunder_source.rs
 * 获取用户关注的人发布的帖子
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';
import { followingTimelineCache } from './FollowingTimelineCache';
import mongoose from 'mongoose';
import { InNetworkTimelineReadSummary, InNetworkTimelineService } from '../InNetworkTimelineService';

/**
 * 配置参数
 */
const MAX_RESULTS = 200; // 复刻 THUNDER_MAX_RESULTS

// Industrial guard: avoid Mongo fan-out when Redis timelines are empty/unavailable.
// For large follow graphs, falling back to Mongo can explode query cost and p95.
const MONGO_FALLBACK_ENABLED =
    String(process.env.FOLLOWING_SOURCE_MONGO_FALLBACK_ENABLED ?? 'true').toLowerCase() === 'true';
const MONGO_FALLBACK_MAX_FOLLOWED =
    parseInt(String(process.env.FOLLOWING_SOURCE_MONGO_FALLBACK_MAX_FOLLOWED ?? '200'), 10) || 200;

export class FollowingSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'FollowingSource';
    private readonly stageDetails = new Map<string, Record<string, unknown>>();

    enable(query: FeedQuery): boolean {
        // 需要用户关注列表
        return (
            !!query.userFeatures &&
            query.userFeatures.followedUserIds.length > 0
        );
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        const followedUserIds = query.userFeatures?.followedUserIds || [];

        if (followedUserIds.length === 0) {
            this.recordStageDetail(query, {
                sourcePath: 'disabled_no_followed_authors',
                sourceCount: 0,
                fallbackReason: 'no_followed_authors',
                dedupCount: 0,
            });
            return [];
        }

        // Preferred industrial path: Redis author timelines (write-light, no Mongo fan-out on reads)
        const timelineRead = await InNetworkTimelineService.getMergedPostIdsForAuthorsWithSummary({
            authorIds: followedUserIds,
            cursor: query.cursor,
            maxResults: MAX_RESULTS,
        });
        const ids = timelineRead.postIds;

        if (ids.length > 0) {
            const objIds = ids.map((id) => new mongoose.Types.ObjectId(id));
            const posts = await Post.find({
                _id: { $in: objIds },
                isNews: { $ne: true },
                deletedAt: null,
            }).lean();

            // Mongo $in does not preserve order, so re-order by Redis timeline order
            const postMap = new Map(posts.map((p: any) => [p._id.toString(), p]));
            const ordered = ids.map((id) => postMap.get(id)).filter(Boolean) as any[];
            this.recordStageDetail(query, this.buildStageDetail('redis_author_timeline', timelineRead.summary));

            return ordered.map((post) => ({
                ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
                inNetwork: true,
            }));
        }

        // Fallback: shared in-process cache that still scans Mongo (kept for compatibility until backfill)
        if (!MONGO_FALLBACK_ENABLED || followedUserIds.length > MONGO_FALLBACK_MAX_FOLLOWED) {
            return [];
        }
        const fallbackPosts = await followingTimelineCache.getPostsForAuthors(
            followedUserIds,
            query.cursor
        );
        if (fallbackPosts.length > 0) {
            const limited = fallbackPosts.slice(0, MAX_RESULTS);
            this.recordStageDetail(query, {
                ...this.buildStageDetail('node_following_timeline_cache', timelineRead.summary),
                fallbackReason: timelineRead.summary.fallbackReason || 'redis_timeline_underfilled',
                cacheOutputCount: limited.length,
            });
            return limited.map((post) => ({
                ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
                inNetwork: true,
            }));
        }

        // Hard fallback for in-network feed:
        // when Redis/cache miss (or historical data fell out of timeline window),
        // query followed authors directly so "好友" 模式不会退化成只看自己。
        if (query.inNetworkOnly && followedUserIds.length <= MONGO_FALLBACK_MAX_FOLLOWED) {
            const mongoQuery: Record<string, unknown> = {
                authorId: { $in: followedUserIds },
                isNews: { $ne: true },
                deletedAt: null,
            };
            if (query.cursor) {
                mongoQuery.createdAt = { $lt: query.cursor };
            }

            const directPosts = await Post.find(mongoQuery)
                .sort({ createdAt: -1 })
                .limit(MAX_RESULTS)
                .lean();

            this.recordStageDetail(query, {
                ...this.buildStageDetail('mongo_direct_following_fallback', timelineRead.summary),
                fallbackReason: timelineRead.summary.fallbackReason || 'redis_and_cache_empty',
                directFallbackOutputCount: directPosts.length,
            });
            return directPosts.map((post: any) => ({
                ...createFeedCandidate(post),
                inNetwork: true,
            }));
        }

        this.recordStageDetail(query, {
            ...this.buildStageDetail('empty_after_timeline_and_fallbacks', timelineRead.summary),
            fallbackReason: timelineRead.summary.fallbackReason || 'all_in_network_sources_empty',
        });
        return [];
    }

    stageDetail(query: FeedQuery): Record<string, unknown> | undefined {
        const key = this.stageDetailKey(query);
        const detail = this.stageDetails.get(key);
        this.stageDetails.delete(key);
        return detail;
    }

    private buildStageDetail(
        sourcePath: string,
        summary: InNetworkTimelineReadSummary
    ): Record<string, unknown> {
        return {
            thunderLikeSource: true,
            sourcePath,
            sourceCount: summary.sourceCount,
            requestedAuthorCount: summary.requestedAuthorCount,
            scannedHitCount: summary.scannedHitCount,
            dedupCount: summary.dedupCount,
            perAuthorFetch: summary.perAuthorFetch,
            fallbackReason: summary.fallbackReason,
        };
    }

    private recordStageDetail(query: FeedQuery, detail: Record<string, unknown>): void {
        this.stageDetails.set(this.stageDetailKey(query), detail);
    }

    private stageDetailKey(query: FeedQuery): string {
        return query.requestId;
    }
}
