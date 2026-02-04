/**
 * WeightedScorer - 加权综合评分器
 * 像素级复刻 x-algorithm home-mixer/scorers/weighted_scorer.rs
 * 将多个行为概率加权组合成最终分数
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

/**
 * 评分权重配置
 * 复刻 weighted_scorer.rs 的 params
 */
const WEIGHTS = {
    // 正向互动权重
    FAVORITE_WEIGHT: 2.0,      // 点赞
    REPLY_WEIGHT: 5.0,         // 回复 (高权重，因为回复是强信号)
    RETWEET_WEIGHT: 4.0,       // 转发
    CLICK_WEIGHT: 0.5,         // 点击 (低权重，容易发生)
    PROFILE_CLICK_WEIGHT: 1.0, // 查看作者主页
    VIDEO_QUALITY_VIEW_WEIGHT: 3.0, // 高质量视频观看
    SHARE_WEIGHT: 2.5,         // 分享
    DWELL_WEIGHT: 0.3,         // 停留时间
    QUOTE_WEIGHT: 4.5,         // 引用转发

    // 负向权重
    DISMISS_WEIGHT: -5.0,      // 不感兴趣
    BLOCK_WEIGHT: -10.0,       // 拉黑

    // 网络外内容降权因子 (复刻 OON_WEIGHT_FACTOR)
    OON_WEIGHT_FACTOR: 0.7,
};

/**
 * 分数归一化参数
 */
const NORMALIZATION = {
    OFFSET: 0.1,    // 分数偏移
    SCALE: 1.0,     // 分数缩放
};

export class WeightedScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'WeightedScorer';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async score(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        return candidates.map((candidate) => {
            const weightedScore = this.computeWeightedScore(candidate);
            const normalizedScore = this.normalizeScore(weightedScore);

            return {
                candidate: {
                    ...candidate,
                    weightedScore,
                    score: normalizedScore,
                },
                score: normalizedScore,
                scoreBreakdown: {
                    weightedScore,
                    normalizedScore,
                },
            };
        });
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            weightedScore: scored.candidate.weightedScore,
            score: scored.score,
        };
    }

    /**
     * 计算加权分数
     * 复刻 WeightedScorer::compute_weighted_score()
     */
    private computeWeightedScore(candidate: FeedCandidate): number {
        const s = candidate.phoenixScores || {};

        // 正向互动分数
        let combinedScore =
            this.apply(s.likeScore, WEIGHTS.FAVORITE_WEIGHT) +
            this.apply(s.replyScore, WEIGHTS.REPLY_WEIGHT) +
            this.apply(s.repostScore, WEIGHTS.RETWEET_WEIGHT) +
            this.apply(s.clickScore, WEIGHTS.CLICK_WEIGHT) +
            this.apply(s.profileClickScore, WEIGHTS.PROFILE_CLICK_WEIGHT) +
            this.apply(s.videoQualityViewScore, WEIGHTS.VIDEO_QUALITY_VIEW_WEIGHT) +
            this.apply(s.shareScore, WEIGHTS.SHARE_WEIGHT) +
            this.apply(s.dwellScore, WEIGHTS.DWELL_WEIGHT);

        // 负向行为惩罚 (复刻 negative action penalties)
        combinedScore +=
            this.apply(s.dismissScore, WEIGHTS.DISMISS_WEIGHT) +
            this.apply(s.blockScore, WEIGHTS.BLOCK_WEIGHT);

        // 网络外内容降权 (复刻 OONScorer)
        if (candidate.inNetwork === false) {
            combinedScore *= WEIGHTS.OON_WEIGHT_FACTOR;
        }

        // 确保分数不为负
        return Math.max(0, combinedScore);
    }

    /**
     * 应用权重
     * 复刻 WeightedScorer::apply()
     */
    private apply(score: number | undefined, weight: number): number {
        return (score || 0) * weight;
    }

    /**
     * 归一化分数
     */
    private normalizeScore(score: number): number {
        return (score + NORMALIZATION.OFFSET) * NORMALIZATION.SCALE;
    }
}
