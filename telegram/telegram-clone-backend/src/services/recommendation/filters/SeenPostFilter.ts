/**
 * SeenPostFilter - 已看帖子过滤器
 * 复刻 x-algorithm 的视觉疲劳过滤概念
 * 过滤掉用户已经看过的帖子
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class SeenPostFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'SeenPostFilter';

    enable(query: FeedQuery): boolean {
        return (
            !!query.userFeatures &&
            query.userFeatures.seenPostIds.length > 0
        );
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const seenSet = new Set(query.userFeatures?.seenPostIds || []);
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        for (const candidate of candidates) {
            const postIdStr = candidate.postId.toString();
            if (seenSet.has(postIdStr)) {
                removed.push(candidate);
            } else {
                kept.push(candidate);
            }
        }

        return { kept, removed };
    }
}
