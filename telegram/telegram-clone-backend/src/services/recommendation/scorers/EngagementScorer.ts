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

        const isFiniteNumber = (v: unknown): v is number =>
            typeof v === 'number' && Number.isFinite(v);

        return candidates.map((candidate) => {
            const fallbackScores = this.calculatePhoenixScores(
                candidate,
                userActionPatterns,
                query
            );

            // Industrial rule: do NOT override real Phoenix predictions.
            // But if the model only returns a subset of actions, fill missing fields from fallback.
            let phoenixScores: PhoenixScores = fallbackScores;
            if (candidate.phoenixScores) {
                const merged: PhoenixScores = { ...candidate.phoenixScores };
                for (const [k, v] of Object.entries(fallbackScores)) {
                    const existing = (candidate.phoenixScores as any)[k];
                    if (!isFiniteNumber(existing) && isFiniteNumber(v)) {
                        (merged as any)[k] = v;
                    }
                }
                phoenixScores = merged;
            }

            // 计算初始分数 (基于 phoenixScores 的加权和)
            // 注意：这里不更新 candidate.score；最终排序由 WeightedScorer/AuthorDiversityScorer/OONScorer 决定。
            const initialScore = this.computeInitialScore(phoenixScores);

            return {
                candidate: {
                    ...candidate,
                    phoenixScores,
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
        let quoteScore = BASE_RATES.quote;
        let clickScore = BASE_RATES.click;
        let profileClickScore = BASE_RATES.profileClick;
        let shareScore = BASE_RATES.share;
        let shareViaDmScore = BASE_RATES.shareViaDm;
        let shareViaCopyLinkScore = BASE_RATES.shareViaCopyLink;
        let photoExpandScore = BASE_RATES.photoExpand;
        let dwellScore = BASE_RATES.dwell;
        let followAuthorScore = BASE_RATES.followAuthor;

        let notInterestedScore = BASE_RATES.notInterested;
        let blockScore = BASE_RATES.block;
        let muteAuthorScore = BASE_RATES.mute;
        let reportScore = BASE_RATES.report;

        // 2. 作者亲密度加成
        const authorKey = `author:${candidate.authorId}`;
        const authorAffinity = Math.min((userPatterns.get(authorKey) || 0) / 10, 1);

        if (authorAffinity > 0) {
            likeScore += AFFINITY_BOOST.like * authorAffinity;
            replyScore += AFFINITY_BOOST.reply * authorAffinity;
            repostScore += AFFINITY_BOOST.repost * authorAffinity;
            clickScore += AFFINITY_BOOST.click * authorAffinity;
            profileClickScore += 0.1 * authorAffinity;
            shareScore += 0.03 * authorAffinity;
            quoteScore += 0.01 * authorAffinity;
            followAuthorScore += 0.02 * authorAffinity;
            // 高亲密度降低负向行为概率
            notInterestedScore *= (1 - authorAffinity * 0.8);
            blockScore *= (1 - authorAffinity * 0.9);
            muteAuthorScore *= (1 - authorAffinity * 0.85);
            reportScore *= (1 - authorAffinity * 0.9);
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
            shareScore += 0.02 * trendingFactor;
            quoteScore += 0.01 * trendingFactor;
        }

        // 4. 内容类型调整
        if (candidate.hasVideo) {
            clickScore *= 1.2; // 视频点击率更高
        }
        if (candidate.hasImage) {
            likeScore *= 1.1; // 图片点赞率更高
            photoExpandScore *= 1.2;
        }

        // 5. 关注网络内加成
        if (candidate.inNetwork) {
            likeScore *= 1.5;
            replyScore *= 1.3;
            repostScore *= 1.15;
            quoteScore *= 1.15;
            clickScore *= 1.05;
            profileClickScore *= 1.1;
            shareScore *= 1.1;
            followAuthorScore *= 1.1;
            // 网络内内容降低负向行为风险
            notInterestedScore *= 0.5;
            blockScore *= 0.2;
            muteAuthorScore *= 0.3;
            reportScore *= 0.3;
        } else {
            // 网络外内容增加负向行为风险
            notInterestedScore += NEGATIVE_RISK.outOfNetworkBlock;
            blockScore += NEGATIVE_RISK.outOfNetworkBlock;
            muteAuthorScore += NEGATIVE_RISK.outOfNetworkBlock * 0.5;
            reportScore += NEGATIVE_RISK.outOfNetworkBlock * 0.2;
        }

        // 6. 内容质量影响负向行为
        const contentLength = candidate.content?.length || 0;
        if (contentLength < 10) {
            // 过短内容增加不感兴趣风险
            notInterestedScore += NEGATIVE_RISK.lowQualityDismiss;
        }

        // 确保概率在 [0, 1] 范围内
        // Keep some derived actions roughly consistent with base actions.
        shareViaDmScore = Math.min(shareViaDmScore + shareScore * 0.3, 1);
        shareViaCopyLinkScore = Math.min(shareViaCopyLinkScore + shareScore * 0.2, 1);
        const quotedClickScore = Math.min(clickScore * 0.15, 1);
        // Keep continuous actions in a normalized range to avoid dominating the weighted sum.
        const dwellTime = Math.max(0, Math.min(1, dwellScore));
        const videoQualityViewScore =
            candidate.hasVideo && typeof candidate.videoDurationSec === 'number' && candidate.videoDurationSec > 5
                ? Math.min(clickScore * 0.25, 1)
                : 0;

        return {
            likeScore: Math.min(likeScore, 1),
            replyScore: Math.min(replyScore, 1),
            repostScore: Math.min(repostScore, 1),
            quoteScore: Math.min(quoteScore, 1),
            clickScore: Math.min(clickScore, 1),
            quotedClickScore,
            profileClickScore: Math.min(profileClickScore, 1),
            shareScore: Math.min(shareScore, 1),
            shareViaDmScore,
            shareViaCopyLinkScore,
            photoExpandScore: Math.min(photoExpandScore, 1),
            dwellScore: Math.min(dwellScore, 1),
            dwellTime,
            followAuthorScore: Math.min(followAuthorScore, 1),
            notInterestedScore: Math.min(notInterestedScore, 1),
            // Keep legacy aliases for compatibility
            dismissScore: Math.min(notInterestedScore, 1),
            blockAuthorScore: Math.min(blockScore, 1),
            blockScore: Math.min(blockScore, 1),
            muteAuthorScore: Math.min(muteAuthorScore, 1),
            reportScore: Math.min(reportScore, 1),
            videoQualityViewScore,
        };
    }
}
