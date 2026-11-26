import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import { VideoInfoHydrator } from '../../src/services/recommendation/hydrators/VideoInfoHydrator';
import { createFeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import {
    buildFeedPageCacheKey,
    deserializeFeedPageResult,
    isFirstPageFeedCacheable,
    serializeFeedPageResult,
} from '../../src/services/space/feed/feedPageCache';
import type { SpaceFeedPageResult } from '../../src/services/recommendation/feed/pageResult';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('Space feed P0 speed optimizations', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('VideoInfoHydrator skips MongoDB lookup when all candidates are non-video with boolean isNsfw', async () => {
        const findSpy = vi.spyOn(Post, 'find');
        const hydrator = new VideoInfoHydrator();
        const query = createFeedQuery('viewer-1', 20);
        const candidates = [
            createFeedCandidate({
                _id: oid('507f191e810c19729de89011'),
                authorId: 'author-1',
                content: '纯文本动态',
                createdAt: new Date('2026-11-26T00:00:00.000Z'),
                media: [],
                isNsfw: false,
            }),
            createFeedCandidate({
                _id: oid('507f191e810c19729de89012'),
                authorId: 'author-2',
                content: '纯图片动态',
                createdAt: new Date('2026-11-26T00:01:00.000Z'),
                media: [{ type: 'image', url: 'https://example.com/a.png' }],
                isNsfw: false,
            }),
        ];

        const out = await hydrator.hydrate(query, candidates);

        expect(findSpy).not.toHaveBeenCalled();
        expect(out).toHaveLength(2);
        expect(out[0]?.hasVideo).toBe(false);
        expect(out[1]?.hasVideo).toBe(false);
    });

    it('VideoInfoHydrator only queries Post collection for video or incomplete candidates', async () => {
        const videoId = oid('507f191e810c19729de89021');
        const textId = oid('507f191e810c19729de89022');
        const leanMock = vi.fn().mockResolvedValue([
            {
                _id: videoId,
                isNsfw: false,
                media: [{ type: 'video', url: 'https://example.com/v.mp4', duration: 42 }],
            },
        ]);
        const selectMock = vi.fn().mockReturnValue({ lean: leanMock });
        const findSpy = vi.spyOn(Post, 'find').mockReturnValue({ select: selectMock } as any);

        const hydrator = new VideoInfoHydrator();
        const query = createFeedQuery('viewer-2', 20);
        const candidates = [
            createFeedCandidate({
                _id: textId,
                authorId: 'author-1',
                content: '无需查库的图文',
                createdAt: new Date('2026-11-26T00:00:00.000Z'),
                media: [],
                isNsfw: false,
            }),
            createFeedCandidate({
                _id: videoId,
                authorId: 'author-2',
                content: '包含视频需补全时长',
                createdAt: new Date('2026-11-26T00:02:00.000Z'),
                media: [{ type: 'video', url: 'https://example.com/v.mp4' }],
                isNsfw: false,
            }),
        ];

        const out = await hydrator.hydrate(query, candidates);

        expect(findSpy).toHaveBeenCalledTimes(1);
        const filterArg = findSpy.mock.calls[0]?.[0] as { _id: { $in: mongoose.Types.ObjectId[] } };
        expect(filterArg._id.$in.map((id) => id.toString())).toEqual([videoId.toString()]);
        expect(out[1]?.videoDurationSec).toBe(42);
    });

    it('feedPageCache revives ObjectId and Date fields on roundtrip and validates cacheability', () => {
        expect(isFirstPageFeedCacheable({ cursor: undefined, isBottomRequest: false, seenIds: [] })).toBe(true);
        expect(isFirstPageFeedCacheable({ cursor: new Date(), isBottomRequest: false, seenIds: [] })).toBe(false);
        expect(isFirstPageFeedCacheable({ cursor: undefined, isBottomRequest: true, seenIds: [] })).toBe(false);
        expect(isFirstPageFeedCacheable({ cursor: undefined, isBottomRequest: false, seenIds: ['p1'] })).toBe(false);

        expect(buildFeedPageCacheKey({
            userId: 'u1',
            inNetworkOnly: false,
            includeSelf: true,
            limit: 20,
        })).toBe('space:feed:page:v1:u1:all:1:20');

        const postId = oid('507f191e810c19729de89031');
        const createdAt = new Date('2026-11-26T03:00:00.000Z');
        const page: SpaceFeedPageResult = {
            requestId: 'req-old',
            decisionId: 'dec-old',
            candidates: [
                createFeedCandidate({
                    _id: postId,
                    authorId: 'author-1',
                    content: 'cached feed item',
                    createdAt,
                    conversationId: postId,
                }),
            ],
            decisionActionCandidateIds: [postId.toString()],
            hasMore: true,
            nextCursor: createdAt.toISOString(),
            servedIdsDelta: [postId.toString()],
        };

        const raw = serializeFeedPageResult(page);
        const restored = deserializeFeedPageResult(raw, {
            requestId: 'req-new',
            decisionId: 'dec-new',
            clientRequestId: 'client-1',
        });

        expect(restored).not.toBeNull();
        expect(restored?.requestId).toBe('req-new');
        expect(restored?.decisionId).toBe('dec-new');
        expect(restored?.clientRequestId).toBe('client-1');
        expect(restored?.candidates[0]?.postId).toBeInstanceOf(mongoose.Types.ObjectId);
        expect(restored?.candidates[0]?.postId.toString()).toBe(postId.toString());
        expect(restored?.candidates[0]?.createdAt).toBeInstanceOf(Date);
        expect(restored?.candidates[0]?.createdAt.getTime()).toBe(createdAt.getTime());
        expect(restored?.candidates[0]?.conversationId).toBeInstanceOf(mongoose.Types.ObjectId);
    });
});
