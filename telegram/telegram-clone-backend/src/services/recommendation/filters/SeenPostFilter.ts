/**
 * SeenPostFilter - 已看帖子过滤器
 * 复刻 x-algorithm 的视觉疲劳过滤概念
 * 过滤掉用户已经看过的帖子
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { getRelatedPostIds } from '../utils/relatedPostIds';

export class SeenPostFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'SeenPostFilter';

    enable(query: FeedQuery): boolean {
        return (query.seenIds?.length ?? 0) > 0 || (query.userFeatures?.seenPostIds?.length ?? 0) > 0;
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        // Prefer client-provided seen_ids; fall back to server-derived seenPostIds for backward compatibility.
        const seenIds = (query.seenIds && query.seenIds.length > 0)
            ? query.seenIds
            : (query.userFeatures?.seenPostIds || []);
        const seenSet = new Set(seenIds);
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        for (const candidate of candidates) {
            const related = getRelatedPostIds(candidate);
            const isSeen = related.some((id) => seenSet.has(id));
            if (isSeen) {
                removed.push(candidate);
            } else {
                kept.push(candidate);
            }
        }

        return { kept, removed };
    }
}
