import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { ConversationDedupFilter } from '../../src/services/recommendation/filters/ConversationDedupFilter';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

const baseCandidate = (postId: mongoose.Types.ObjectId, score: number, extra?: Partial<any>) => ({
    postId,
    authorId: 'u1',
    content: 'hello',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    score,
    ...extra,
});

describe('ConversationDedupFilter', () => {
    it('keeps the highest-score candidate per conversationId', async () => {
        const q = createFeedQuery('user', 20);
        const conv = oid('507f191e810c19729de86101');

        const low = baseCandidate(oid('507f191e810c19729de86102'), 1, { conversationId: conv });
        const high = baseCandidate(oid('507f191e810c19729de86103'), 10, { conversationId: conv });
        const other = baseCandidate(oid('507f191e810c19729de86104'), 5);

        const f = new ConversationDedupFilter();
        const r = await f.filter(q, [low as any, high as any, other as any]);

        const keptIds = r.kept.map((c: any) => c.postId.toString()).sort();
        expect(keptIds).toEqual([high.postId.toString(), other.postId.toString()].sort());
        expect(r.removed.map((c: any) => c.postId.toString())).toEqual([low.postId.toString()]);
    });
});

