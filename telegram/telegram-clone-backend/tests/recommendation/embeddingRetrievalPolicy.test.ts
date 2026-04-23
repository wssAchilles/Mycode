import { describe, expect, it } from 'vitest';

import {
    computeEmbeddingRecallSignals,
    getEmbeddingAuthorRecallWeights,
    getEmbeddingInterestPoolPlan,
    type PreparedEmbeddingRetrievalContext,
    shouldUseEmbeddingAuthorRecall,
} from '../../src/services/recommendation/utils/embeddingRetrieval';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import type { FeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';

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

    it('derives candidate-side topic coverage from author and candidate proxies', () => {
        const context: PreparedEmbeddingRetrievalContext = {
            qualityScore: 0.8,
            userClusters: [{ clusterId: 7, score: 0.9 }],
            userClusterMap: new Map([[7, 0.9]]),
            keywordWeights: new Map([['rust', 0.8]]),
            denseUserEmbedding: [],
        };
        const candidate = {
            content: 'rust performance note',
            createdAt: new Date('2026-04-23T00:00:00.000Z'),
            hasImage: false,
            hasVideo: false,
            media: [],
            likeCount: 0,
            commentCount: 0,
            repostCount: 0,
        } as FeedCandidate;

        const signals = computeEmbeddingRecallSignals(
            candidate,
            ['rust'],
            context,
            {
                knownForCluster: 7,
                producerEmbedding: [{ clusterId: 7, score: 0.7 }],
                interestedInClusters: [],
            },
        );

        expect(signals.authorTopicProxyScore).toBeGreaterThan(0);
        expect(signals.topicCoverageScore).toBeGreaterThan(0);
        expect(signals.candidateTopicCompleteness).toBeGreaterThan(0);
    });
});
