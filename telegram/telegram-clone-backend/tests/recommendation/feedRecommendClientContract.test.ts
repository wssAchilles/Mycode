import { describe, it, expect } from 'vitest';

import { parseFeedRecommendResponse } from '../../src/services/recommendation/clients/FeedRecommendClient';

describe('FeedRecommendClient contract', () => {
    it('accepts a valid response payload', () => {
        const payload = {
            requestId: 'req-1',
            candidates: [
                { postId: 'p1', score: 1.23, inNetwork: true, safe: true },
                { postId: 'p2', score: 0.5, inNetwork: false, safe: true, reason: 'ok' },
            ],
        };
        const parsed = parseFeedRecommendResponse(payload);
        expect(parsed.requestId).toBe('req-1');
        expect(parsed.candidates).toHaveLength(2);
    });

    it('rejects an invalid response payload', () => {
        expect(() => parseFeedRecommendResponse({})).toThrow(/ml_feed_contract_violation/);
        expect(() => parseFeedRecommendResponse({ requestId: 'x', candidates: [{ postId: 1 }] })).toThrow(
            /ml_feed_contract_violation/
        );
    });
});

