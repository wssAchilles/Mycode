/**
 * ConversationDedupFilter - 对话去重过滤器
 * 保留同一对话/conversationId 中分数最高的候选
 * 需在打分之后执行，依赖 candidate.score
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';

export class ConversationDedupFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'ConversationDedupFilter';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(
        _query: FeedQuery,
        candidates: FeedCandidate[]
    ): Promise<FilterResult<FeedCandidate>> {
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];
        const bestByConversation = new Map<string, { idx: number; score: number }>();

        candidates.forEach((c, idx) => {
            const convId = (c.conversationId || c.postId).toString();
            const score = c.score ?? 0;
            const prev = bestByConversation.get(convId);
            if (!prev || score > prev.score) {
                if (prev) {
                    removed.push(kept[prev.idx]);
                    kept[prev.idx] = c;
                    bestByConversation.set(convId, { idx: prev.idx, score });
                } else {
                    bestByConversation.set(convId, { idx: kept.length, score });
                    kept.push(c);
                }
            } else {
                removed.push(c);
            }
        });

        return { kept, removed };
    }
}
