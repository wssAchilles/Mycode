import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { AuthorDiversityScorer } from '../../src/services/recommendation/scorers/AuthorDiversityScorer';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

const baseCandidate = (postId: mongoose.Types.ObjectId, score: number, extra?: Partial<any>) => ({
    postId,
    authorId: 'news_bot_official',
    content: 'news',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    score,
    ...extra,
});

describe('AuthorDiversityScorer', () => {
    it('diversifies news by source domain (not constant authorId)', async () => {
        const q = createFeedQuery('user', 20);
        const scorer = new AuthorDiversityScorer();

        const a1 = baseCandidate(oid('507f191e810c19729de86201'), 10, {
            isNews: true,
            newsMetadata: { sourceUrl: 'https://a.com/article/1' },
        });
        const b1 = baseCandidate(oid('507f191e810c19729de86202'), 9, {
            isNews: true,
            newsMetadata: { sourceUrl: 'https://b.com/article/1' },
        });
        const a2 = baseCandidate(oid('507f191e810c19729de86203'), 8, {
            isNews: true,
            newsMetadata: { sourceUrl: 'https://a.com/article/2' },
        });

        const scored = await scorer.score(q, [a1 as any, b1 as any, a2 as any]);
        const out = scored.map((s) => s.candidate);

        // a1: first from a.com, multiplier=1
        expect(out[0].score).toBeCloseTo(10, 6);
        // b1: first from b.com, multiplier=1
        expect(out[1].score).toBeCloseTo(9, 6);
        // a2: second from a.com, decayed
        expect(out[2].score).toBeCloseTo(8 * 0.86, 6); // (1-0.3)*0.8 + 0.3 = 0.86
    });

    it('diversifies social posts by authorId', async () => {
        const q = createFeedQuery('user', 20);
        const scorer = new AuthorDiversityScorer();

        const p1 = baseCandidate(oid('507f191e810c19729de86211'), 10, { isNews: false, authorId: 'uA' });
        const p2 = baseCandidate(oid('507f191e810c19729de86212'), 9, { isNews: false, authorId: 'uA' });
        const p3 = baseCandidate(oid('507f191e810c19729de86213'), 8, { isNews: false, authorId: 'uB' });

        const scored = await scorer.score(q, [p1 as any, p2 as any, p3 as any]);
        const out = scored.map((s) => s.candidate);

        expect(out[0].score).toBeCloseTo(10, 6);
        expect(out[1].score).toBeCloseTo(9 * 0.86, 6);
        expect(out[2].score).toBeCloseTo(8, 6);
    });
});

