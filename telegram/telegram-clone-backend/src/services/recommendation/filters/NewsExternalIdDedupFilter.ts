/**
 * NewsExternalIdDedupFilter
 * Industrial alignment: News OON candidates may exist as multiple Post documents that point to the same
 * external corpus id (e.g. MIND externalId) or the same topic cluster. Dedupe them before scoring.
 *
 * Defaults:
 * - Always dedupe by externalId when present.
 * - Cluster dedup is off by default and can be enabled via experiment flag.
 */

import { Filter, FilterResult } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { FeedCandidate } from '../types/FeedCandidate';
import { getSpaceFeedExperimentFlag } from '../utils/experimentFlags';

export class NewsExternalIdDedupFilter implements Filter<FeedQuery, FeedCandidate> {
    readonly name = 'NewsExternalIdDedupFilter';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async filter(query: FeedQuery, candidates: FeedCandidate[]): Promise<FilterResult<FeedCandidate>> {
        const kept: FeedCandidate[] = [];
        const removed: FeedCandidate[] = [];

        const enableClusterDedup = getSpaceFeedExperimentFlag(query, 'enable_news_cluster_dedup', false);

        const seenExternal = new Set<string>();
        const seenCluster = new Set<string>();

        for (const c of candidates) {
            if (!c.isNews) {
                kept.push(c);
                continue;
            }

            const ext = (c.newsMetadata?.externalId || c.modelPostId || '').toString();
            const clusterId = c.newsMetadata?.clusterId;
            const clusterKey =
                enableClusterDedup && clusterId !== undefined && clusterId !== null
                    ? String(clusterId)
                    : '';

            if (ext && seenExternal.has(ext)) {
                removed.push(c);
                continue;
            }
            if (clusterKey && seenCluster.has(clusterKey)) {
                removed.push(c);
                continue;
            }

            kept.push(c);
            if (ext) seenExternal.add(ext);
            if (clusterKey) seenCluster.add(clusterKey);
        }

        return { kept, removed };
    }
}

