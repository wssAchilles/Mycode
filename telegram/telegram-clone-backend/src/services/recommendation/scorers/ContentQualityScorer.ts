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

export class ContentQualityScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'ContentQualityScorer';

    enable(_query: FeedQuery): boolean {
        return getSpaceFeedExperimentFlag(_query, 'enable_content_quality_scorer', false);
    }

    async score(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        return candidates.map((candidate) => {
            const qualityScore = this.computeQualityScore(candidate);
            const current = candidate.weightedScore ?? 0;

            // 质量分数作为乘数调整
            const adjusted = current * (0.8 + qualityScore * 0.4);

            return {
                candidate: {
                    ...candidate,
                    weightedScore: adjusted,
                },
                score: adjusted,
                scoreBreakdown: {
                    contentQuality: qualityScore,
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
    private computeQualityScore(candidate: FeedCandidate): number {
        let score = 0;

        // 1. 内容长度评分
        const contentLength = candidate.content?.length || 0;
        const lengthScore = this.computeLengthScore(contentLength);
        score += lengthScore * PARAMS.CONTENT_WEIGHT;

        // 2. 媒体评分
        let mediaScore = 0;
        if (candidate.hasImage) mediaScore += PARAMS.IMAGE_BONUS;
        if (candidate.hasVideo) mediaScore += PARAMS.VIDEO_BONUS;
        score += Math.min(mediaScore, 0.2) * PARAMS.MEDIA_WEIGHT / 0.2;

        // 3. 互动率评分
        const engagementRatio = this.computeEngagementRatio(candidate);
        const engagementScore = Math.min(engagementRatio / PARAMS.HIGH_ENGAGEMENT_RATIO, 1);
        score += engagementScore * PARAMS.ENGAGEMENT_RATIO_WEIGHT;

        return Math.min(score, 1);
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
}
