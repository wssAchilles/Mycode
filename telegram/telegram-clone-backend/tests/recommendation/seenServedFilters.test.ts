import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { SeenPostFilter } from '../../src/services/recommendation/filters/SeenPostFilter';
import { PreviouslyServedFilter } from '../../src/services/recommendation/filters/PreviouslyServedFilter';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

const baseCandidate = (postId: mongoose.Types.ObjectId, extra?: Partial<any>) => ({
    postId,
    authorId: 'u1',
    content: 'hello',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    ...extra,
});

describe('SeenPostFilter / PreviouslyServedFilter', () => {
    it('SeenPostFilter filters by related ids (not just postId)', async () => {
        const seen = oid('507f191e810c19729de86001').toString();
        const q = createFeedQuery('user', 20, false, { seenIds: [seen] });

        const c1 = baseCandidate(oid('507f191e810c19729de86002'), { originalPostId: oid('507f191e810c19729de86001') });
        const c2 = baseCandidate(oid('507f191e810c19729de86003'));

        const f = new SeenPostFilter();
        const r = await f.filter(q, [c1 as any, c2 as any]);

        expect(r.kept.map((c: any) => c.postId.toString())).toEqual([c2.postId.toString()]);
        expect(r.removed.map((c: any) => c.postId.toString())).toEqual([c1.postId.toString()]);
    });

    it('PreviouslyServedFilter is only enabled on bottom request and filters by related ids', async () => {
        const served = oid('507f191e810c19729de86011').toString();
        const q = createFeedQuery('user', 20, false, {
            isBottomRequest: true,
            servedIds: [served],
        });

        const c1 = baseCandidate(oid('507f191e810c19729de86012'), { conversationId: oid('507f191e810c19729de86011') });
        const c2 = baseCandidate(oid('507f191e810c19729de86013'));

        const f = new PreviouslyServedFilter();
        expect(f.enable(q)).toBe(true);
        const r = await f.filter(q, [c1 as any, c2 as any]);

        expect(r.kept.map((c: any) => c.postId.toString())).toEqual([c2.postId.toString()]);
        expect(r.removed.map((c: any) => c.postId.toString())).toEqual([c1.postId.toString()]);
    });
});

