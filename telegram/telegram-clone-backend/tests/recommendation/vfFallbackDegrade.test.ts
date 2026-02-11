import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import axios from 'axios';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { SafetyFilter } from '../../src/services/recommendation/filters/SafetyFilter';
import { HttpVFClient } from '../../src/services/recommendation/clients/VFClient';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('SafetyFilter VF degrade policy', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('treats proxy fallback as VF unavailable and degrades to in-network only', async () => {
        vi.spyOn(axios as any, 'create').mockReturnValue({ post: vi.fn() } as any);
        vi.spyOn(axios as any, 'post').mockResolvedValue({
            data: { results: [] },
            headers: { 'x-ml-fallback': 'true' },
        } as any);

        const vf = new HttpVFClient({ endpoint: 'http://example.com/vf/check', timeoutMs: 50 });
        const f = new SafetyFilter(vf as any);

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

