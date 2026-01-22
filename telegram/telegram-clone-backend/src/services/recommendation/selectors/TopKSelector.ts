/**
 * TopKSelector - 按分数排序并截断前 K
 * 对齐 x-algorithm selector 行为，优先使用 query.limit，其次回退默认值
 */
import { Selector } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class TopKSelector implements Selector<FeedQuery, FeedCandidate> {
    readonly name = 'TopKSelector';
    private fallbackSize: number;

    constructor(fallbackSize: number) {
        this.fallbackSize = fallbackSize;
    }

    enable(_query: FeedQuery): boolean {
        return true;
    }

    getScore(candidate: FeedCandidate): number {
        return candidate.score ?? 0;
    }

    getSize(query: FeedQuery): number {
        return query.limit || this.fallbackSize;
    }

    select(
        query: FeedQuery,
        candidates: { candidate: FeedCandidate; score: number }[]
    ): FeedCandidate[] {
        const size = this.getSize(query);
        return candidates
            .slice()
            .sort((a, b) => b.score - a.score)
            .slice(0, size)
            .map((c) => c.candidate);
    }
}
