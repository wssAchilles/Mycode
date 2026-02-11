import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { NewsAnnSource } from '../../src/services/recommendation/sources/NewsAnnSource';
import Post from '../../src/models/Post';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('NewsAnnSource', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('hydrates ANN externalIds to posts and preserves ANN order', async () => {
        const q = createFeedQuery('user', 20);
        q.newsHistoryExternalIds = ['N0'];

        const annClient = {
            retrieve: async () => [
                { postId: 'N2', score: 0.9 },
                { postId: 'N1', score: 0.8 },
            ],
        } as any;

        const p1 = {
            _id: oid('507f191e810c19729de8a001'),
            authorId: 'news_bot_official',
            content: 'news 1',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N1', source: 'mind', url: 'mind://N1' },
            stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
            media: [],
            isNsfw: false,
            isPinned: false,
        };
        const p2 = {
            _id: oid('507f191e810c19729de8a002'),
            authorId: 'news_bot_official',
            content: 'news 2',
            createdAt: new Date('2026-02-02T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N2', source: 'mind', url: 'mind://N2' },
            stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
            media: [],
            isNsfw: false,
            isPinned: false,
        };

        const mockLean = vi.fn().mockResolvedValue([p1, p2]); // order from DB does not matter
        vi.spyOn(Post as any, 'find').mockReturnValue({ lean: mockLean } as any);

        const source = new NewsAnnSource(annClient);
        const out = await source.getCandidates(q as any);

        expect(out).toHaveLength(2);
        expect(out[0].newsMetadata?.externalId).toBe('N2');
        expect(out[1].newsMetadata?.externalId).toBe('N1');
        expect(out[0].inNetwork).toBe(false);
        expect(out[1].inNetwork).toBe(false);
    });
});

