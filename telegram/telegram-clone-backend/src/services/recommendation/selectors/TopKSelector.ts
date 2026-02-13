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
    private oversampleFactor: number;
    private maxSize?: number;

    constructor(
        fallbackSize: number,
        options?: { oversampleFactor?: number; maxSize?: number }
    ) {
        this.fallbackSize = fallbackSize;
        this.oversampleFactor = Math.max(1, options?.oversampleFactor ?? 1);
        this.maxSize = options?.maxSize;
    }

    enable(_query: FeedQuery): boolean {
        return true;
    }

    getScore(candidate: FeedCandidate): number {
        return candidate.score ?? 0;
    }

    getSize(query: FeedQuery): number {
        const base = query.limit || this.fallbackSize;
        const size = base * this.oversampleFactor;
        return this.maxSize ? Math.min(size, this.maxSize) : size;
    }

    select(
        query: FeedQuery,
        candidates: { candidate: FeedCandidate; score: number }[]
    ): FeedCandidate[] {
        const size = this.getSize(query);
        // Industrial semantics:
        // - For "Following" (in-network-only) timeline, keep it chronological (most recent first).
        // - For "For You" / mixed feeds, keep score-based ordering.
        const sorted = candidates.slice().sort((a, b) => {
            if (query.inNetworkOnly) {
                const at = a.candidate.createdAt instanceof Date ? a.candidate.createdAt.getTime() : 0;
                const bt = b.candidate.createdAt instanceof Date ? b.candidate.createdAt.getTime() : 0;
                if (bt !== at) return bt - at;
            }
            return b.score - a.score;
        });

        return sorted.slice(0, size).map((c) => c.candidate);
    }
}
