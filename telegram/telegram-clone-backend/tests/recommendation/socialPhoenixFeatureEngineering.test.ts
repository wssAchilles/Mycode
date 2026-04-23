import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import {
    buildSocialPhoenixFeatureMap,
    buildSocialPhoenixFeatureMapFromCandidate,
    scoreTaskProbability,
    type SocialPhoenixLinearModel,
} from '../../src/services/recommendation/socialPhoenix';

describe('social phoenix feature engineering', () => {
    it('builds stable source/user-state features for online candidates', () => {
        const query = createFeedQuery('viewer-1', 20);
        query.userStateContext = {
            state: 'heavy',
            reason: 'dense_recent_activity',
            followedCount: 10,
            recentActionCount: 24,
            recentPositiveActionCount: 16,
            usableEmbedding: true,
        };
        query.embeddingContext = {
            interestedInClusters: [{ clusterId: 11, score: 0.8 }],
            producerEmbedding: [],
            usable: true,
            qualityScore: 0.84,
            stale: false,
        };

        const features = buildSocialPhoenixFeatureMapFromCandidate(query, {
            postId: new mongoose.Types.ObjectId('507f191e810c19729de86001'),
            authorId: 'author-1',
            content: 'hello',
            createdAt: new Date(),
            isReply: false,
            isRepost: false,
            recallSource: 'TwoTowerSource',
            inNetwork: false,
            hasImage: true,
            likeCount: 10,
            commentCount: 2,
            repostCount: 1,
            _scoreBreakdown: {
                retrievalEmbeddingScore: 0.44,
                retrievalDenseVectorScore: 0.62,
                retrievalAuthorClusterScore: 0.31,
            },
        } as any);

        expect(features['user_state:heavy']).toBe(1);
        expect(features['source:TwoTowerSource']).toBe(1);
        expect(features.retrieval_dense).toBeCloseTo(0.62, 6);
        expect(features.out_of_network).toBe(1);
    });

    it('scores linear model tasks from engineered features', () => {
        const features = buildSocialPhoenixFeatureMap({
            userState: 'warm',
            recallSource: 'PopularSource',
            retrievalEmbeddingScore: 0.4,
            retrievalDenseVectorScore: 0.55,
            retrievalSnapshotQuality: 0.6,
            inNetwork: false,
            hasImage: true,
            createdAt: new Date(),
        });

        const model: SocialPhoenixLinearModel = {
            version: 1,
            trainedAt: new Date().toISOString(),
            features: Object.keys(features),
            tasks: {
                click: { bias: -0.2, weights: { retrieval_embedding: 0.8, retrieval_dense: 1.1, freshness: 0.4 } },
                like: { bias: -0.4, weights: { retrieval_embedding: 0.7 } },
                reply: { bias: -0.7, weights: { retrieval_dense: 0.4 } },
                repost: { bias: -0.9, weights: { retrieval_dense: 0.3 } },
                quote: { bias: -1.1, weights: { retrieval_dense: 0.2 } },
                share: { bias: -1.2, weights: { retrieval_dense: 0.2 } },
                engagement: { bias: -0.3, weights: { retrieval_dense: 0.9, snapshot_quality: 0.5 } },
                negative: { bias: -2.0, weights: { out_of_network: 0.4 } },
            },
            metadata: {},
        };

        expect(scoreTaskProbability(model, 'click', features)).toBeGreaterThan(0.5);
        expect(scoreTaskProbability(model, 'engagement', features)).toBeGreaterThan(
            scoreTaskProbability(model, 'negative', features),
        );
    });
});
