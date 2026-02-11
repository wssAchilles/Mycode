import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { NewsModelContextQueryHydrator } from '../../src/services/recommendation/hydrators/NewsModelContextQueryHydrator';
import Post from '../../src/models/Post';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('NewsModelContextQueryHydrator', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds modelUserActionSequence using externalId mapping and skips non-news actions', async () => {
        const q = createFeedQuery('user', 20);

        const newsPostId = oid('507f191e810c19729de89001');
        const socialPostId = oid('507f191e810c19729de89002');

        q.userActionSequence = [
            { action: 'like', targetPostId: newsPostId, timestamp: new Date('2026-02-01T00:00:00.000Z') },
            { action: 'click', targetPostId: socialPostId, timestamp: new Date('2026-02-02T00:00:00.000Z') },
        ] as any;

        const mockLean = vi.fn().mockResolvedValue([
            { _id: newsPostId, newsMetadata: { externalId: 'N123' } },
        ]);
        vi.spyOn(Post as any, 'find').mockReturnValue({ lean: mockLean } as any);

        const hydrator = new NewsModelContextQueryHydrator();
        const out = await hydrator.hydrate(q as any);

        expect(out.newsHistoryExternalIds).toEqual(['N123']);
        expect(out.modelUserActionSequence).toHaveLength(1);
        expect(out.modelUserActionSequence?.[0]?.targetPostId).toBe('N123');
    });
});

