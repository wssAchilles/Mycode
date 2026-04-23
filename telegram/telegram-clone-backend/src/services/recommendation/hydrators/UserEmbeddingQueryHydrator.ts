/**
 * UserEmbeddingQueryHydrator - 用户 embedding 查询丰富器
 * 在推荐查询开始前加载 SimClusters embedding 上下文。
 */

import { QueryHydrator } from '../framework';
import { FeatureStore } from '../featureStore';
import { EmbeddingContext, FeedQuery, SparseEmbeddingEntry } from '../types/FeedQuery';

const CONFIG = {
    maxInterestedInClusters: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_MAX_INTEREST_CLUSTERS || '24'), 10) || 24,
    ),
    maxProducerClusters: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_MAX_PRODUCER_CLUSTERS || '24'), 10) || 24,
    ),
    maxAgeDays: Math.max(
        1,
        parseInt(String(process.env.RECOMMENDATION_EMBEDDING_MAX_AGE_DAYS || '30'), 10) || 30,
    ),
    minQualityScore: Math.max(
        0,
        parseFloat(String(process.env.RECOMMENDATION_EMBEDDING_MIN_QUALITY || '0.04')) || 0.04,
    ),
};

function normalizeSparseEntries(
    entries: Array<{ clusterId: number; score: number }> | undefined,
    limit: number,
): SparseEmbeddingEntry[] {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    return entries
        .filter(
            (entry) =>
                typeof entry?.clusterId === 'number' &&
                Number.isFinite(entry.clusterId) &&
                typeof entry?.score === 'number' &&
                Number.isFinite(entry.score) &&
                entry.score > 0,
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => ({
            clusterId: entry.clusterId,
            score: entry.score,
        }));
}

export class UserEmbeddingQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'UserEmbeddingQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        const embeddingContext = await this.loadEmbeddingContext(query.userId);
        return {
            ...query,
            embeddingContext,
        };
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            embeddingContext: hydrated.embeddingContext ?? query.embeddingContext,
        };
    }

    private async loadEmbeddingContext(userId: string): Promise<EmbeddingContext | undefined> {
        try {
            const embedding = await FeatureStore.getUserEmbedding(userId);
            if (!embedding) return undefined;

            const interestedInClusters = normalizeSparseEntries(
                embedding.interestedInClusters,
                CONFIG.maxInterestedInClusters,
            );
            const producerEmbedding = normalizeSparseEntries(
                embedding.producerEmbedding,
                CONFIG.maxProducerClusters,
            );

            const computedAt = embedding.computedAt ? new Date(embedding.computedAt) : undefined;
            const stale = computedAt
                ? Date.now() - computedAt.getTime() > CONFIG.maxAgeDays * 24 * 60 * 60 * 1000
                : true;
            const qualityScore = typeof embedding.qualityScore === 'number' ? embedding.qualityScore : 0;
            const usable =
                !stale &&
                qualityScore >= CONFIG.minQualityScore &&
                interestedInClusters.length > 0;

            return {
                interestedInClusters,
                producerEmbedding,
                knownForCluster: embedding.knownForCluster,
                knownForScore: embedding.knownForScore,
                qualityScore,
                computedAt,
                version: embedding.version,
                usable,
                stale,
            };
        } catch (error) {
            console.error('[UserEmbeddingQueryHydrator] Failed to load embedding context:', error);
            return undefined;
        }
    }
}
