import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import { PopularSource } from '../../src/services/recommendation/sources/PopularSource';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

const contentFeatureMocks = vi.hoisted(() => ({
  getSnapshotsByPostIds: vi.fn(),
  ensureSnapshotsForPosts: vi.fn(),
}));
const featureStoreMocks = vi.hoisted(() => ({
  getUserEmbeddingsBatch: vi.fn(),
  getClustersBatch: vi.fn(),
}));

vi.mock('../../src/services/recommendation/contentFeatures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/recommendation/contentFeatures')>();
  return {
    ...actual,
    postFeatureSnapshotService: contentFeatureMocks,
  };
});

vi.mock('../../src/services/recommendation/featureStore', () => ({
  FeatureStore: featureStoreMocks,
}));

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
    contentFeatureMocks.getSnapshotsByPostIds.mockReset();
    contentFeatureMocks.ensureSnapshotsForPosts.mockReset();
    featureStoreMocks.getUserEmbeddingsBatch.mockReset();
    featureStoreMocks.getClustersBatch.mockReset();
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

  it('keeps embedding rerank read-only on the request path', async () => {
    const query = createFeedQuery('viewer-1', 10);
    query.embeddingContext = {
      interestedInClusters: [{ clusterId: 101, score: 0.9 }],
      producerEmbedding: [],
      usable: true,
      qualityScore: 0.8,
    };
    query.userStateContext = {
      state: 'warm',
      reason: 'test_warm',
      followedCount: 0,
      recentActionCount: 6,
      recentPositiveActionCount: 4,
      usableEmbedding: true,
    };

    const popularPost = {
      _id: oid('507f191e810c19729de8a052'),
      authorId: 'author-3',
      content: 'embedding rerank candidate',
      createdAt: new Date('2026-04-20T05:29:33.402Z'),
      isReply: false,
      isRepost: false,
      isNews: false,
      stats: { likeCount: 21, commentCount: 5, repostCount: 4, viewCount: 180 },
      engagementScore: 42,
      keywords: ['recommendation', 'rust'],
      media: [],
      isNsfw: false,
      isPinned: false,
    };
    mockFindResults([[popularPost]]);
    contentFeatureMocks.getSnapshotsByPostIds.mockResolvedValue(new Map());
    featureStoreMocks.getUserEmbeddingsBatch.mockResolvedValue(new Map());
    featureStoreMocks.getClustersBatch.mockResolvedValue(new Map([
      [101, { name: 'Rust recommendation', description: 'ranking delivery', tags: ['rust'] }],
    ]));

    const output = await new PopularSource().getCandidates(query);

    expect(output).toHaveLength(1);
    expect(contentFeatureMocks.getSnapshotsByPostIds).toHaveBeenCalledTimes(1);
    expect(contentFeatureMocks.ensureSnapshotsForPosts).not.toHaveBeenCalled();
    expect(output[0].interestPoolKind).toBe('popular_embedding');
  });
});
