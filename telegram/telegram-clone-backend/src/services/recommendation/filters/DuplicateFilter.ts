/**
 * DuplicateFilter - 去重过滤器
 * 过滤掉重复的帖子 (来自不同 Source 的相同帖子)
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class DuplicateFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'DuplicateFilter';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const seenIds = new Set<string>();
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        for (const candidate of candidates) {
            const postIdStr = candidate.postId.toString();
            if (seenIds.has(postIdStr)) {
                removed.push(candidate);
            } else {
                seenIds.add(postIdStr);
                kept.push(candidate);
            }
        }

        return { kept, removed };
    }
}
