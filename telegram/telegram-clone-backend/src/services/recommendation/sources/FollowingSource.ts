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

/**
 * 配置参数
 */
const MAX_RESULTS = 200; // 复刻 THUNDER_MAX_RESULTS
const MAX_AGE_DAYS = 7;  // 最大帖子年龄 (与 AgeFilter 保持一致)

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
        // 为不同用户共享的时间线缓存，减少 DB 压力
        const posts = await followingTimelineCache.getPostsForAuthors(
            followedUserIds,
            query.cursor
        );

        // 如果缓存为空或刷新过期，确保不超过最大结果并作为回退
        const limited = posts.slice(0, MAX_RESULTS);

        // 转换为候选者并标记为 inNetwork
        return limited.map((post) => ({
            ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: true,
        }));
    }
}
