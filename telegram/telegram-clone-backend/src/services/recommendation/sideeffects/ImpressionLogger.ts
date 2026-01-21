/**
 * ImpressionLogger - 曝光日志记录器
 * 复刻 x-algorithm 的 side effect 机制
 * 异步记录帖子曝光，用于后续的 SeenPostFilter 和分析
 */

import { SideEffect } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import UserAction, { ActionType } from '../../../models/UserAction';

export class ImpressionLogger implements SideEffect<FeedQuery, FeedCandidate> {
    readonly name = 'ImpressionLogger';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async run(query: FeedQuery, selectedCandidates: FeedCandidate[]): Promise<void> {
        if (selectedCandidates.length === 0) return;

        try {
            // 批量记录曝光
            const impressions = selectedCandidates.map((candidate) => ({
                userId: query.userId,
                action: ActionType.IMPRESSION,
                targetPostId: candidate.postId,
                targetAuthorId: candidate.authorId,
                productSurface: 'feed',
                timestamp: new Date(),
            }));

            await UserAction.logActions(impressions);

            console.log(
                `[ImpressionLogger] Logged ${selectedCandidates.length} impressions for user ${query.userId}`
            );
        } catch (error) {
            console.error('[ImpressionLogger] Failed to log impressions:', error);
        }
    }
}
