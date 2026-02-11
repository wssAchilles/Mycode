import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { VFFilter } from '../../src/services/recommendation/filters/VFFilter';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('VFFilter degrade policy', () => {
    it('drops OON when VF decision is missing and keeps in-network', async () => {
        const f = new VFFilter();
        const q = createFeedQuery('user', 20, false);

        const inNet = {
            postId: oid('507f191e810c19729de8b001'),
            authorId: 'u1',
            content: 'ok',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            inNetwork: true,
            isNsfw: false,
        } as any;

        const oon = {
            postId: oid('507f191e810c19729de8b002'),
            authorId: 'u2',
            content: 'ok',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            inNetwork: false,
            isNsfw: false,
        } as any;

        const r = await f.filter(q as any, [inNet, oon]);
        expect(r.kept).toHaveLength(1);
        expect(r.kept[0].postId.toString()).toBe(inNet.postId.toString());
        expect(r.removed.map((c: any) => c.postId.toString())).toEqual([oon.postId.toString()]);
    });
});

