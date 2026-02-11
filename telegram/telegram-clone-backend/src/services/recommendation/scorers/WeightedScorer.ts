/**
 * WeightedScorer - 加权综合评分器
 * 像素级复刻 x-algorithm home-mixer/scorers/weighted_scorer.rs
 * 将多个行为概率加权组合成 weightedScore（不直接写最终 score）
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
    QUOTE_WEIGHT: 4.5,         // 引用转发
    PHOTO_EXPAND_WEIGHT: 1.0,  // 展开图片
    CLICK_WEIGHT: 0.5,         // 点击 (低权重，容易发生)
    QUOTED_CLICK_WEIGHT: 0.8,  // 点击被引用的内容
    PROFILE_CLICK_WEIGHT: 1.0, // 查看作者主页
    VIDEO_QUALITY_VIEW_WEIGHT: 3.0, // 高质量视频观看
    SHARE_WEIGHT: 2.5,         // 分享
    SHARE_VIA_DM_WEIGHT: 2.0,  // 通过私信分享
    SHARE_VIA_COPY_LINK_WEIGHT: 1.5, // 复制链接分享
    DWELL_WEIGHT: 0.3,         // 停留时间
    CONT_DWELL_TIME_WEIGHT: 0.05, // 连续停留时长（continuous）
    FOLLOW_AUTHOR_WEIGHT: 2.0, // 关注作者

    // 负向权重
    NOT_INTERESTED_WEIGHT: -5.0, // 不感兴趣
    BLOCK_AUTHOR_WEIGHT: -10.0,  // 拉黑作者
    MUTE_AUTHOR_WEIGHT: -4.0,    // 静音作者
    REPORT_WEIGHT: -8.0,         // 举报

    // 注意：OON 降权在 OONScorer 中执行（对齐 x-algorithm）
};

// Align with x-algorithm: only apply VQV weight if the video is "long enough".
const MIN_VIDEO_DURATION_SEC = 5;

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
            const rawWeightedScore = this.computeWeightedScore(candidate);
            const normalizedWeightedScore = this.normalizeScore(rawWeightedScore);

            return {
                candidate: {
                    ...candidate,
                    // Align with x-algorithm: store the normalized weighted score.
                    weightedScore: normalizedWeightedScore,
                },
                // Pipeline 内部排序用 wrapper score；最终可见分数由 AuthorDiversityScorer -> OONScorer 写入 candidate.score
                score: normalizedWeightedScore,
                scoreBreakdown: {
                    rawWeightedScore,
                    normalizedWeightedScore,
                },
            };
        });
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            weightedScore: scored.candidate.weightedScore,
        };
    }

    /**
     * 计算加权分数
     * 复刻 WeightedScorer::compute_weighted_score()
     */
    private computeWeightedScore(candidate: FeedCandidate): number {
        const s = candidate.phoenixScores || {};

        const vqvWeight =
            typeof candidate.videoDurationSec === 'number' && candidate.videoDurationSec > MIN_VIDEO_DURATION_SEC
                ? WEIGHTS.VIDEO_QUALITY_VIEW_WEIGHT
                : 0.0;

        // Support both x-algorithm naming and legacy field names from our ML service.
        const notInterestedScore = s.notInterestedScore ?? s.dismissScore;
        const blockAuthorScore = s.blockAuthorScore ?? s.blockScore;

        // 正向互动分数
        let combinedScore =
            this.apply(s.likeScore, WEIGHTS.FAVORITE_WEIGHT) +
            this.apply(s.replyScore, WEIGHTS.REPLY_WEIGHT) +
            this.apply(s.repostScore, WEIGHTS.RETWEET_WEIGHT) +
            this.apply(s.quoteScore, WEIGHTS.QUOTE_WEIGHT) +
            this.apply(s.photoExpandScore, WEIGHTS.PHOTO_EXPAND_WEIGHT) +
            this.apply(s.clickScore, WEIGHTS.CLICK_WEIGHT) +
            this.apply(s.quotedClickScore, WEIGHTS.QUOTED_CLICK_WEIGHT) +
            this.apply(s.profileClickScore, WEIGHTS.PROFILE_CLICK_WEIGHT) +
            this.apply(s.videoQualityViewScore, vqvWeight) +
            this.apply(s.shareScore, WEIGHTS.SHARE_WEIGHT) +
            this.apply(s.shareViaDmScore, WEIGHTS.SHARE_VIA_DM_WEIGHT) +
            this.apply(s.shareViaCopyLinkScore, WEIGHTS.SHARE_VIA_COPY_LINK_WEIGHT) +
            this.apply(s.dwellScore, WEIGHTS.DWELL_WEIGHT);
        combinedScore +=
            this.apply(s.dwellTime, WEIGHTS.CONT_DWELL_TIME_WEIGHT) +
            this.apply(s.followAuthorScore, WEIGHTS.FOLLOW_AUTHOR_WEIGHT);

        // 负向行为惩罚 (复刻 negative action penalties)
        combinedScore +=
            this.apply(notInterestedScore, WEIGHTS.NOT_INTERESTED_WEIGHT) +
            this.apply(blockAuthorScore, WEIGHTS.BLOCK_AUTHOR_WEIGHT) +
            this.apply(s.muteAuthorScore, WEIGHTS.MUTE_AUTHOR_WEIGHT) +
            this.apply(s.reportScore, WEIGHTS.REPORT_WEIGHT);

        return combinedScore;
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
        // Important: apply offset BEFORE clamp so negative actions can penalize the final value.
        return Math.max(0, (score + NORMALIZATION.OFFSET) * NORMALIZATION.SCALE);
    }
}
