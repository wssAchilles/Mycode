import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { EngagementScorer } from '../../src/services/recommendation/scorers/EngagementScorer';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('EngagementScorer merge semantics', () => {
    it('does not override existing Phoenix predictions, but fills missing action fields', async () => {
        const q = createFeedQuery('user', 20);
        const scorer = new EngagementScorer();

        const cand = {
            postId: oid('507f191e810c19729de8d001'),
            authorId: 'news_bot',
            content: 'news',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            inNetwork: false,
            isNews: true,
            newsMetadata: { externalId: 'N1' },
            // Pretend PhoenixScorer produced a partial vector (like only)
            phoenixScores: { likeScore: 0.9 },
        } as any;

        const out = await scorer.score(q as any, [cand]);
        const s = out[0].candidate.phoenixScores;

        expect(s.likeScore).toBeCloseTo(0.9, 10);
        // Filled by fallback (base rates), should exist
        expect(typeof s.shareScore).toBe('number');
        expect(typeof s.notInterestedScore).toBe('number');
        // Alias maintained for backward compatibility
        expect(s.dismissScore).toBeCloseTo(s.notInterestedScore, 10);
    });
});

