/**
 * PreviouslyServedFilter - 已送过滤器
 * 对齐 x-algorithm：使用客户端携带的 served_ids（以及 related IDs）做去重过滤。
 *
 * 说明：
 * - 工业级做法：served_ids 由客户端在 bottom request 时携带（避免服务端逐条 Redis 查）
 * - 我们保留 ServeCacheSideEffect 作为训练/分析日志与兼容回退，但过滤优先使用客户端状态。
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { getRelatedPostIds } from '../utils/relatedPostIds';

export class PreviouslyServedFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'PreviouslyServedFilter';

    enable(query: FeedQuery): boolean {
        // 对齐 x-algorithm：只在 bottom request 触发（分页时更需要避免重复）
        return query.isBottomRequest && (query.servedIds?.length ?? 0) > 0;
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const servedSet = new Set(query.servedIds || []);
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        for (const c of candidates) {
            const related = getRelatedPostIds(c);
            const isServed = related.some((id) => servedSet.has(id));
            if (isServed) removed.push(c);
            else kept.push(c);
        }

        return { kept, removed };
    }
}
