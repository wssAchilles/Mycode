/**
 * AuthorAffinityScorer - 作者亲密度评分器
 * 复刻 x-algorithm 的 author affinity 概念
 * 基于用户历史行为计算与作者的亲密度分数
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { ActionType } from '../../../models/UserAction';

/**
 * 行为权重配置
 * 不同行为对亲密度的贡献不同
 */
const ACTION_WEIGHTS: Record<string, number> = {
    [ActionType.LIKE]: 1.0,
    [ActionType.REPLY]: 3.0,
    [ActionType.REPOST]: 2.0,
    [ActionType.QUOTE]: 2.5,
    [ActionType.CLICK]: 0.3,
    [ActionType.PROFILE_CLICK]: 1.5,
    [ActionType.SHARE]: 2.0,
};

/**
 * 亲密度参数
 */
const PARAMS = {
    MAX_AFFINITY: 1.0, // 最大亲密度
    DECAY_FACTOR: 0.95, // 时间衰减因子 (每天)
    BASE_BOOST: 0.1, // 有任何交互的基础加成
    HIGH_AFFINITY_THRESHOLD: 5, // 高亲密度阈值
    HIGH_AFFINITY_BOOST: 0.3, // 高亲密度额外加成
};

export class AuthorAffinityScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'AuthorAffinityScorer';

    enable(query: FeedQuery): boolean {
        // 需要用户行为序列
        return !!query.userActionSequence && query.userActionSequence.length > 0;
    }

    async score(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        // 计算与每个作者的亲密度
        const authorAffinities = this.computeAuthorAffinities(query);

        return candidates.map((candidate) => {
            const affinity = authorAffinities.get(candidate.authorId) || 0;
            const currentScore = candidate.score || 0;

            // 亲密度加成
            let boost = 0;
            if (affinity > 0) {
                boost = PARAMS.BASE_BOOST + affinity * 0.5;
                if (affinity >= PARAMS.HIGH_AFFINITY_THRESHOLD) {
                    boost += PARAMS.HIGH_AFFINITY_BOOST;
                }
            }

            const adjustedScore = currentScore * (1 + boost);

            return {
                candidate: {
                    ...candidate,
                    authorAffinityScore: affinity,
                    score: adjustedScore,
                },
                score: adjustedScore,
                scoreBreakdown: {
                    authorAffinity: affinity,
                    affinityBoost: boost,
                },
            };
        });
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            authorAffinityScore: scored.candidate.authorAffinityScore,
            score: scored.score,
        };
    }

    /**
     * 计算与所有作者的亲密度
     */
    private computeAuthorAffinities(query: FeedQuery): Map<string, number> {
        const affinities = new Map<string, number>();
        const actions = query.userActionSequence || [];
        const now = Date.now();

        for (const action of actions) {
            if (!action.targetAuthorId) continue;

            const weight = ACTION_WEIGHTS[action.action] || 0.5;

            // 时间衰减: 越久远的行为权重越低
            const ageInDays = (now - new Date(action.timestamp).getTime()) / (1000 * 60 * 60 * 24);
            const timeDecay = Math.pow(PARAMS.DECAY_FACTOR, ageInDays);

            const contribution = weight * timeDecay;
            const current = affinities.get(action.targetAuthorId) || 0;
            affinities.set(action.targetAuthorId, Math.min(current + contribution, PARAMS.MAX_AFFINITY * 10));
        }

        // 归一化到 [0, MAX_AFFINITY]
        for (const [authorId, rawAffinity] of affinities) {
            affinities.set(authorId, Math.min(rawAffinity / 10, PARAMS.MAX_AFFINITY));
        }

        return affinities;
    }
}
