/**
 * SelfPostFilter - 过滤用户自己的帖子
 */
import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class SelfPostFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'SelfPostFilter';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        for (const c of candidates) {
            if (c.authorId === query.userId) {
                removed.push(c);
            } else {
                kept.push(c);
            }
        }

        return { kept, removed };
    }
}
