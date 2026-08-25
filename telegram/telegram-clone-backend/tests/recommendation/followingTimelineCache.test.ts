import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Post from '../../src/models/Post';
import { FollowingTimelineCache } from '../../src/services/recommendation/sources/FollowingTimelineCache';

function post(authorId: string, minutesAgo: number) {
  return {
    authorId,
    createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
  };
}

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

describe('FollowingTimelineCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('backfills an author omitted by the shared Mongo limit', async () => {
    const authorAPosts = [
      post('author-a', 1),
      post('author-a', 2),
      post('author-a', 3),
      post('author-a', 4),
    ];
    const authorBPosts = [post('author-b', 5)];
    const findSpy = mockFindResults([authorAPosts, authorBPosts]);

    const cache = new FollowingTimelineCache({
      ttlMs: 60_000,
      maxPerAuthor: 2,
      maxAgeDays: 30,
    });
    const result = await cache.getPostsForAuthors(['author-a', 'author-b']);

    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(findSpy.mock.calls[0]?.[0]).toMatchObject({
      authorId: { $in: ['author-a', 'author-b'] },
    });
    expect(findSpy.mock.calls[1]?.[0]).toMatchObject({ authorId: 'author-b' });
    expect(result.filter((item) => item.authorId === 'author-a')).toHaveLength(2);
    expect(result.filter((item) => item.authorId === 'author-b')).toHaveLength(1);
  });

  it('backfills an author only partially covered by the shared Mongo limit', async () => {
    const sharedPosts = [
      post('author-a', 1),
      post('author-a', 2),
      post('author-a', 3),
      post('author-b', 4),
    ];
    const authorBPosts = [sharedPosts[3], post('author-b', 5)];
    const findSpy = mockFindResults([sharedPosts, authorBPosts]);

    const cache = new FollowingTimelineCache({
      ttlMs: 60_000,
      maxPerAuthor: 2,
      maxAgeDays: 30,
    });
    const result = await cache.getPostsForAuthors(['author-a', 'author-b']);

    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(findSpy.mock.calls[1]?.[0]).toMatchObject({ authorId: 'author-b' });
    expect(result.filter((item) => item.authorId === 'author-a')).toHaveLength(2);
    expect(result.filter((item) => item.authorId === 'author-b')).toHaveLength(2);
  });
});
