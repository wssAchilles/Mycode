import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { PhoenixScorer } from '../../src/services/recommendation/scorers/PhoenixScorer';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('PhoenixScorer mapping', () => {
    it('maps predictions by prediction.postId (externalId), not by array index', async () => {
        const fakeClient = {
            predict: async () => {
                // Out of order on purpose
                return [
                    {
                        postId: 'N2',
                        like: 0.2,
                        reply: 0.02,
                        repost: 0.01,
                        click: 0.3,
                        profileClick: 0,
                        share: 0,
                        dwell: 0,
                        dismiss: 0,
                        block: 0,
                    },
                    {
                        postId: 'N1',
                        like: 0.9,
                        reply: 0.09,
                        repost: 0.04,
                        click: 0.5,
                        profileClick: 0,
                        share: 0,
                        dwell: 0,
                        dismiss: 0,
                        block: 0,
                    },
                ];
            },
        } as any;

        const scorer = new PhoenixScorer(fakeClient);
        const q = createFeedQuery('user', 20);
        q.modelUserActionSequence = [];

        const n1 = {
            postId: oid('507f191e810c19729de88001'),
            authorId: 'news_bot_official',
            content: 'news 1',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N1' },
            inNetwork: false,
        } as any;

        const n2 = {
            postId: oid('507f191e810c19729de88002'),
            authorId: 'news_bot_official',
            content: 'news 2',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N2' },
            inNetwork: false,
        } as any;

        const social = {
            postId: oid('507f191e810c19729de88003'),
            authorId: 'u1',
            content: 'social',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: false,
            inNetwork: true,
        } as any;

        const out = await scorer.score(q as any, [n1, n2, social]);
        const outCands = out.map((s) => s.candidate);

        const outN1 = outCands.find((c: any) => c.newsMetadata?.externalId === 'N1')!;
        const outN2 = outCands.find((c: any) => c.newsMetadata?.externalId === 'N2')!;
        const outSocial = outCands.find((c: any) => c.authorId === 'u1')!;

        expect(outN1.phoenixScores.likeScore).toBeCloseTo(0.9, 10);
        expect(outN2.phoenixScores.likeScore).toBeCloseTo(0.2, 10);
        // Social posts are not Phoenix-scored by default
        expect(outSocial.phoenixScores).toBeUndefined();
    });
});

