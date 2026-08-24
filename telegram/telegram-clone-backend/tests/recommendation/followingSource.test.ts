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
const timelineSummary = {
  sourceCount: 1,
  requestedAuthorCount: 1,
  scannedHitCount: 1,
  dedupCount: 1,
  outputCount: 1,
  perAuthorFetch: 3,
};

function mockFindResults(results: unknown[][]) {
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

function buildQuery(cursor?: Date) {
  const query = createFeedQuery('viewer-1', 10, true, { cursor });
  query.userFeatures = {
    followedUserIds: ['followed-author'],
    blockedUserIds: [],
    mutedKeywords: [],
    seenPostIds: [],
  };
  return query;
}

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
      summary: timelineSummary,
    });
    const findSpy = mockFindResults([[]]);
    const fallbackPost = {
      _id: postId,
      authorId: 'followed-author',
      content: 'fallback post',
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      isNews: false,
    };
    cacheMocks.getPostsForAuthors.mockResolvedValue([fallbackPost]);

    const query = buildQuery();

    const output = await new FollowingSource().getCandidates(query);

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(cacheMocks.getPostsForAuthors).toHaveBeenCalledWith(['followed-author'], undefined);
    expect(output).toHaveLength(1);
    expect(output[0].postId.toString()).toBe(postId.toString());
    expect(output[0].inNetwork).toBe(true);
  });

  it('falls back when Redis contains an invalid post ID', async () => {
    timelineMocks.getMergedPostIdsForAuthorsWithSummary.mockResolvedValue({
      postIds: ['not-an-object-id'],
      summary: timelineSummary,
    });
    const findSpy = mockFindResults([]);
    findSpy.mockImplementation(() => {
      throw new Error('Post.find should not run for invalid Redis IDs');
    });
    const fallbackPost = {
      _id: postId,
      authorId: 'followed-author',
      content: 'fallback post',
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      isNews: false,
    };
    cacheMocks.getPostsForAuthors.mockResolvedValue([fallbackPost]);

    const output = await new FollowingSource().getCandidates(buildQuery());

    expect(findSpy).not.toHaveBeenCalled();
    expect(cacheMocks.getPostsForAuthors).toHaveBeenCalledWith(['followed-author'], undefined);
    expect(output).toHaveLength(1);
    expect(output[0].postId.toString()).toBe(postId.toString());
  });

  it('uses the direct Mongo fallback with the cursor boundary', async () => {
    timelineMocks.getMergedPostIdsForAuthorsWithSummary.mockResolvedValue({
      postIds: [postId.toString()],
      summary: timelineSummary,
    });
    const cursor = new Date('2026-08-24T01:00:00.000Z');
    const directPost = {
      _id: postId,
      authorId: 'followed-author',
      content: 'direct fallback post',
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      isNews: false,
    };
    const findSpy = mockFindResults([[], [directPost]]);
    cacheMocks.getPostsForAuthors.mockResolvedValue([]);
    const source = new FollowingSource();
    const query = buildQuery(cursor);

    const output = await source.getCandidates(query);

    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(findSpy.mock.calls[1]?.[0]).toMatchObject({
      authorId: { $in: ['followed-author'] },
      createdAt: { $lt: cursor },
    });
    expect(source.stageDetail(query)).toMatchObject({
      sourcePath: 'mongo_direct_following_fallback',
      directFallbackOutputCount: 1,
    });
    expect(output).toHaveLength(1);
    expect(output[0].postId.toString()).toBe(postId.toString());
  });
});
