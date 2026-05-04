import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import {
    transformFeedCandidateToResponse,
    type SpaceFeedResponseAdapterOptions,
} from '../../src/services/recommendation/adapters/spaceFeedResponseAdapter';
import type { FeedCandidate } from '../../src/services/recommendation';

function candidate(): FeedCandidate {
    return {
        postId: new mongoose.Types.ObjectId('65f000000000000000000001'),
        authorId: 'author-1',
        content: 'hello',
        createdAt: new Date('2026-05-04T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
        media: [],
        score: 1.2,
        inNetwork: false,
        recallSource: 'GraphSource',
        recommendationExplain: {
            primarySource: 'GraphSource',
            sourceReason: 'graph_match',
            inNetwork: false,
            embeddingMatched: false,
            graphMatched: true,
            popularFallback: false,
            diversityAdjusted: false,
            evidence: ['graph_author'],
            signals: {
                finalScore: 1.2,
                weightedScore: 1.0,
            },
        },
        _scoreBreakdown: {
            finalScore: 1.2,
        },
        _pipelineScore: 1.2,
    } as unknown as FeedCandidate;
}

function options(
    overrides: Partial<SpaceFeedResponseAdapterOptions> = {},
): SpaceFeedResponseAdapterOptions {
    return {
        newsBotAvatarUrl: 'news-avatar',
        normalizeMediaUrl: (value) => value ?? null,
        exposeScoreBreakdown: false,
        exposeRecommendationDebug: false,
        exposeExplainSignals: false,
        ...overrides,
    };
}

describe('space feed response adapter', () => {
    it('omits heavy recommendation signals from the default feed response', () => {
        const response = transformFeedCandidateToResponse(candidate(), options()) as any;

        expect(response._recommendationExplain.signals).toBeUndefined();
        expect(response._scoreBreakdown).toBeUndefined();
        expect(response._pipelineScore).toBeUndefined();
        expect(response._recommendationTrace).toBeUndefined();
    });

    it('exposes signals and score breakdown only for debug response modes', () => {
        const response = transformFeedCandidateToResponse(
            candidate(),
            options({
                exposeExplainSignals: true,
                exposeScoreBreakdown: true,
                exposeRecommendationDebug: true,
            }),
        ) as any;

        expect(response._recommendationExplain.signals.finalScore).toBe(1.2);
        expect(response._scoreBreakdown.finalScore).toBe(1.2);
        expect(response._pipelineScore).toBe(1.2);
        expect(response._recommendationTrace.ranking.finalScore).toBe(1.2);
    });
});
