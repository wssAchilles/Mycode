/**
 * PopularSource - 热门内容源
 * 复刻 x-algorithm phoenix_source.rs
 * 获取全站热门帖子 (Out-of-Network 内容)
 */

import { Source } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, createFeedCandidate } from '../types/FeedCandidate';
import Post from '../../../models/Post';
import mongoose from 'mongoose';

/**
 * 配置参数
 */
const MAX_RESULTS = 100; // 复刻 PHOENIX_MAX_RESULTS
const MIN_ENGAGEMENT = 5; // 最小互动数阈值
const FETCH_POOL_SIZE = 200; // 先取更大的池子再做相似度排序
const MAX_INTEREST_POSTS = 50; // 用于提取用户兴趣的历史帖子数

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
            .limit(FETCH_POOL_SIZE)
            .lean();

        // 根据用户兴趣关键词做轻量相似度排序
        const interestWeights = await this.buildUserInterestKeywords(query);

        const ranked = posts
            .map((post) => {
                const similarity = this.computeSimilarity(
                    interestWeights,
                    (post.keywords as string[]) || []
                );
                const engagement = this.computeEngagementScore(post);
                const combined = similarity * 0.7 + engagement * 0.3;
                return { post, similarity, engagement, combined };
            })
            .sort((a, b) => b.combined - a.combined)
            .slice(0, MAX_RESULTS)
            .map((item) => ({
                ...createFeedCandidate(item.post as unknown as Parameters<typeof createFeedCandidate>[0]),
                inNetwork: false,
            }));

        return ranked;
    }

    /**
     * 构建用户兴趣关键词权重，从最近的用户行为涉及的帖子中提取 keywords
     */
    private async buildUserInterestKeywords(query: FeedQuery): Promise<Map<string, number>> {
        const weights = new Map<string, number>();
        const actions = query.userActionSequence || [];
        const postIds = actions
            .map((a) => a.targetPostId)
            .filter(Boolean)
            .slice(0, MAX_INTEREST_POSTS)
            .map((id) => new mongoose.Types.ObjectId(id as unknown as string));

        if (postIds.length === 0) return weights;

        const posts = await Post.find({ _id: { $in: postIds }, deletedAt: null })
            .select('keywords stats')
            .lean();

        for (const post of posts) {
            const kws = (post.keywords as string[]) || [];
            for (const kw of kws) {
                const current = weights.get(kw) || 0;
                weights.set(kw, current + 1);
            }
        }
        return weights;
    }

    /**
     * 计算关键词重叠相似度（简单加权交集）
     */
    private computeSimilarity(
        interest: Map<string, number>,
        candidateKeywords: string[]
    ): number {
        if (interest.size === 0 || candidateKeywords.length === 0) return 0;

        let score = 0;
        let interestNorm = 0;
        for (const val of interest.values()) {
            interestNorm += val;
        }
        for (const kw of candidateKeywords) {
            if (interest.has(kw)) {
                score += interest.get(kw) || 0;
            }
        }
        return score / Math.max(interestNorm, 1);
    }

    /**
     * 基于互动数的轻量 engagement 评分，归一到 [0,1] 近似
     */
    private computeEngagementScore(post: any): number {
        const stats = post.stats || {};
        const engagements =
            (stats.likeCount || 0) +
            (stats.commentCount || 0) * 2 +
            (stats.repostCount || 0) * 3;
        // 假设 100 为高值，做简单归一
        return Math.min(engagements / 100, 1);
    }
}
