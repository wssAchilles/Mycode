/**
 * EngagementScorer - 参与度评分器
 * 兼容期 provider scorer。
 *
 * PhoenixScorer 是 phoenixScores 的主语义来源；本 scorer 只在上游 Phoenix
 * 没有返回完整动作向量时补齐缺失字段，避免 Node 端继续维护第二套复杂评分规则。
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate, PhoenixScores } from '../types/FeedCandidate';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';

/**
 * 基础互动率 (用于无历史数据时的默认值)
 */
const BASE_RATES = {
    like: 0.05,
    reply: 0.01,
    repost: 0.005,
    quote: 0.002,
    click: 0.15,
    profileClick: 0.02,
    share: 0.005,
    shareViaDm: 0.002,
    shareViaCopyLink: 0.0015,
    photoExpand: 0.03,
    dwell: 0.05,
    followAuthor: 0.002,
    notInterested: 0.02,  // 不感兴趣概率
    block: 0.001,         // 拉黑概率
    mute: 0.001,          // 静音概率
    report: 0.0005,       // 举报概率
};

const PHOENIX_SCORE_FIELDS = [
    'likeScore',
    'replyScore',
    'repostScore',
    'quoteScore',
    'clickScore',
    'quotedClickScore',
    'profileClickScore',
    'videoQualityViewScore',
    'shareScore',
    'shareViaDmScore',
    'shareViaCopyLinkScore',
    'photoExpandScore',
    'dwellScore',
    'dwellTime',
    'followAuthorScore',
    'notInterestedScore',
    'dismissScore',
    'blockAuthorScore',
    'blockScore',
    'muteAuthorScore',
    'reportScore',
] as const satisfies readonly (keyof PhoenixScores)[];

export class EngagementScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'EngagementScorer';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async score(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        const passthrough = getSpaceFeedExperimentFlag(
            query, 'enable_engagement_scorer_passthrough', true
        );

        return candidates.map((candidate) => {
            const { scores, filledMissing } = this.fillMissingPhoenixScores(candidate.phoenixScores);

            if (passthrough && candidate.phoenixScores && !filledMissing) {
                const initialScore = this.computeInitialScore(candidate.phoenixScores);
                return {
                    candidate,
                    score: initialScore,
                    scoreBreakdown: this.buildBreakdown(candidate.phoenixScores, initialScore, 1),
                };
            }

            // 计算初始分数 (基于 phoenixScores 的加权和)
            // 注意：这里不更新 candidate.score；最终排序由 WeightedScorer/AuthorDiversityScorer/OONScorer 决定。
            const initialScore = this.computeInitialScore(scores);

            return {
                candidate: {
                    ...candidate,
                    phoenixScores: scores,
                },
                score: initialScore,
                scoreBreakdown: this.buildBreakdown(scores, initialScore, 0),
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

    private fillMissingPhoenixScores(existing?: PhoenixScores): {
        scores: PhoenixScores;
        filledMissing: boolean;
    } {
        const fallback = this.basePhoenixScores();
        if (!existing) {
            return { scores: fallback, filledMissing: true };
        }

        const merged: PhoenixScores = { ...existing };
        let filledMissing = false;
        for (const key of PHOENIX_SCORE_FIELDS) {
            const value = existing[key];
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                merged[key] = fallback[key];
                filledMissing = true;
            }
        }

        return { scores: merged, filledMissing };
    }

    private basePhoenixScores(): PhoenixScores {
        return {
            likeScore: BASE_RATES.like,
            replyScore: BASE_RATES.reply,
            repostScore: BASE_RATES.repost,
            quoteScore: BASE_RATES.quote,
            clickScore: BASE_RATES.click,
            quotedClickScore: BASE_RATES.click * 0.15,
            profileClickScore: BASE_RATES.profileClick,
            shareScore: BASE_RATES.share,
            shareViaDmScore: BASE_RATES.shareViaDm,
            shareViaCopyLinkScore: BASE_RATES.shareViaCopyLink,
            photoExpandScore: BASE_RATES.photoExpand,
            dwellScore: BASE_RATES.dwell,
            dwellTime: BASE_RATES.dwell,
            followAuthorScore: BASE_RATES.followAuthor,
            notInterestedScore: BASE_RATES.notInterested,
            dismissScore: BASE_RATES.notInterested,
            blockAuthorScore: BASE_RATES.block,
            blockScore: BASE_RATES.block,
            muteAuthorScore: BASE_RATES.mute,
            reportScore: BASE_RATES.report,
            videoQualityViewScore: 0,
        };
    }

    private buildBreakdown(
        scores: PhoenixScores,
        initialScore: number,
        engagementPassthrough: number,
    ): Record<string, number> {
        return {
            likeScore: scores.likeScore || 0,
            replyScore: scores.replyScore || 0,
            repostScore: scores.repostScore || 0,
            clickScore: scores.clickScore || 0,
            dismissScore: scores.dismissScore || 0,
            blockScore: scores.blockScore || 0,
            initialScore,
            engagementPassthrough,
        };
    }
}
