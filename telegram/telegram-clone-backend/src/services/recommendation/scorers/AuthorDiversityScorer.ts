/**
 * AuthorDiversityScorer - 作者多样性评分器
 * 像素级复刻 x-algorithm home-mixer/scorers/author_diversity_scorer.rs
 * 对同一作者的连续帖子进行降权，保证 Feed 多样性
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

/**
 * 多样性参数
 * 复刻 author_diversity_scorer.rs
 */
const PARAMS = {
    DECAY_FACTOR: 0.8,  // 衰减因子 (每多一篇同作者帖子，分数乘以此因子)
    FLOOR: 0.3,         // 最低衰减倍数 (不会低于原分数的 30%)
};

export class AuthorDiversityScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'AuthorDiversityScorer';
    private decayFactor: number;
    private floor: number;

    constructor(decayFactor: number = PARAMS.DECAY_FACTOR, floor: number = PARAMS.FLOOR) {
        this.decayFactor = decayFactor;
        this.floor = floor;
    }

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async score(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        // 复刻 author_diversity_scorer.rs 的逻辑:
        // 1. 先按现有分数排序
        // 2. 遍历并记录每个作者出现的次数
        // 3. 对同一作者的后续帖子应用衰减

        // 按分数排序的索引
        const ordered = candidates
            .map((c, index) => ({ index, candidate: c }))
            .sort((a, b) => (b.candidate.score || 0) - (a.candidate.score || 0));

        const authorCounts = new Map<string, number>();
        const scoredResults: ScoredCandidate<FeedCandidate>[] = new Array(candidates.length);

        for (const { index, candidate } of ordered) {
            const position = authorCounts.get(candidate.authorId) || 0;
            authorCounts.set(candidate.authorId, position + 1);

            const multiplier = this.getMultiplier(position);
            const originalScore = candidate.score || 0;
            const adjustedScore = originalScore * multiplier;

            scoredResults[index] = {
                candidate: {
                    ...candidate,
                    score: adjustedScore,
                },
                score: adjustedScore,
                scoreBreakdown: {
                    originalScore,
                    diversityMultiplier: multiplier,
                    adjustedScore,
                },
            };
        }

        return scoredResults;
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            score: scored.score,
        };
    }

    /**
     * 计算衰减乘数
     * 复刻 AuthorDiversityScorer::multiplier()
     * 公式: (1 - floor) * decay^position + floor
     */
    private getMultiplier(position: number): number {
        return (1 - this.floor) * Math.pow(this.decayFactor, position) + this.floor;
    }
}
