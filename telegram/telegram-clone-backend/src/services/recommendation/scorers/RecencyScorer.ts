/**
 * RecencyScorer - 时效性评分器
 * 让新内容在排序中获得更高权重
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
 * 时效性参数
 */
const PARAMS = {
    HALF_LIFE_HOURS: 6, // 半衰期 (6小时后分数减半)
    MAX_BOOST: 1.5,     // 最大加成
    MIN_BOOST: 0.8,     // 最小加成
};

export class RecencyScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'RecencyScorer';
    private halfLifeMs: number;

    constructor(halfLifeHours: number = PARAMS.HALF_LIFE_HOURS) {
        this.halfLifeMs = halfLifeHours * 60 * 60 * 1000;
    }

    enable(_query: FeedQuery): boolean {
        return getSpaceFeedExperimentFlag(_query, 'enable_recency_scorer', false);
    }

    async score(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        const now = Date.now();

        return candidates.map((candidate) => {
            const ageMs = now - candidate.createdAt.getTime();
            const recencyMultiplier = this.getRecencyMultiplier(ageMs);
            const base = candidate.weightedScore ?? 0;
            const adjusted = base * recencyMultiplier;

            return {
                candidate: {
                    ...candidate,
                    weightedScore: adjusted,
                },
                score: adjusted,
                scoreBreakdown: {
                    recencyMultiplier,
                    ageHours: ageMs / (60 * 60 * 1000),
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
     * 计算时效性乘数
     * 使用指数衰减公式: multiplier = MAX * (0.5)^(age/halfLife)
     */
    private getRecencyMultiplier(ageMs: number): number {
        const decayFactor = Math.pow(0.5, ageMs / this.halfLifeMs);
        const multiplier =
            PARAMS.MIN_BOOST +
            (PARAMS.MAX_BOOST - PARAMS.MIN_BOOST) * decayFactor;
        return multiplier;
    }
}
