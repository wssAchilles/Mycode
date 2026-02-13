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
import { InNetworkTimelineService } from '../InNetworkTimelineService';

/**
 * 配置参数
 */
const MAX_RESULTS = 200; // 复刻 THUNDER_MAX_RESULTS
const MAX_AGE_DAYS = 7;  // 最大帖子年龄 (与 AgeFilter 保持一致)

// Industrial guard: avoid Mongo fan-out when Redis timelines are empty/unavailable.
// For large follow graphs, falling back to Mongo can explode query cost and p95.
const MONGO_FALLBACK_ENABLED =
    String(process.env.FOLLOWING_SOURCE_MONGO_FALLBACK_ENABLED ?? 'true').toLowerCase() === 'true';
const MONGO_FALLBACK_MAX_FOLLOWED =
    parseInt(String(process.env.FOLLOWING_SOURCE_MONGO_FALLBACK_MAX_FOLLOWED ?? '200'), 10) || 200;

export class FollowingSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'FollowingSource';

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
            return [];
        }

        // Preferred industrial path: Redis author timelines (write-light, no Mongo fan-out on reads)
        const ids = await InNetworkTimelineService.getMergedPostIdsForAuthors({
            authorIds: followedUserIds,
            cursor: query.cursor,
            maxResults: MAX_RESULTS,
        });

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
        const limited = fallbackPosts.slice(0, MAX_RESULTS);
        return limited.map((post) => ({
            ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: true,
        }));
    }
}
