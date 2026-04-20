import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import { ColdStartSource } from '../../src/services/recommendation/sources/ColdStartSource';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

function mockFindResults(results: any[][]) {
  const findSpy = vi.spyOn(Post as any, 'find');

  for (const result of results) {
    const chain = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(result),
    };
    findSpy.mockReturnValueOnce(chain as any);
  }

  return findSpy;
}

describe('ColdStartSource sparse corpus fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to sparse global non-news corpus when news supply is empty', async () => {
    const query = createFeedQuery('viewer-1', 10);
    const sparsePost = {
      _id: oid('507f191e810c19729de8a041'),
      authorId: 'author-2',
      content: 'sparse social post',
      createdAt: new Date('2026-01-15T00:00:00.000Z'),
      isReply: false,
      isRepost: false,
      isNews: false,
      stats: { likeCount: 1, commentCount: 0, repostCount: 0, viewCount: 3 },
      media: [],
      isNsfw: false,
      isPinned: false,
    };
    const findSpy = mockFindResults([[], [], [sparsePost]]);

    const output = await new ColdStartSource().getCandidates(query);

    expect(findSpy).toHaveBeenCalledTimes(3);
    expect(output).toHaveLength(1);
    expect(output[0].postId.toString()).toBe('507f191e810c19729de8a041');
    expect(output[0].authorId).toBe('author-2');
    expect(output[0].inNetwork).toBe(false);
  });
});
