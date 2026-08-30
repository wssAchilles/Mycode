import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import {
    transformFeedCandidateToResponse,
    type SpaceFeedResponseAdapterOptions,
} from '../../src/services/recommendation/adapters/spaceFeedResponseAdapter';
import { createFeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';

const options = (): SpaceFeedResponseAdapterOptions => ({
    newsBotAvatarUrl: 'news-avatar',
    normalizeMediaUrl: (value) => value ?? null,
    exposeScoreBreakdown: false,
    exposeRecommendationDebug: false,
    exposeExplainSignals: false,
});

describe('recommendation context response contract', () => {
    it('exposes stable context fields without debug trace', () => {
        const candidate = createFeedCandidate({
            _id: new mongoose.Types.ObjectId('65f000000000000000000001'),
            authorId: 'author_1',
            content: 'hello',
            createdAt: new Date('2026-07-06T00:00:00.000Z'),
        });

        Object.assign(candidate, {
            score: 0.72,
            weightedScore: 0.81,
            recallSource: 'GraphSource',
            secondaryRecallSources: ['TwoTowerSource'],
            recallEvidence: {
                primarySource: 'GraphSource',
                sourceCount: 1,
                sameLaneSourceCount: 1,
                crossLaneSourceCount: 0,
                confidence: 0.7,
            },
            selectionPool: 'main',
            selectionReason: 'top_k',
            experimentKeys: ['space_feed_recsys:treatment'],
        });

        const response = transformFeedCandidateToResponse(candidate, options(), {
            requestId: 'req_1',
            rank: 3,
        }) as any;

        expect(response._recommendationContext).toEqual({
            requestId: 'req_1',
            decisionId: undefined,
            candidateNamespace: 'serving_post_id',
            candidateId: '65f000000000000000000001',
            servedPosition: 3,
            positionContractVersion: 'served_position_1_based_v1',
            rank: 3,
            primarySource: 'GraphSource',
            secondarySources: ['TwoTowerSource'],
            recallEvidence: [{
                primarySource: 'GraphSource',
                sourceCount: 1,
                sameLaneSourceCount: 1,
                crossLaneSourceCount: 0,
                confidence: 0.7,
            }],
            selectionPool: 'main',
            selectionReason: 'top_k',
            score: 0.72,
            weightedScore: 0.81,
            experimentKeys: ['space_feed_recsys:treatment'],
        });
        expect(response._recommendationTrace).toBeUndefined();
    });

    it('uses a stable empty evidence array when source evidence is absent', () => {
        const candidate = createFeedCandidate({
            _id: new mongoose.Types.ObjectId('65f000000000000000000002'),
            authorId: 'author_2',
            content: 'hello',
            createdAt: new Date('2026-07-06T00:00:00.000Z'),
        });

        const response = transformFeedCandidateToResponse(candidate, options()) as any;

        expect(response._recommendationContext.recallEvidence).toEqual([]);
        expect(response._recommendationContext.secondarySources).toEqual([]);
        expect(response._recommendationContext.experimentKeys).toEqual([]);
    });
});
