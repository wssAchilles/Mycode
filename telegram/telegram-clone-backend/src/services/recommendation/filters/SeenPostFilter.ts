/**
 * SeenPostFilter - 已看帖子过滤器
 * 复刻 x-algorithm 的视觉疲劳过滤概念
 * 过滤掉用户已经看过的帖子
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { getRelatedPostIds } from '../utils/relatedPostIds';
import { getSpaceFeedExperimentConfig } from '../utils/experimentFlags';

const TRUSTED_EMPTY_SELECTION_RECALL_SOURCES = new Set([
    'GraphKernelSource',
    'GraphSource',
    'PopularSource',
    'ColdStartSource',
    'NewsAnnSource',
]);

const parseBool = (v: unknown, fallback: boolean): boolean => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true') return true;
        if (s === 'false') return false;
    }
    return fallback;
};

export class SeenPostFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'SeenPostFilter';

    enable(query: FeedQuery): boolean {
        // Following / In-network feed should behave like a chronological "Following" timeline:
        // do not aggressively hide already-seen posts, otherwise small graphs quickly go empty.
        // We still rely on cursor + served_ids for pagination dedup.
        if (query.inNetworkOnly) return false;
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
        const trustedEmptySelectionFallback: FeedCandidate[] = [];
        const allowTrustedEmptySelectionFallbackDefault = parseBool(
            process.env.SEEN_FILTER_ALLOW_TRUSTED_EMPTY_SELECTION_RECALL ?? 'true',
            true
        );
        const allowTrustedEmptySelectionFallback = parseBool(
            getSpaceFeedExperimentConfig(
                query,
                'seen_filter_allow_trusted_empty_selection_recall',
                allowTrustedEmptySelectionFallbackDefault
            ),
            allowTrustedEmptySelectionFallbackDefault
        );

        for (const candidate of candidates) {
            const related = getRelatedPostIds(candidate);
            const isSeen = related.some((id) => seenSet.has(id));
            if (isSeen) {
                if (
                    allowTrustedEmptySelectionFallback
                    && !query.inNetworkOnly
                    && TRUSTED_EMPTY_SELECTION_RECALL_SOURCES.has(String(candidate.recallSource || ''))
                ) {
                    trustedEmptySelectionFallback.push(candidate);
                }
                removed.push(candidate);
            } else {
                kept.push(candidate);
            }
        }

        if (kept.length === 0 && trustedEmptySelectionFallback.length > 0) {
            const fallbackIds = new Set(trustedEmptySelectionFallback.map((c) => c.postId.toString()));
            return {
                kept: trustedEmptySelectionFallback,
                removed: removed.filter((c) => !fallbackIds.has(c.postId.toString())),
            };
        }

        return { kept, removed };
    }
}
