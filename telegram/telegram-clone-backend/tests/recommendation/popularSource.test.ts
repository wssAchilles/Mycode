import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import { PopularSource } from '../../src/services/recommendation/sources/PopularSource';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

function mockFindResults(results: any[][]) {
  const findSpy = vi.spyOn(Post as any, 'find');

  for (const result of results) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(result),
    };
    findSpy.mockReturnValueOnce(chain as any);
  }

  return findSpy;
}

describe('PopularSource sparse primary recall', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs by default for out-of-network feed and falls back beyond the 7 day window', async () => {
    const query = createFeedQuery('viewer-1', 10);
    query.userFeatures = {
      followedUserIds: ['followed-author'],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
    };
    query.userStateContext = {
      state: 'sparse',
      reason: 'test_sparse',
      followedCount: 1,
      recentActionCount: 2,
      recentPositiveActionCount: 1,
      usableEmbedding: false,
    };

    const sparsePost = {
      _id: oid('507f191e810c19729de8a051'),
      authorId: 'author-2',
      content: 'older but still useful popular post',
      createdAt: new Date('2026-02-12T05:29:33.402Z'),
      isReply: false,
      isRepost: false,
      isNews: false,
      stats: { likeCount: 11, commentCount: 4, repostCount: 3, viewCount: 95 },
      engagementScore: 28,
      keywords: ['recommendation', 'ai'],
      media: [],
      isNsfw: false,
      isPinned: false,
    };
    const findSpy = mockFindResults([[], [], [sparsePost]]);

    const source = new PopularSource();
    const output = await source.getCandidates(query);

    expect(source.enable(query)).toBe(true);
    expect(findSpy).toHaveBeenCalledTimes(3);
    expect(findSpy.mock.calls[0]?.[0]).toMatchObject({
      isNews: false,
      engagementScore: { $gte: 5 },
    });
    expect(output).toHaveLength(1);
    expect(output[0].postId.toString()).toBe('507f191e810c19729de8a051');
    expect(output[0].authorId).toBe('author-2');
    expect(output[0].recallSource).toBe('PopularSource');
    expect(output[0].inNetwork).toBe(false);
  });
});
