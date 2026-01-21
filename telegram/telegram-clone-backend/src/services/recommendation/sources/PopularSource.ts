/**
 * PopularSource - 热门内容源
 * 复刻 x-algorithm phoenix_source.rs
 * 获取全站热门帖子 (Out-of-Network 内容)
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';

/**
 * 配置参数
 */
const MAX_RESULTS = 100; // 复刻 PHOENIX_MAX_RESULTS
const MIN_ENGAGEMENT = 5; // 最小互动数阈值

export class PopularSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'PopularSource';

    enable(query: FeedQuery): boolean {
        // 仅当不是 inNetworkOnly 模式时启用
        return !query.inNetworkOnly;
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        // 获取最近 7 天内的热门帖子
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // 排除用户关注的人 (避免与 FollowingSource 重复)
        const excludeAuthors = query.userFeatures?.followedUserIds || [];
        // 排除用户自己
        excludeAuthors.push(query.userId);

        const mongoQuery: Record<string, unknown> = {
            authorId: { $nin: excludeAuthors },
            createdAt: { $gte: sevenDaysAgo },
            deletedAt: null,
            // 只获取有一定互动量的帖子
            $expr: {
                $gte: [
                    {
                        $add: [
                            '$stats.likeCount',
                            { $multiply: ['$stats.commentCount', 2] },
                            { $multiply: ['$stats.repostCount', 3] },
                        ],
                    },
                    MIN_ENGAGEMENT,
                ],
            },
        };

        // 分页支持
        if (query.cursor) {
            mongoQuery.createdAt = {
                $gte: sevenDaysAgo,
                $lt: query.cursor,
            };
        }

        // 按 engagementScore 排序获取热门内容
        const posts = await Post.find(mongoQuery)
            .sort({ engagementScore: -1, createdAt: -1 })
            .limit(MAX_RESULTS)
            .lean();

        // 转换为候选者并标记为 out-of-network
        return posts.map((post) => ({
            ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: false,
        }));
    }
}
