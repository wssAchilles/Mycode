/**
 * RetweetDedupFilter - 转推/引用去重，保留同一原帖一条
 */
import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class RetweetDedupFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'RetweetDedupFilter';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];
        const seen = new Set<string>();

        for (const c of candidates) {
            const canonical = (c.originalPostId || c.postId).toString();
            if (seen.has(canonical)) {
                removed.push(c);
            } else {
                seen.add(canonical);
                kept.push(c);
            }
        }

        return { kept, removed };
    }
}
