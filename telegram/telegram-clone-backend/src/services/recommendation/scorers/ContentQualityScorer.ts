/**
 * ContentQualityScorer - 内容质量评分器
 * 复刻 x-algorithm 的内容质量评估
 * 评估帖子内容的质量 (长度、媒体、互动比等)
 *
 * 语义（工业化对齐）：
 * - 仅在实验桶开启（默认关闭）
 * - 调整 candidate.weightedScore（不直接写 candidate.score）
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';

/**
 * 质量参数
 */
const PARAMS = {
    // 内容长度评分
    MIN_CONTENT_LENGTH: 10,
    OPTIMAL_CONTENT_LENGTH: 280,
    MAX_CONTENT_LENGTH: 1000,

    // 权重
    CONTENT_WEIGHT: 0.3,
    MEDIA_WEIGHT: 0.2,
    ENGAGEMENT_RATIO_WEIGHT: 0.5,

    // 媒体加成
    IMAGE_BONUS: 0.1,
    VIDEO_BONUS: 0.15,

    // 互动比阈值
    HIGH_ENGAGEMENT_RATIO: 0.1, // 10% 互动率算高
};

type ContentQualitySummary = {
    score: number;
    qualityPrior: number;
    engagementPrior: number;
    lowQualityPenalty: number;
};

export class ContentQualityScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'ContentQualityScorer';

    enable(_query: FeedQuery): boolean {
        return getSpaceFeedExperimentFlag(_query, 'enable_content_quality_scorer', true);
    }

    async score(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        return candidates.map((candidate) => {
            const quality = this.computeQualityScore(candidate);
            const current = candidate.weightedScore ?? 0;

            const adjusted = current
                * (0.82 + quality.score * 0.36)
                * (1 - quality.lowQualityPenalty * 0.18);

            return {
                candidate: {
                    ...candidate,
                    weightedScore: adjusted,
                },
                score: adjusted,
                scoreBreakdown: {
                    contentQuality: quality.score,
                    contentQualityPrior: quality.qualityPrior,
                    contentEngagementPrior: quality.engagementPrior,
                    contentLowQualityPenalty: quality.lowQualityPenalty,
                },
            };
        });
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            weightedScore: scored.candidate.weightedScore ?? candidate.weightedScore,
        };
    }

    /**
     * 计算内容质量分数 [0, 1]
     */
    private computeQualityScore(candidate: FeedCandidate): ContentQualitySummary {
        const contentLength = candidate.content?.length || 0;
        const lengthScore = this.computeLengthScore(contentLength);

        let mediaScore = 0;
        if (candidate.hasImage) mediaScore += PARAMS.IMAGE_BONUS;
        if (candidate.hasVideo) mediaScore += PARAMS.VIDEO_BONUS;
        const mediaPrior = Math.min(mediaScore, 0.2) / 0.2;
        const structurePrior = candidate.isReply ? 0.86 : candidate.isRepost ? 0.78 : 1;
        const qualityPrior = clamp01(
            lengthScore * 0.58 + mediaPrior * 0.22 + structurePrior * 0.2,
        );

        const engagementRatio = this.computeEngagementRatio(candidate);
        const engagementPrior = clamp01(engagementRatio / 0.12);
        const lowQualityPenalty = this.computeLowQualityPenalty(
            candidate,
            contentLength,
            qualityPrior,
            engagementPrior,
        );
        const score = clamp01(
            qualityPrior * 0.66
            + engagementPrior * 0.24
            + Math.min(Math.max(candidate.authorAffinityScore || 0, 0), 0.2) * 0.1
            - lowQualityPenalty * 0.18,
        );

        return {
            score,
            qualityPrior,
            engagementPrior,
            lowQualityPenalty,
        };
    }

    /**
     * 计算内容长度分数
     */
    private computeLengthScore(length: number): number {
        if (length < PARAMS.MIN_CONTENT_LENGTH) {
            return 0.3; // 过短
        }
        if (length <= PARAMS.OPTIMAL_CONTENT_LENGTH) {
            return 0.8 + (length / PARAMS.OPTIMAL_CONTENT_LENGTH) * 0.2;
        }
        if (length <= PARAMS.MAX_CONTENT_LENGTH) {
            // 超过最优长度，稍微降分
            return 0.9;
        }
        return 0.7; // 过长
    }

    /**
     * 计算互动率
     */
    private computeEngagementRatio(candidate: FeedCandidate): number {
        const views = candidate.viewCount || 1;
        const engagements =
            (candidate.likeCount || 0) +
            (candidate.commentCount || 0) * 2 +
            (candidate.repostCount || 0) * 3;

        return engagements / views;
    }

    private computeLowQualityPenalty(
        candidate: FeedCandidate,
        contentLength: number,
        qualityPrior: number,
        engagementPrior: number,
    ): number {
        const engagements =
            (candidate.likeCount || 0) +
            (candidate.commentCount || 0) * 2 +
            (candidate.repostCount || 0) * 3;
        const shortContentPenalty = contentLength < 8 ? 0.34 : 0;
        const emptyMediaPenalty = !candidate.hasImage && !candidate.hasVideo && contentLength < 28 ? 0.18 : 0;
        const staleLowSignalPenalty =
            engagements < 2 && engagementPrior < 0.04 && qualityPrior < 0.58 ? 0.22 : 0;
        const repostPenalty = candidate.isRepost && contentLength < 24 ? 0.12 : 0;
        return clamp01(shortContentPenalty + emptyMediaPenalty + staleLowSignalPenalty + repostPenalty);
    }
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}
