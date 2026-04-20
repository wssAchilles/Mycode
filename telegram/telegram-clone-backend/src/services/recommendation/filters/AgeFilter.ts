/**
 * AgeFilter - 内容时效性过滤器
 * 复刻 x-algorithm home-mixer/filters/age_filter.rs
 * 过滤掉超过指定时间的旧帖子
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class AgeFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'AgeFilter';
    private maxAgeMs: number;
    private sparseRecallMaxAgeMs: number;
    private sparseRecallSources = new Set([
        'GraphKernelSource',
        'GraphSource',
        'PopularSource',
        'ColdStartSource',
    ]);

    constructor(maxAgeDays: number = 7, sparseRecallMaxAgeDays: number = 180) {
        this.maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
        this.sparseRecallMaxAgeMs = sparseRecallMaxAgeDays * 24 * 60 * 60 * 1000;
    }

    enable(query: FeedQuery): boolean {
        // In-network/following feed should not be hard-cropped by global age window,
        // otherwise small social graphs degrade into "only self posts".
        return !query.inNetworkOnly;
    }

    async filter(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const now = Date.now();
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        for (const candidate of candidates) {
            const age = now - candidate.createdAt.getTime();
            const maxAgeMs = this.maxAgeForCandidate(candidate);
            if (age <= maxAgeMs) {
                kept.push(candidate);
            } else {
                removed.push(candidate);
            }
        }

        return { kept, removed };
    }

    private maxAgeForCandidate(candidate: FeedCandidate): number {
        return candidate.recallSource && this.sparseRecallSources.has(candidate.recallSource)
            ? Math.max(this.maxAgeMs, this.sparseRecallMaxAgeMs)
            : this.maxAgeMs;
    }
}
