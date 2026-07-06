import { describe, expect, it } from 'vitest';

import { transformPost } from '../services/spaceApi';

const basePost = {
    _id: 'post_1',
    authorId: 'author_1',
    authorUsername: 'Author',
    content: 'hello',
    media: [],
    createdAt: '2026-07-06T00:00:00.000Z',
};

describe('space feed contract', () => {
    it('prefers stable recommendation context over legacy flat fields', () => {
        const post = transformPost({
            ...basePost,
            _recallSource: 'ColdStartSource',
            _recommendationRequestId: 'legacy_req',
            _recommendationRank: 99,
            _recommendationScore: 0.1,
            _weightedScore: 0.2,
            _selectionPool: 'legacy_pool',
            _selectionReason: 'legacy_reason',
            _recommendationContext: {
                requestId: 'req_1',
                rank: 3,
                primarySource: 'GraphSource',
                secondarySources: ['TwoTowerSource'],
                recallEvidence: [{ source: 'GraphSource', score: 0.7 }],
                selectionPool: 'main',
                selectionReason: 'top_k',
                score: 0.72,
                weightedScore: 0.81,
                experimentKeys: ['space_feed_recsys:treatment'],
            },
        });

        expect(post.recallSource).toBe('graph');
        expect(post.recommendationRequestId).toBe('req_1');
        expect(post.recommendationRank).toBe(3);
        expect(post.recommendationScore).toBe(0.72);
        expect(post.weightedScore).toBe(0.81);
        expect(post.selectionPool).toBe('main');
        expect(post.selectionReason).toBe('top_k');
    });

    it('falls back to legacy recommendation fields during migration', () => {
        const post = transformPost({
            ...basePost,
            _recallSource: 'TwoTowerSource',
            _recommendationRequestId: 'legacy_req',
            _recommendationRank: 4,
            _recommendationScore: 0.42,
            _weightedScore: 0.55,
            _selectionPool: 'legacy_pool',
            _selectionReason: 'legacy_reason',
        });

        expect(post.recallSource).toBe('embedding');
        expect(post.recommendationRequestId).toBe('legacy_req');
        expect(post.recommendationRank).toBe(4);
        expect(post.recommendationScore).toBe(0.42);
        expect(post.weightedScore).toBe(0.55);
        expect(post.selectionPool).toBe('legacy_pool');
        expect(post.selectionReason).toBe('legacy_reason');
    });
});
