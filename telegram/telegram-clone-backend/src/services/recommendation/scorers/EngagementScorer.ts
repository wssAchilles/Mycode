/**
 * EngagementScorer - 参与度评分器
 * 复刻 x-algorithm phoenix_scorer.rs 的规则引擎版本
 * 基于规则预测用户与帖子互动的概率
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, PhoenixScores } from '../types/FeedCandidate';
import { ActionType } from '../../../models/UserAction';

/**
 * 基础互动率 (用于无历史数据时的默认值)
 */
const BASE_RATES = {
    like: 0.05,
    reply: 0.01,
    repost: 0.005,
    click: 0.15,
    dismiss: 0.02,  // 不感兴趣概率
    block: 0.001,   // 拉黑概率
};

/**
 * 亲密度加成系数
 */
const AFFINITY_BOOST = {
    like: 0.3,
    reply: 0.2,
    repost: 0.15,
    click: 0.1,
};

/**
 * 热门内容加成系数
 */
const TRENDING_BOOST = {
    like: 0.15,
    reply: 0.1,
    repost: 0.1,
    click: 0.05,
};

/**
 * 负向行为风险系数
 */
const NEGATIVE_RISK = {
    lowQualityDismiss: 0.05,   // 低质量内容的不感兴趣风险
    outOfNetworkBlock: 0.005, // 网络外内容的拉黑风险
};

export class EngagementScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'EngagementScorer';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async score(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        // 获取用户的历史行为模式
        const userActionPatterns = this.analyzeUserActions(query);

        return candidates.map((candidate) => {
            const phoenixScores = this.calculatePhoenixScores(
                candidate,
                userActionPatterns,
                query
            );

            // 计算初始分数 (基于 phoenixScores 的加权和)
            // 这样即使 WeightedScorer 被禁用，后续 Scorer 也有基础分数可用
            const initialScore = this.computeInitialScore(phoenixScores);

            return {
                candidate: {
                    ...candidate,
                    phoenixScores,
                    score: initialScore,
                },
                score: initialScore,
                scoreBreakdown: {
                    likeScore: phoenixScores.likeScore || 0,
                    replyScore: phoenixScores.replyScore || 0,
                    repostScore: phoenixScores.repostScore || 0,
                    clickScore: phoenixScores.clickScore || 0,
                    dismissScore: phoenixScores.dismissScore || 0,
                    blockScore: phoenixScores.blockScore || 0,
                    initialScore,
                },
            };
        });
    }

    /**
     * 计算初始分数
     * 作为 WeightedScorer 的备用方案
     */
    private computeInitialScore(scores: PhoenixScores): number {
        const positive = 
            (scores.likeScore || 0) * 2.0 +
            (scores.replyScore || 0) * 5.0 +
            (scores.repostScore || 0) * 4.0 +
            (scores.clickScore || 0) * 0.5;
        
        const negative =
            (scores.dismissScore || 0) * 5.0 +
            (scores.blockScore || 0) * 10.0;
        
        return Math.max(0, positive - negative);
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            phoenixScores: scored.candidate.phoenixScores,
        };
    }

    /**
     * 分析用户历史行为模式
     */
    private analyzeUserActions(query: FeedQuery): Map<string, number> {
        const patterns = new Map<string, number>();
        const actions = query.userActionSequence || [];

        // 统计对每个作者的互动次数
        for (const action of actions) {
            if (action.targetAuthorId) {
                const key = `author:${action.targetAuthorId}`;
                patterns.set(key, (patterns.get(key) || 0) + 1);
            }
        }

        return patterns;
    }

    /**
     * 计算 Phoenix 风格的评分
     * 复刻 PhoenixScorer 的多行为预测（包含负向行为）
     */
    private calculatePhoenixScores(
        candidate: FeedCandidate,
        userPatterns: Map<string, number>,
        _query: FeedQuery
    ): PhoenixScores {
        // 1. 基础概率
        let likeScore = BASE_RATES.like;
        let replyScore = BASE_RATES.reply;
        let repostScore = BASE_RATES.repost;
        let clickScore = BASE_RATES.click;
        let dismissScore = BASE_RATES.dismiss;
        let blockScore = BASE_RATES.block;

        // 2. 作者亲密度加成
        const authorKey = `author:${candidate.authorId}`;
        const authorAffinity = Math.min((userPatterns.get(authorKey) || 0) / 10, 1);

        if (authorAffinity > 0) {
            likeScore += AFFINITY_BOOST.like * authorAffinity;
            replyScore += AFFINITY_BOOST.reply * authorAffinity;
            repostScore += AFFINITY_BOOST.repost * authorAffinity;
            clickScore += AFFINITY_BOOST.click * authorAffinity;
            // 高亲密度降低负向行为概率
            dismissScore *= (1 - authorAffinity * 0.8);
            blockScore *= (1 - authorAffinity * 0.9);
        }

        // 3. 热门内容加成 (基于互动数)
        const engagementCount =
            (candidate.likeCount || 0) +
            (candidate.commentCount || 0) * 2 +
            (candidate.repostCount || 0) * 3;

        const trendingFactor = Math.min(engagementCount / 100, 1);

        if (trendingFactor > 0.1) {
            likeScore += TRENDING_BOOST.like * trendingFactor;
            replyScore += TRENDING_BOOST.reply * trendingFactor;
            repostScore += TRENDING_BOOST.repost * trendingFactor;
            clickScore += TRENDING_BOOST.click * trendingFactor;
        }

        // 4. 内容类型调整
        if (candidate.hasVideo) {
            clickScore *= 1.2; // 视频点击率更高
        }
        if (candidate.hasImage) {
            likeScore *= 1.1; // 图片点赞率更高
        }

        // 5. 关注网络内加成
        if (candidate.inNetwork) {
            likeScore *= 1.5;
            replyScore *= 1.3;
            // 网络内内容降低负向行为风险
            dismissScore *= 0.5;
            blockScore *= 0.2;
        } else {
            // 网络外内容增加负向行为风险
            dismissScore += NEGATIVE_RISK.outOfNetworkBlock;
            blockScore += NEGATIVE_RISK.outOfNetworkBlock;
        }

        // 6. 内容质量影响负向行为
        const contentLength = candidate.content?.length || 0;
        if (contentLength < 10) {
            // 过短内容增加不感兴趣风险
            dismissScore += NEGATIVE_RISK.lowQualityDismiss;
        }

        // 确保概率在 [0, 1] 范围内
        return {
            likeScore: Math.min(likeScore, 1),
            replyScore: Math.min(replyScore, 1),
            repostScore: Math.min(repostScore, 1),
            clickScore: Math.min(clickScore, 1),
            dismissScore: Math.min(dismissScore, 1),
            blockScore: Math.min(blockScore, 1),
        };
    }
}
