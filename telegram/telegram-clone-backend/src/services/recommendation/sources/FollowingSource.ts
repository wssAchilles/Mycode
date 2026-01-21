/**
 * FollowingSource - 关注网络内容源
 * 复刻 x-algorithm thunder_source.rs
 * 获取用户关注的人发布的帖子
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';

/**
 * 配置参数
 */
const MAX_RESULTS = 200; // 复刻 THUNDER_MAX_RESULTS

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

        // 查询关注用户的最新帖子
        const mongoQuery: Record<string, unknown> = {
            authorId: { $in: followedUserIds },
            deletedAt: null,
        };

        // 分页支持
        if (query.cursor) {
            mongoQuery.createdAt = { $lt: query.cursor };
        }

        const posts = await Post.find(mongoQuery)
            .sort({ createdAt: -1 })
            .limit(MAX_RESULTS)
            .lean();

        // 转换为候选者并标记为 inNetwork
        return posts.map((post) => ({
            ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: true,
        }));
    }
}
