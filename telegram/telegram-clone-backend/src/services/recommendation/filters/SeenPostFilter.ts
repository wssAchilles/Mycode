/**
 * SeenPostFilter - 已看帖子过滤器
 * 复刻 x-algorithm 的视觉疲劳过滤概念
 * 严格遵循 Fail-Closed 原则过滤用户已看过的帖子，不允许特定召回源在空榜时回流已看内容。
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { getRelatedPostIds } from '../utils/relatedPostIds';

export class SeenPostFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'SeenPostFilter';

    enable(query: FeedQuery): boolean {
        // Following / In-network 时间线保持按时间流呈现，不因已看记录过度掏空关注列表
        if (query.inNetworkOnly) return false;
        return (query.seenIds?.length ?? 0) > 0 || (query.userFeatures?.seenPostIds?.length ?? 0) > 0;
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        // 优先使用请求携带的 seenIds，缺失时回退至服务端查询特征中的 seenPostIds
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
