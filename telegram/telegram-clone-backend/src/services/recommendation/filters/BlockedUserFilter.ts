/**
 * BlockedUserFilter - 屏蔽用户过滤器
 * 过滤掉用户已拉黑的作者的帖子
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class BlockedUserFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'BlockedUserFilter';

    enable(query: FeedQuery): boolean {
        // 只有当用户有屏蔽列表时才启用
        return (
            !!query.userFeatures &&
            query.userFeatures.blockedUserIds.length > 0
        );
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const blockedSet = new Set(query.userFeatures?.blockedUserIds || []);
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        for (const candidate of candidates) {
            if (blockedSet.has(candidate.authorId)) {
                removed.push(candidate);
            } else {
                kept.push(candidate);
            }
        }

        return { kept, removed };
    }
}
