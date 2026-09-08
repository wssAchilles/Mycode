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
    FOLLOW_AUTHOR_WEIGHT: 2.4, // 关注作者

    // 负向权重
    NOT_INTERESTED_WEIGHT: 5.0, // 不感兴趣
    BLOCK_AUTHOR_WEIGHT: 10.0,  // 拉黑作者
    MUTE_AUTHOR_WEIGHT: 4.0,    // 静音作者
    REPORT_WEIGHT: 8.0,         // 举报
    ACTION_SCORE_NEGATIVE_WEIGHT: 12.0,

    // 注意：OON 降权在 OONScorer 中执行（对齐 x-algorithm）
};

// Align with x-algorithm: only apply VQV weight if the video is "long enough".
const MIN_VIDEO_DURATION_SEC = 5;

/**
 * 分数归一化参数
 */
const POSITIVE_WEIGHT_SUM = 30.55;
const NEGATIVE_WEIGHT_SUM = 27.0;
const NEGATIVE_SCORES_OFFSET = 0.1;

type WeightedScoreInputMode = 'phoenix' | 'action' | 'heuristic' | 'node_legacy_fallback';

interface WeightedScoreSummary {
    inputMode: WeightedScoreInputMode;
    baseRawScore: number;
    positiveScore: number;
    negativeScore: number;
    evidenceScore: number;
    rawScore: number;
    normalizedWeightedScore: number;
}

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
            const summary = this.summarize(candidate);
            const evidencePrior = this.computeRetrievalEvidencePrior(candidate);

            return {
                candidate: {
                    ...candidate,
                    // Align with x-algorithm: store the normalized weighted score.
                    weightedScore: summary.normalizedWeightedScore,
                },
                // Pipeline 内部排序用 wrapper score；最终可见分数由 AuthorDiversityScorer -> OONScorer 写入 candidate.score
                score: summary.normalizedWeightedScore,
                scoreBreakdown: {
                    weightedRawScore: summary.rawScore,
                    weightedBaseRawScore: summary.baseRawScore,
                    weightedEvidencePrior: evidencePrior,
                    weightedEvidenceLift: summary.evidenceScore,
                    normalizedWeightedScore: summary.normalizedWeightedScore,
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

    summarize(candidate: Partial<FeedCandidate>): WeightedScoreSummary {
        const { inputMode, positiveScore, negativeScore } = this.computeInputScores(candidate);
        if (inputMode === 'node_legacy_fallback') {
            return this.summary(inputMode, 0, 0, 0, 0);
        }

        const baseRawScore = positiveScore - negativeScore;
        const finiteBaseRawScore = this.finite(baseRawScore);
        const evidenceScore = finiteBaseRawScore > 0
            ? this.computeRetrievalEvidencePrior(candidate) * 0.12
                + this.computeSignalPrior(candidate) * 0.1
            : 0;
        return this.summary(
            inputMode,
            positiveScore,
            negativeScore,
            finiteBaseRawScore,
            evidenceScore,
        );
    }

    private computeInputScores(candidate: Partial<FeedCandidate>): {
        inputMode: WeightedScoreInputMode;
        positiveScore: number;
        negativeScore: number;
    } {
        if (candidate.phoenixScores !== undefined) {
            const scores = candidate.phoenixScores;
            const videoQualityView = candidate.videoDurationSec !== undefined
                && candidate.videoDurationSec > MIN_VIDEO_DURATION_SEC
                ? scores.videoQualityViewScore
                : 0;
            return {
                inputMode: 'phoenix',
                positiveScore:
                    this.apply(scores.likeScore, WEIGHTS.FAVORITE_WEIGHT) +
                    this.apply(scores.replyScore, WEIGHTS.REPLY_WEIGHT) +
                    this.apply(scores.repostScore, WEIGHTS.RETWEET_WEIGHT) +
                    this.apply(scores.quoteScore, WEIGHTS.QUOTE_WEIGHT) +
                    this.apply(scores.photoExpandScore, WEIGHTS.PHOTO_EXPAND_WEIGHT) +
                    this.apply(scores.clickScore, WEIGHTS.CLICK_WEIGHT) +
                    this.apply(scores.quotedClickScore, WEIGHTS.QUOTED_CLICK_WEIGHT) +
                    this.apply(scores.profileClickScore, WEIGHTS.PROFILE_CLICK_WEIGHT) +
                    this.apply(videoQualityView, WEIGHTS.VIDEO_QUALITY_VIEW_WEIGHT) +
                    this.apply(scores.shareScore, WEIGHTS.SHARE_WEIGHT) +
                    this.apply(scores.shareViaDmScore, WEIGHTS.SHARE_VIA_DM_WEIGHT) +
                    this.apply(scores.shareViaCopyLinkScore, WEIGHTS.SHARE_VIA_COPY_LINK_WEIGHT) +
                    this.apply(scores.dwellScore, WEIGHTS.DWELL_WEIGHT) +
                    this.apply(scores.dwellTime, WEIGHTS.CONT_DWELL_TIME_WEIGHT) +
                    this.apply(scores.followAuthorScore, WEIGHTS.FOLLOW_AUTHOR_WEIGHT),
                negativeScore:
                    this.apply(scores.notInterestedScore, WEIGHTS.NOT_INTERESTED_WEIGHT) +
                    this.apply(scores.dismissScore, WEIGHTS.NOT_INTERESTED_WEIGHT) +
                    this.apply(scores.blockAuthorScore, WEIGHTS.BLOCK_AUTHOR_WEIGHT) +
                    this.apply(scores.blockScore, WEIGHTS.BLOCK_AUTHOR_WEIGHT) +
                    this.apply(scores.muteAuthorScore, WEIGHTS.MUTE_AUTHOR_WEIGHT) +
                    this.apply(scores.reportScore, WEIGHTS.REPORT_WEIGHT),
            };
        }

        if (candidate.actionScores !== undefined) {
            const scores = candidate.actionScores;
            return {
                inputMode: 'action',
                positiveScore:
                    this.apply(scores.like, WEIGHTS.FAVORITE_WEIGHT) +
                    this.apply(scores.reply, WEIGHTS.REPLY_WEIGHT) +
                    this.apply(scores.repost, WEIGHTS.RETWEET_WEIGHT) +
                    this.apply(scores.click, WEIGHTS.CLICK_WEIGHT) +
                    this.apply(scores.dwell, WEIGHTS.DWELL_WEIGHT),
                negativeScore: this.apply(scores.negative, WEIGHTS.ACTION_SCORE_NEGATIVE_WEIGHT),
            };
        }

        if (typeof candidate.content !== 'string') {
            return { inputMode: 'node_legacy_fallback', positiveScore: 0, negativeScore: 0 };
        }

        const engagements = this.finite(candidate.likeCount)
            + this.finite(candidate.commentCount) * 2
            + this.finite(candidate.repostCount) * 3;
        const views = Math.max(this.finite(candidate.viewCount), 1);
        const breakdown = candidate._scoreBreakdown ?? {};
        const heuristic = {
            engagementRate: this.clamp01((engagements / views) / 0.12),
            replyProxy: this.clamp01(this.finite(candidate.commentCount) / 8),
            repostProxy: this.clamp01(this.finite(candidate.repostCount) / 6),
            clickProxy: candidate.hasImage === true || candidate.hasVideo === true ? 0.18 : 0.08,
            contentProxy: this.clamp01(Array.from(candidate.content).length / 280),
            followProxy: this.clamp01(Math.max(this.finite(candidate.authorAffinityScore), 0)),
            retrievalSupport:
                this.finite(breakdown.retrievalAuthorPrior) * 0.45 +
                this.finite(breakdown.retrievalDenseVectorScore) * 0.3 +
                this.finite(breakdown.retrievalCandidateClusterScore) * 0.25,
        };
        return {
            inputMode: 'heuristic',
            positiveScore:
                heuristic.engagementRate * 3.1 +
                heuristic.replyProxy * 3.8 +
                heuristic.repostProxy * 3.3 +
                heuristic.clickProxy * 1.2 +
                heuristic.contentProxy * 0.9 +
                heuristic.followProxy * 2.2 +
                heuristic.retrievalSupport * 1.7,
            negativeScore: 0,
        };
    }

    /**
     * 应用权重
     * 复刻 WeightedScorer::apply()
     */
    private apply(score: number | undefined, weight: number): number {
        return this.finite(score) * weight;
    }

    private computeRetrievalEvidencePrior(candidate: Partial<FeedCandidate>): number {
        const breakdown = candidate._scoreBreakdown ?? {};
        const secondarySourceCount = this.finite(breakdown.retrievalSecondarySourceCount);
        const crossLaneSourceCount = this.finite(breakdown.retrievalCrossLaneSourceCount);
        const evidenceConfidence = this.finite(breakdown.retrievalEvidenceConfidence);
        const multiSourceBonus = this.finite(breakdown.retrievalMultiSourceBonus);
        const recallConfidence = this.finite(candidate.recallEvidence?.confidence);
        const recallSourceCount = this.finite(candidate.recallEvidence?.sourceCount);
        const raw =
            secondarySourceCount * 0.16 +
            crossLaneSourceCount * 0.22 +
            evidenceConfidence * 0.28 +
            multiSourceBonus * 1.1 +
            recallConfidence * 0.18 +
            Math.max(recallSourceCount - 1, 0) * 0.08;
        return this.clamp01(raw);
    }

    private computeSignalPrior(candidate: Partial<FeedCandidate>): number {
        const signals = candidate.rankingSignals;
        if (signals === undefined) return 0;

        const breakdown = candidate._scoreBreakdown ?? {};
        const temporalInterest = Math.max(
            this.finite(breakdown.rankingShortInterest),
            this.finite(breakdown.rankingStableInterest),
        );
        const negative = Math.max(
            this.finite(signals.negativeFeedback),
            this.finite(breakdown.actionNegative),
        );
        return this.clamp01(
            this.finite(signals.relevance) * 0.32 +
            this.finite(signals.quality) * 0.18 +
            this.finite(signals.sourceEvidence) * 0.18 +
            this.finite(breakdown.rankingSourceQuality) * 0.12 +
            this.finite(breakdown.rankingTrendHeat) * 0.1 +
            temporalInterest * 0.1 -
            negative * 0.42,
        );
    }

    private summary(
        inputMode: WeightedScoreInputMode,
        positiveScore: number,
        negativeScore: number,
        baseRawScore: number,
        evidenceScore: number,
    ): WeightedScoreSummary {
        positiveScore = this.finite(positiveScore);
        negativeScore = this.finite(negativeScore);
        baseRawScore = this.finite(baseRawScore);
        evidenceScore = this.finite(evidenceScore);
        const rawScore = this.finite(baseRawScore + evidenceScore);
        return {
            inputMode,
            baseRawScore,
            positiveScore,
            negativeScore,
            evidenceScore,
            rawScore,
            normalizedWeightedScore: this.normalizeScore(rawScore),
        };
    }

    private normalizeScore(score: number): number {
        score = this.finite(score);
        return score < 0
            ? Math.max(0, ((score + NEGATIVE_WEIGHT_SUM) / POSITIVE_WEIGHT_SUM) * NEGATIVE_SCORES_OFFSET)
            : score / POSITIVE_WEIGHT_SUM + NEGATIVE_SCORES_OFFSET;
    }

    private clamp01(value: number): number {
        return Math.max(0, Math.min(1, this.finite(value)));
    }

    private finite(value: number | undefined): number {
        return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
}
