import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { NewsExternalIdDedupFilter } from '../../src/services/recommendation/filters/NewsExternalIdDedupFilter';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('NewsExternalIdDedupFilter', () => {
    it('dedups news candidates by externalId (default)', async () => {
        const q = createFeedQuery('user', 20, false);
        const f = new NewsExternalIdDedupFilter();

        const n1a = {
            postId: oid('507f191e810c19729de8c001'),
            authorId: 'news_bot',
            content: 'news',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N1' },
        } as any;

        const n1b = {
            postId: oid('507f191e810c19729de8c002'),
            authorId: 'news_bot',
            content: 'news dup',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N1' },
        } as any;

        const social = {
            postId: oid('507f191e810c19729de8c003'),
            authorId: 'u1',
            content: 'social',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: false,
        } as any;

        const r = await f.filter(q as any, [n1a, n1b, social]);
        expect(r.kept.map((c: any) => c.postId.toString())).toEqual([
            n1a.postId.toString(),
            social.postId.toString(),
        ]);
        expect(r.removed.map((c: any) => c.postId.toString())).toEqual([n1b.postId.toString()]);
    });

    it('can dedup by clusterId when enabled via experiment flag', async () => {
        const q = createFeedQuery('user', 20, false);
        q.experimentContext = {
            userId: 'user',
            assignments: [],
            getConfig: (_expId: string, key: string, defaultValue: any) => {
                if (key === 'enable_news_cluster_dedup') return true;
                return defaultValue;
            },
            isInBucket: () => false,
        } as any;

        const f = new NewsExternalIdDedupFilter();

        const n1 = {
            postId: oid('507f191e810c19729de8c011'),
            authorId: 'news_bot',
            content: 'news1',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N1', clusterId: 10 },
        } as any;

        const n2_same_cluster = {
            postId: oid('507f191e810c19729de8c012'),
            authorId: 'news_bot',
            content: 'news2',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
            isNews: true,
            newsMetadata: { externalId: 'N2', clusterId: 10 },
        } as any;

        const r = await f.filter(q as any, [n1, n2_same_cluster]);
        expect(r.kept).toHaveLength(1);
        expect(r.kept[0].postId.toString()).toBe(n1.postId.toString());
        expect(r.removed).toHaveLength(1);
        expect(r.removed[0].postId.toString()).toBe(n2_same_cluster.postId.toString());
    });
});

