import { describe, expect, it, vi } from 'vitest';

import { RecommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('RecommendationAdapterService source batch contract', () => {
  it('returns batched source candidates in requested order', async () => {
    const service = new RecommendationAdapterService();
    (service as any).sourceCatalog = {
      PopularSource: {
        name: 'PopularSource',
        enable: () => true,
        getCandidates: async () => [
          {
            postId: 'post-popular',
            authorId: 'author-popular',
            content: 'popular',
            createdAt: new Date('2026-04-20T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
          },
        ],
      },
      ColdStartSource: {
        name: 'ColdStartSource',
        enable: () => true,
        getCandidates: async () => [
          {
            postId: 'post-cold',
            authorId: 'author-cold',
            content: 'cold',
            createdAt: new Date('2026-04-19T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
          },
        ],
      },
    };

    const result = await service.getSourceCandidatesBatch(
      ['PopularSource', 'ColdStartSource'],
      createFeedQuery('viewer-batch', 20),
    );

    expect(result.items.map((item) => item.sourceName)).toEqual([
      'PopularSource',
      'ColdStartSource',
    ]);
    expect(result.items[0]?.candidates[0]?.postId).toBe('post-popular');
    expect(result.items[1]?.candidates[0]?.postId).toBe('post-cold');
  });

  it('stable-deduplicates repeated source names before execution', async () => {
    const service = new RecommendationAdapterService();
    const popularGetCandidates = vi.fn().mockResolvedValue([]);
    (service as any).sourceCatalog = {
      PopularSource: {
        name: 'PopularSource',
        enable: () => true,
        getCandidates: popularGetCandidates,
      },
      ColdStartSource: {
        name: 'ColdStartSource',
        enable: () => true,
        getCandidates: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await service.getSourceCandidatesBatch(
      ['PopularSource', 'PopularSource', 'ColdStartSource'],
      createFeedQuery('viewer-batch-dedup', 20),
    );

    expect(result.items.map((item) => item.sourceName)).toEqual([
      'PopularSource',
      'ColdStartSource',
    ]);
    expect(popularGetCandidates).toHaveBeenCalledTimes(1);
  });

  it('fails open when one source exceeds the batch component timeout', async () => {
    const service = new RecommendationAdapterService();
    (service as any).sourceBatchComponentTimeoutMs = 10;
    (service as any).sourceCatalog = {
      PopularSource: {
        name: 'PopularSource',
        enable: () => true,
        getCandidates: async () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve([
                {
                  postId: 'post-popular-slow',
                  authorId: 'author-popular',
                  content: 'popular',
                  createdAt: new Date('2026-04-20T00:00:00.000Z'),
                  isReply: false,
                  isRepost: false,
                },
              ]);
            }, 50);
          }),
      },
      ColdStartSource: {
        name: 'ColdStartSource',
        enable: () => true,
        getCandidates: async () => [
          {
            postId: 'post-cold-fast',
            authorId: 'author-cold',
            content: 'cold',
            createdAt: new Date('2026-04-19T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
          },
        ],
      },
    };

    const result = await service.getSourceCandidatesBatch(
      ['PopularSource', 'ColdStartSource'],
      createFeedQuery('viewer-batch-timeout', 20),
    );

    expect(result.items.map((item) => item.sourceName)).toEqual([
      'PopularSource',
      'ColdStartSource',
    ]);
    expect(result.items[0]?.candidates).toEqual([]);
    expect(result.items[0]?.timedOut).toBe(true);
    expect(result.items[0]?.timeoutMs).toBe(10);
    expect(result.items[0]?.errorClass).toBe('source_timeout');
    expect(result.items[0]?.stage.detail?.error).toBe('source_timeout:10');
    expect(result.items[0]?.stage.detail?.errorClass).toBe('source_timeout');
    expect(result.items[0]?.stage.detail?.timedOut).toBe(true);
    expect(result.items[1]?.candidates[0]?.postId).toBe('post-cold-fast');
  });

  it('clears a source timeout after a fast source completes', async () => {
    vi.useFakeTimers();
    try {
      const service = new RecommendationAdapterService();
      (service as any).sourceBatchComponentTimeoutMs = 10;
      (service as any).sourceCatalog = {
        FastSource: {
          name: 'FastSource',
          enable: () => true,
          getCandidates: async () => [],
        },
      };
      const timerCountBefore = vi.getTimerCount();

      const result = await service.getSourceCandidatesBatch(
        ['FastSource'],
        createFeedQuery('viewer-batch-fast', 20),
      );

      expect(result.items[0]?.timedOut).toBe(false);
      expect(vi.getTimerCount()).toBe(timerCountBefore);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('counts prototype-like graph recall types as ordinary kernel sources', async () => {
    const service = new RecommendationAdapterService();
    const recallTypes = ['__proto__', 'constructor', 'toString'];
    (service as any).sourceCatalog = {
      GraphSource: {
        name: 'GraphSource',
        enable: () => true,
        getCandidates: async () => recallTypes.map((graphRecallType, index) => ({
          postId: `graph-${index}`,
          authorId: `author-${index}`,
          content: 'graph candidate',
          createdAt: new Date('2026-04-20T00:00:00.000Z'),
          isReply: false,
          isRepost: false,
          recallSource: 'GraphKernelSource',
          graphRecallType,
        })),
      },
    };

    const result = await service.getSourceCandidates(
      'GraphSource',
      createFeedQuery('viewer-graph-counts', 20),
    );
    const counts = result.stage.detail?.kernelSourceCounts as Record<string, number>;

    for (const recallType of recallTypes) {
      expect(Object.prototype.hasOwnProperty.call(counts, recallType)).toBe(true);
      expect(counts[recallType]).toBe(1);
    }
  });
});
