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

  it('drains source details when a source rejects', async () => {
    const service = new RecommendationAdapterService();
    const pendingDetails = new Map<string, Record<string, unknown>>();
    const query = createFeedQuery('viewer-source-failure', 20, false, {
      requestId: 'adapter-source-failure',
    });
    const stageDetail = vi.fn((request: typeof query, _candidates: unknown[]) => {
      const detail = pendingDetails.get(request.requestId);
      pendingDetails.delete(request.requestId);
      return detail;
    });

    (service as any).sourceCatalog = {
      FailingSource: {
        name: 'FailingSource',
        enable: () => true,
        getCandidates: async (request: typeof query) => {
          pendingDetails.set(request.requestId, { recorded: true });
          throw new Error('source boom');
        },
        stageDetail,
      },
    };

    const result = await service.getSourceCandidates('FailingSource', query);

    expect(result.candidates).toEqual([]);
    expect(result.errorClass).toBe('source_failed');
    expect(pendingDetails.size).toBe(0);
    expect(stageDetail).toHaveBeenCalledWith(query, []);
  });

  it('keeps candidates when stage detail cleanup throws', async () => {
    const service = new RecommendationAdapterService();
    const candidate = {
      postId: 'post-stage-detail-error',
      authorId: 'author-stage-detail-error',
      content: 'candidate',
      createdAt: new Date('2026-04-20T00:00:00.000Z'),
      isReply: false,
      isRepost: false,
    };
    const query = createFeedQuery('viewer-stage-detail-error', 20, false, {
      requestId: 'adapter-stage-detail-error',
    });
    const stageDetail = vi.fn(() => {
      throw new Error('detail boom');
    });
    (service as any).sourceCatalog = {
      StableSource: {
        name: 'StableSource',
        enable: () => true,
        getCandidates: async () => [candidate],
        stageDetail,
      },
    };

    const result = await service.getSourceCandidates('StableSource', query);

    expect(result.candidates).toEqual([candidate]);
    expect(result.errorClass).toBeUndefined();
    expect(stageDetail).toHaveBeenCalledWith(query, [candidate]);
  });

  it('drains late source details after batch timeout for resolve and reject', async () => {
    vi.useFakeTimers();
    const pendingDetails = new Map<string, Record<string, unknown>>();
    const query = createFeedQuery('viewer-late-source-details', 20, false, {
      requestId: 'adapter-late-source-details',
    });
    const deferred = <T>() => {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    };
    const resolveGate = deferred<unknown[]>();
    const rejectGate = deferred<unknown[]>();
    const makeSource = (name: string, gate: ReturnType<typeof deferred<unknown[]>>) => {
      const stageDetail = vi.fn((request: typeof query, _candidates: unknown[]) => {
        const key = `${name}:${request.requestId}`;
        const detail = pendingDetails.get(key);
        pendingDetails.delete(key);
        return detail;
      });
      return {
        name,
        enable: () => true,
        getCandidates: async (request: typeof query) => {
          pendingDetails.set(`${name}:${request.requestId}`, { recorded: true });
          return gate.promise;
        },
        stageDetail,
      };
    };
    const service = new RecommendationAdapterService();
    (service as any).sourceBatchComponentTimeoutMs = 10;
    (service as any).sourceCatalog = {
      SlowResolveSource: makeSource('SlowResolveSource', resolveGate),
      SlowRejectSource: makeSource('SlowRejectSource', rejectGate),
    };

    try {
      const execution = service.getSourceCandidatesBatch(
        ['SlowResolveSource', 'SlowRejectSource'],
        query,
      );
      await vi.advanceTimersByTimeAsync(10);
      const result = await execution;

      expect(result.items.every((item) => item.timedOut)).toBe(true);
      expect(pendingDetails.size).toBe(2);

      resolveGate.resolve([]);
      rejectGate.reject(new Error('late source boom'));
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(pendingDetails.size).toBe(0);
      const [resolveSource, rejectSource] = [
        (service as any).sourceCatalog.SlowResolveSource,
        (service as any).sourceCatalog.SlowRejectSource,
      ];
      expect(resolveSource.stageDetail).toHaveBeenCalledWith(query, []);
      expect(rejectSource.stageDetail).toHaveBeenCalledWith(query, []);
    } finally {
      resolveGate.resolve([]);
      rejectGate.resolve([]);
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
