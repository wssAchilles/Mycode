import {
    isRecommendationTraceEnabled,
    recordRecommendationTrace,
} from '../observability/recommendationTrace';
import { PipelineSideEffectContext, SideEffect } from '../framework';
import { FeedCandidate } from '../types/FeedCandidate';
import { FeedQuery } from '../types/FeedQuery';

export class RecommendationTraceLogger implements SideEffect<FeedQuery, FeedCandidate> {
    readonly name = 'RecommendationTraceLogger';

    enable(_query: FeedQuery): boolean {
        return isRecommendationTraceEnabled();
    }

    async run(
        query: FeedQuery,
        selectedCandidates: FeedCandidate[],
        context?: PipelineSideEffectContext<FeedCandidate>,
    ): Promise<void> {
        await recordRecommendationTrace(query, selectedCandidates, {
            replayCandidates: context?.preSelectorCandidates,
        });
    }
}
