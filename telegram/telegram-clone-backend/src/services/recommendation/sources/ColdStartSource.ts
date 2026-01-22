/**
 * ColdStartSource - 冷启动内容源
 * 复刻 x-algorithm 的冷启动策略
 * 为没有关注任何人的新用户提供内容
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';

/**
 * 配置参数
 */
const CONFIG = {
    MAX_RESULTS: 50,           // 最大返回数量
    MIN_ENGAGEMENT: 3,         // 最小互动数阈值 (比 PopularSource 低)
    MAX_AGE_DAYS: 14,          // 时间窗口 (比普通源更宽)
    DIVERSITY_LIMIT: 3,        // 每个作者最多返回几条
};

export class ColdStartSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'ColdStartSource';

    enable(query: FeedQuery): boolean {
        // 只在用户没有关注任何人时启用
        // 这是冷启动场景
        const followedCount = query.userFeatures?.followedUserIds?.length || 0;
        return followedCount === 0;
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        // 计算时间窗口 (给新用户展示更长时间范围的优质内容)
        const maxAgeCutoff = new Date();
        maxAgeCutoff.setDate(maxAgeCutoff.getDate() - CONFIG.MAX_AGE_DAYS);

        // 排除用户自己的帖子
        const excludeAuthors = [query.userId];

        const mongoQuery: Record<string, unknown> = {
            authorId: { $nin: excludeAuthors },
            createdAt: { $gte: maxAgeCutoff },
            deletedAt: null,
            isReply: false,  // 冷启动不展示回复
            // 有一定互动量的帖子
            $expr: {
                $gte: [
                    {
                        $add: [
                            '$stats.likeCount',
                            { $multiply: ['$stats.commentCount', 2] },
                            { $multiply: ['$stats.repostCount', 3] },
                        ],
                    },
                    CONFIG.MIN_ENGAGEMENT,
                ],
            },
        };

        // 分页支持
        if (query.cursor) {
            mongoQuery.createdAt = {
                $gte: maxAgeCutoff,
                $lt: query.cursor,
            };
        }

        // 获取热门内容，按互动分数排序
        const posts = await Post.find(mongoQuery)
            .sort({ engagementScore: -1, createdAt: -1 })
            .limit(CONFIG.MAX_RESULTS * 2) // 多取一些用于多样性过滤
            .lean();

        // 应用作者多样性限制
        const diversifiedPosts = this.applyAuthorDiversity(posts);

        // 转换为候选者
        return diversifiedPosts.map((post) => ({
            ...createFeedCandidate(post as unknown as Parameters<typeof createFeedCandidate>[0]),
            inNetwork: false,  // 冷启动内容都是网络外
        }));
    }

    /**
     * 应用作者多样性限制
     * 避免冷启动 Feed 被少数活跃用户主导
     */
    private applyAuthorDiversity(posts: any[]): any[] {
        const authorCounts = new Map<string, number>();
        const result: any[] = [];

        for (const post of posts) {
            const authorId = post.authorId;
            const currentCount = authorCounts.get(authorId) || 0;

            if (currentCount < CONFIG.DIVERSITY_LIMIT) {
                result.push(post);
                authorCounts.set(authorId, currentCount + 1);
            }

            // 达到目标数量后停止
            if (result.length >= CONFIG.MAX_RESULTS) {
                break;
            }
        }

        return result;
    }
}
