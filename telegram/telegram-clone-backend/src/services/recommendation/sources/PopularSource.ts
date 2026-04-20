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
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';

/**
 * 配置参数
 */
const MAX_RESULTS = 100; // 复刻 PHOENIX_MAX_RESULTS
const MIN_ENGAGEMENT = 5; // 最小互动数阈值
const FETCH_POOL_SIZE = 200; // 先取更大的池子再做相似度排序
const MAX_INTEREST_POSTS = 50; // 用于提取用户兴趣的历史帖子数
const RECALL_WINDOWS = [
    { days: 7, minEngagement: MIN_ENGAGEMENT },
    { days: 30, minEngagement: 3 },
    { days: 90, minEngagement: 1 },
    { days: 180, minEngagement: 0 },
] as const;

export class PopularSource implements Source<FeedQuery, FeedCandidate> {
    readonly name = 'PopularSource';

    enable(query: FeedQuery): boolean {
        // OON recall is part of the primary retrieval lane; experiments can still disable it.
        return !query.inNetworkOnly
            && getSpaceFeedExperimentFlag(query, 'enable_popular_source', true);
    }

    async getCandidates(query: FeedQuery): Promise<FeedCandidate[]> {
        let posts: any[] = [];
        for (const window of RECALL_WINDOWS) {
            posts = await this.findPopularPosts(query, window.days, window.minEngagement);
            if (posts.length > 0) {
                break;
            }
        }

        if (posts.length === 0) {
            return [];
        }

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
                recallSource: this.name,
            }));

        return ranked;
    }

    private async findPopularPosts(
        query: FeedQuery,
        maxAgeDays: number,
        minEngagement: number,
    ): Promise<any[]> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - maxAgeDays);
        // 排除用户关注的人 (避免与 FollowingSource 重复)
        // 注意：不要直接复用/修改 query.userFeatures.followedUserIds，避免污染后续组件逻辑
        const excludeAuthors = [
            ...(query.userFeatures?.followedUserIds ?? []),
            query.userId,
        ];

        const mongoQuery: Record<string, unknown> = {
            authorId: { $nin: excludeAuthors },
            createdAt: { $gte: cutoff },
            deletedAt: null,
            isNews: { $ne: true },
        };

        if (minEngagement > 0) {
            mongoQuery.$expr = {
                $gte: [
                    this.engagementExpression(),
                    minEngagement,
                ],
            };
        }

        // 分页支持
        if (query.cursor) {
            mongoQuery.createdAt = {
                $gte: cutoff,
                $lt: query.cursor,
            };
        }

        // 按 engagementScore 排序获取热门内容
        return Post.find(mongoQuery)
            .sort({ engagementScore: -1, createdAt: -1 })
            .limit(FETCH_POOL_SIZE)
            .lean();
    }

    private engagementExpression(): Record<string, unknown> {
        return {
            $add: [
                { $ifNull: ['$stats.likeCount', 0] },
                { $multiply: [{ $ifNull: ['$stats.commentCount', 0] }, 2] },
                { $multiply: [{ $ifNull: ['$stats.repostCount', 0] }, 3] },
            ],
        };
    }

    /**
     * 构建用户兴趣关键词权重，从最近的用户行为涉及的帖子中提取 keywords
     */
    private async buildUserInterestKeywords(query: FeedQuery): Promise<Map<string, number>> {
        const weights = new Map<string, number>();
        const actions = query.userActionSequence || [];
        const postIds = actions
            .map((a) => a.targetPostId)
            .filter((id): id is NonNullable<typeof id> => Boolean(id))
            .slice(0, MAX_INTEREST_POSTS)
            .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
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
