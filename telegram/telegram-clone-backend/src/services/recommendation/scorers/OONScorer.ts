/**
 * OONScorer - 网络外内容降权
 * 对齐 x-algorithm home-mixer/scorers/oon_scorer.rs
 *
 * 注意：该 scorer 只应该在 AuthorDiversityScorer 之后运行，
 * 因为它是对最终 score 的 surface-aware 调整。
 */

import { Scorer, ScoredCandidate } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

const DEFAULT_OON_WEIGHT_FACTOR = 0.7;

export class OONScorer implements Scorer<FeedQuery, FeedCandidate> {
    readonly name = 'OONScorer';
    private factor: number;

    constructor(factor: number = DEFAULT_OON_WEIGHT_FACTOR) {
        this.factor = factor;
    }

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async score(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<ScoredCandidate<FeedCandidate>[]> {
        return candidates.map((candidate) => {
            const base = candidate.score ?? 0;
            const adjusted =
                candidate.inNetwork === false ? base * this.factor : base;

            return {
                candidate: {
                    ...candidate,
                    score: adjusted,
                },
                score: adjusted,
                scoreBreakdown: {
                    baseScore: base,
                    oonFactor: candidate.inNetwork === false ? this.factor : 1.0,
                },
            };
        });
    }

    update(candidate: FeedCandidate, scored: ScoredCandidate<FeedCandidate>): FeedCandidate {
        return {
            ...candidate,
            score: scored.score,
        };
    }
}

