import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/apiClient', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

import apiClient from '../services/apiClient';
import { spaceAPI, transformPost } from '../services/spaceApi';

const basePost = {
    _id: 'post_1',
    authorId: 'author_1',
    authorUsername: 'Author',
    content: 'hello',
    media: [],
    createdAt: '2026-07-06T00:00:00.000Z',
};

describe('space feed contract', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

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
                decisionId: 'fd3b9c5a-4208-4181-8f02-a1c20f141625',
                candidateNamespace: 'serving_post_id',
                candidateId: 'post_1',
                servedPosition: 3,
                positionContractVersion: 'served_position_1_based_v1',
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
        expect(post.recommendationDecisionId).toBe('fd3b9c5a-4208-4181-8f02-a1c20f141625');
        expect(post.candidateNamespace).toBe('serving_post_id');
        expect(post.candidateId).toBe('post_1');
        expect(post.servedPosition).toBe(3);
        expect(post.positionContractVersion).toBe('served_position_1_based_v1');
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
            _recommendationDecisionId: 'legacy_decision',
            _recommendationRank: 4,
            _recommendationScore: 0.42,
            _weightedScore: 0.55,
            _selectionPool: 'legacy_pool',
            _selectionReason: 'legacy_reason',
        });

        expect(post.recallSource).toBe('embedding');
        expect(post.recommendationRequestId).toBe('legacy_req');
        expect(post.recommendationDecisionId).toBe('legacy_decision');
        expect(post.servedPosition).toBeUndefined();
        expect(post.recommendationRank).toBe(4);
        expect(post.recommendationScore).toBe(0.42);
        expect(post.weightedScore).toBe(0.55);
        expect(post.selectionPool).toBe('legacy_pool');
        expect(post.selectionReason).toBe('legacy_reason');
    });

    it('does not backfill page decision identity onto posts without action identity', async () => {
        vi.mocked(apiClient.post).mockResolvedValueOnce({
            data: {
                request_id: 'page_request',
                decision_id: 'page_decision',
                posts: [
                    {
                        ...basePost,
                        _id: 'self_post',
                        authorId: 'viewer_1',
                        _recommendationDecisionId: 'forged_flat_decision',
                        _recommendationContext: {
                            candidateNamespace: 'serving_post_id',
                            candidateId: 'self_post',
                        },
                    },
                    {
                        ...basePost,
                        _id: 'policy_post',
                        _recommendationContext: {
                            requestId: 'page_request',
                            decisionId: 'page_decision',
                            candidateNamespace: 'serving_post_id',
                            candidateId: 'policy_post',
                            servedPosition: 2,
                            positionContractVersion: 'served_position_1_based_v1',
                            rank: 2,
                        },
                    },
                ],
            },
        } as any);

        const result = await spaceAPI.getFeed(2);

        expect(result.requestId).toBe('page_request');
        expect(result.decisionId).toBe('page_decision');
        expect(result.posts[0]).toMatchObject({
            recommendationRequestId: 'page_request',
            candidateNamespace: 'serving_post_id',
            candidateId: 'self_post',
        });
        expect(result.posts[0].recommendationDecisionId).toBeUndefined();
        expect(result.posts[0].servedPosition).toBeUndefined();
        expect(result.posts[0].positionContractVersion).toBeUndefined();
        expect(result.posts[1]).toMatchObject({
            recommendationRequestId: 'page_request',
            recommendationDecisionId: 'page_decision',
            candidateNamespace: 'serving_post_id',
            candidateId: 'policy_post',
            servedPosition: 2,
            positionContractVersion: 'served_position_1_based_v1',
            recommendationRank: 2,
        });
    });
});
