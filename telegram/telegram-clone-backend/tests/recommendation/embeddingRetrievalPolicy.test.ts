import { describe, expect, it } from 'vitest';

import {
    getEmbeddingAuthorRecallWeights,
    getEmbeddingInterestPoolPlan,
    shouldUseEmbeddingAuthorRecall,
} from '../../src/services/recommendation/utils/embeddingRetrieval';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('embedding retrieval policy', () => {
    it('keeps dense -> cluster -> legacy ordering for strong embeddings and structured fallback for weak embeddings', () => {
        expect(getEmbeddingInterestPoolPlan('strong', 'warm')).toEqual([
            'dense_pool',
            'cluster_pool',
            'legacy_pool',
        ]);
        expect(getEmbeddingInterestPoolPlan('weak', 'sparse')).toEqual([
            'cluster_pool',
            'legacy_pool',
        ]);
    });

    it('allows author recall for weak embeddings but shifts weight from dense overlap to cluster and graph priors', () => {
        const query = createFeedQuery('viewer-weak', 20);
        query.userStateContext = {
            state: 'sparse',
            reason: 'weak_embedding',
            followedCount: 2,
            recentActionCount: 6,
            recentPositiveActionCount: 3,
            usableEmbedding: true,
        };
        query.embeddingContext = {
            interestedInClusters: [{ clusterId: 1, score: 0.8 }],
            producerEmbedding: [],
            qualityScore: 0.24,
            usable: true,
            stale: true,
        };

        const weights = getEmbeddingAuthorRecallWeights('weak', 'sparse');

        expect(shouldUseEmbeddingAuthorRecall(query)).toBe(true);
        expect(weights.clusterProducerPrior).toBeGreaterThan(weights.authorEmbeddingOverlap);
        expect(weights.graphCoEngagementPrior).toBeGreaterThan(weights.candidateDenseSignal);
    });
});
