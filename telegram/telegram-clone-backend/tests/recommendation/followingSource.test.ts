import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import { FollowingSource } from '../../src/services/recommendation/sources/FollowingSource';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

const timelineMocks = vi.hoisted(() => ({
  getMergedPostIdsForAuthorsWithSummary: vi.fn(),
}));
const cacheMocks = vi.hoisted(() => ({
  getPostsForAuthors: vi.fn(),
}));

vi.mock('../../src/services/recommendation/InNetworkTimelineService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/recommendation/InNetworkTimelineService')>();
  return { ...actual, InNetworkTimelineService: timelineMocks };
});

vi.mock('../../src/services/recommendation/sources/FollowingTimelineCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/recommendation/sources/FollowingTimelineCache')>();
  return { ...actual, followingTimelineCache: cacheMocks };
});

const postId = new mongoose.Types.ObjectId('507f191e810c19729de8a051');

describe('FollowingSource', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    timelineMocks.getMergedPostIdsForAuthorsWithSummary.mockReset();
    cacheMocks.getPostsForAuthors.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back when Redis returns only stale post IDs', async () => {
    timelineMocks.getMergedPostIdsForAuthorsWithSummary.mockResolvedValue({
      postIds: [postId.toString()],
      summary: {
        sourceCount: 1,
        requestedAuthorCount: 1,
        scannedHitCount: 1,
        dedupCount: 1,
        outputCount: 1,
        perAuthorFetch: 3,
      },
    });
    const findSpy = vi.spyOn(Post as any, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    } as any);
    const fallbackPost = {
      _id: postId,
      authorId: 'followed-author',
      content: 'fallback post',
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      isNews: false,
    };
    cacheMocks.getPostsForAuthors.mockResolvedValue([fallbackPost]);

    const query = createFeedQuery('viewer-1', 10, true);
    query.userFeatures = {
      followedUserIds: ['followed-author'],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
    };

    const output = await new FollowingSource().getCandidates(query);

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(cacheMocks.getPostsForAuthors).toHaveBeenCalledWith(['followed-author'], undefined);
    expect(output).toHaveLength(1);
    expect(output[0].postId.toString()).toBe(postId.toString());
    expect(output[0].inNetwork).toBe(true);
  });
});
