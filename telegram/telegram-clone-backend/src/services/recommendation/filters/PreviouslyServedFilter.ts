/**
 * PreviouslyServedFilter - 已送过滤器
 * 使用 ServeCacheSideEffect 的内存缓存，过滤当前 session 近期已推送的帖子
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { ServeCacheSideEffect } from '../sideeffects/ServeCacheSideEffect';

export class PreviouslyServedFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'PreviouslyServedFilter';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(
        query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];
        await Promise.all(
            candidates.map(async (c) => {
                const id = c.postId.toString();
                const served = await ServeCacheSideEffect.hasServedAsync(query.userId, id);
                if (served) {
                    removed.push(c);
                } else {
                    kept.push(c);
                }
            })
        );
        return { kept, removed };
    }
}
