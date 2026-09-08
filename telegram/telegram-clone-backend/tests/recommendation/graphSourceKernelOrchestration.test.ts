import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import { GraphSource } from '../../src/services/recommendation/sources/GraphSource';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { graphAuthorMaterializationRequestSchema } from '../../src/services/recommendation/rust/graphProviderContracts';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = (value) => {
      settled = true;
      resolvePromise(value);
    };
    reject = (reason) => {
      settled = true;
      rejectPromise(reason);
    };
  });
  return { promise, resolve, reject, isSettled: () => settled };
}

function aggregateResult<T>(value: T): Promise<T> & { allowDiskUse(value: boolean): Promise<T> } {
  const aggregate = Promise.resolve(value) as Promise<T> & {
    allowDiskUse(value: boolean): Promise<T>;
  };
  aggregate.allowDiskUse = vi.fn(() => aggregate);
  return aggregate;
}

describe('GraphSource graph kernel orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('combines social, recent, and bridge graph-kernel signals into ranked candidates', async () => {
    const query = createFeedQuery('viewer-1', 10);
    query.cursor = new Date('2026-04-18T00:00:00.000Z');
    query.userFeatures = {
      followedUserIds: [],
      blockedUserIds: ['blocked-user'],
      mutedKeywords: [],
      seenPostIds: [],
    };

    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [
          {
            userId: 'author-1',
            score: 8,
            engagementScore: 6,
            recentnessScore: 0.4,
            relationKinds: ['follow', 'reply'],
          },
        ],
        diagnostics: {
          kernel: 'social_neighbors',
          snapshotVersion: 'snapshot_2026_07_06',
          budgetExhausted: false,
          truncatedCount: 0,
        },
      }),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [
          {
            userId: 'author-1',
            score: 3,
            engagementScore: 7,
            recentnessScore: 0.9,
            relationKinds: ['recent_activity'],
          },
        ],
        diagnostics: {
          kernel: 'recent_engagers',
          snapshotVersion: 'snapshot_2026_07_06',
          budgetExhausted: false,
          truncatedCount: 1,
        },
      }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [
          {
            userId: 'author-2',
            score: 4,
            depth: 2,
            pathCount: 3,
            viaUserIds: ['bridge-a', 'bridge-b'],
            bridgeStrength: 6.5,
            viaUserCount: 2,
          },
        ],
        diagnostics: {
          kernel: 'bridge_users',
          snapshotVersion: 'snapshot_2026_07_06',
          budgetExhausted: false,
          truncatedCount: 0,
        },
      }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      batch: vi.fn(),
    };

    const legacyClient = {
      recall: vi.fn().mockResolvedValue([]),
    };

    const aggregate = vi.spyOn(Post as any, 'aggregate').mockReturnValue(aggregateResult([
      {
        _id: oid('507f191e810c19729de8b001'),
        authorId: 'author-1',
        content: 'social + recent candidate',
        createdAt: new Date('2026-04-17T01:00:00.000Z'),
        isReply: false,
        isRepost: false,
        deletedAt: null,
      },
      {
        _id: oid('507f191e810c19729de8b002'),
        authorId: 'author-2',
        content: 'bridge candidate',
        createdAt: new Date('2026-04-17T00:30:00.000Z'),
        isReply: false,
        isRepost: false,
        deletedAt: null,
      },
    ]));

    const source = new GraphSource({
      client: legacyClient as any,
      graphKernelClient: graphKernelClient as any,
      maxTotal: 10,
    });

    const candidates = await source.getCandidates(query);

    expect(graphKernelClient.socialNeighborsWithDiagnostics).toHaveBeenCalledOnce();
    expect(graphKernelClient.recentEngagersWithDiagnostics).toHaveBeenCalledOnce();
    expect(graphKernelClient.bridgeUsersWithDiagnostics).toHaveBeenCalledOnce();
    expect(graphKernelClient.coEngagersWithDiagnostics).toHaveBeenCalledOnce();
    expect(graphKernelClient.contentAffinityNeighborsWithDiagnostics).toHaveBeenCalledOnce();
    expect(graphKernelClient.batch).not.toHaveBeenCalled();
    expect(legacyClient.recall).not.toHaveBeenCalled();
    expect(aggregate.mock.calls[0][0][0].$match.createdAt.$lt).toEqual(query.cursor);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].authorId).toBe('author-1');
    expect(candidates[0].recallSource).toBe('GraphKernelSource');
    expect(candidates[0].graphRecallType).toBe('cpp_graph_multi_signal');
    expect(candidates[0].graphPath).toContain('cpp_graph_social_neighbor');
    expect(candidates[0].graphPath).toContain('cpp_graph_recent_engager');
    expect(candidates[0].graphPath).toContain('relations:follow|recent_activity|reply');
    expect(candidates[0]._scoreBreakdown?.retrievalGraphMultiSignalBonus).toBeGreaterThan(0);
    expect(candidates[0]._scoreBreakdown?.retrievalGraphRecentEngagerScore).toBeGreaterThan(0);

    expect(candidates[1].authorId).toBe('author-2');
    expect(candidates[1].graphRecallType).toBe('cpp_graph_bridge_user');
    expect(candidates[1].graphPath).toContain('via_users:bridge-a|bridge-b');

    expect(source.stageDetail(query, candidates)).toMatchObject({
      graphKernelSource: true,
      graphKernelDiagnostics: {
        'social-neighbors': {
          snapshotVersion: 'snapshot_2026_07_06',
          budgetExhausted: false,
        },
        'recent-engagers': {
          truncatedCount: 1,
        },
      },
      graphKernelSnapshotVersions: ['snapshot_2026_07_06'],
      graphKernelRankedAuthorCount: 2,
      graphKernelReturnedCandidateCount: 2,
      graphKernelMaterializerDiagnostics: {
        requestedAuthorCount: 2,
        uniqueAuthorCount: 2,
        returnedPostCount: 2,
      },
    });
  });

  it('skips non-finite or empty graph-kernel authors before materialization', async () => {
    const query = createFeedQuery('viewer-1', 10);
    const validPostId = '507f191e810c19729de8b001';
    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [
          { userId: 'invalid-score-author', score: Number.POSITIVE_INFINITY },
          { userId: 'nan-score-author', score: Number.NaN },
          { userId: 'overflow-author', score: Number.MAX_VALUE },
          { userId: 'missing-score-author' },
          { userId: 'null-score-author', score: null as any },
          { userId: 'negative-score-author', score: -1 },
          {
            userId: 'invalid-metadata-author',
            score: 1,
            relationKinds: {} as any,
          },
          { userId: '', score: 9 },
          { userId: 'valid-author', score: 1 },
        ],
      }),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [
          { userId: 'overflow-author', score: Number.MAX_VALUE },
          { userId: 'valid-author', score: Number.NaN },
        ],
      }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [{
          userId: 'invalid-via-author',
          depth: 1,
          pathCount: 1,
          viaUserIds: {} as any,
        }, {
          userId: 'missing-bridge-score',
          depth: 1,
          pathCount: 1,
          viaUserIds: [],
        }],
      }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
    };
    const legacyClient = { recall: vi.fn().mockResolvedValue([]) };

    vi.spyOn(Post as any, 'aggregate').mockReturnValue(aggregateResult([
      {
        _id: oid(validPostId),
        authorId: 'valid-author',
        content: 'valid candidate',
        createdAt: new Date('2026-04-17T01:00:00.000Z'),
        isReply: false,
        isRepost: false,
        deletedAt: null,
      },
    ]));

    const source = new GraphSource({
      client: legacyClient as any,
      graphKernelClient: graphKernelClient as any,
      maxTotal: 10,
    });

    const candidates = await source.getCandidates(query);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].authorId).toBe('valid-author');
    expect(source.stageDetail(query, candidates)).toMatchObject({
      graphKernelRankedAuthorCount: 1,
      graphKernelMaterializerDiagnostics: {
        requestedAuthorCount: 1,
        uniqueAuthorCount: 1,
      },
    });
    expect(legacyClient.recall).not.toHaveBeenCalled();
  });

  it('preserves legacy graph recall order and skips invalid post ids', async () => {
    const query = createFeedQuery('viewer-1', 10);
    const postId1 = '507f191e810c19729de8b001';
    const postId2 = '507f191e810c19729de8b002';
    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
    };
    const legacyClient = {
      recall: vi.fn().mockResolvedValue([
        { postId: 'invalid-post-id', score: 1, path: 'invalid', type: 'friend_of_friend' },
        { postId: postId2.toUpperCase(), score: 0.9, path: 'via-user-2', type: 'similar_user' },
        { postId: postId2, score: 0.5, path: 'via-user-2-low', type: 'topic_interest' },
        { postId: postId1, score: 0.5, path: 'via-user-1', type: 'topic_interest' },
      ]),
    };
    vi.spyOn(Post as any, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: oid(postId1),
          authorId: 'author-1',
          content: 'candidate one',
          createdAt: new Date('2026-04-17T01:00:00.000Z'),
        },
        {
          _id: oid(postId2),
          authorId: 'author-2',
          content: 'candidate two',
          createdAt: new Date('2026-04-17T00:30:00.000Z'),
        },
      ]),
    });

    const source = new GraphSource({
      client: legacyClient as any,
      graphKernelClient: graphKernelClient as any,
      maxTotal: 10,
    });

    const candidates = await source.getCandidates(query);

    expect(candidates.map((candidate) => candidate.postId.toString())).toEqual([postId2, postId1]);
    expect(candidates.map((candidate) => (candidate as any).graphScore)).toEqual([0.9, 0.5]);
    expect((candidates[0] as any).graphPath).toBe('via-user-2');
    expect(Post.find).toHaveBeenCalledWith(expect.objectContaining({
      _id: { $in: [oid(postId2), oid(postId1)] },
    }));
  });

  it('preserves graph-kernel empty diagnostics when falling back to legacy graph source', async () => {
    const query = createFeedQuery('viewer-1', 10);
    query.userFeatures = {
      followedUserIds: [],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
    };

    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [],
        diagnostics: {
          kernel: 'social_neighbors',
          snapshotVersion: 'snapshot_empty',
          empty: true,
          emptyReason: 'no_social_neighbors',
        },
      }),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
    };
    const legacyClient = {
      recall: vi.fn().mockResolvedValue([]),
    };

    const source = new GraphSource({
      client: legacyClient as any,
      graphKernelClient: graphKernelClient as any,
      maxTotal: 10,
    });

    const candidates = await source.getCandidates(query);

    expect(candidates).toEqual([]);
    expect(legacyClient.recall).toHaveBeenCalledOnce();
    expect(source.stageDetail(query, candidates)).toMatchObject({
      graphKernelSource: true,
      graphKernelDiagnostics: {
        'social-neighbors': {
          snapshotVersion: 'snapshot_empty',
          empty: true,
          emptyReason: 'no_social_neighbors',
        },
      },
      graphKernelRankedAuthorCount: 0,
      graphKernelReturnedCandidateCount: 0,
    });
  });

  it('keeps the served path unchanged when batch shadow comparison fails', async () => {
    const query = createFeedQuery('viewer-1', 10);
    const batchShadow = deferred<never>();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    query.userFeatures = {
      followedUserIds: [],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
    };

    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      batch: vi.fn(() => batchShadow.promise),
    };
    const legacyClient = {
      recall: vi.fn().mockResolvedValue([]),
    };

    const source = new GraphSource({
      client: legacyClient as any,
      graphKernelClient: graphKernelClient as any,
      graphKernelBatchMode: 'shadow_compare',
      maxTotal: 10,
    });

    const candidates = await source.getCandidates(query);

    expect(candidates).toEqual([]);
    expect(legacyClient.recall).toHaveBeenCalledOnce();
    expect(graphKernelClient.batch).toHaveBeenCalledOnce();
    const observation = source.stageDetail(query, candidates)?.graphKernelBatchShadowCompare as
      | Record<string, unknown>
      | undefined;
    expect(observation).toEqual({
      mode: 'shadow_compare',
      status: 'scheduled',
    });
    batchShadow.reject(new Error('batch shadow unavailable'));
    await vi.waitFor(() => {
      expect(info).toHaveBeenCalledWith(
        '[GraphSource] graph kernel batch shadow observation',
        expect.objectContaining({
          requestId: query.requestId,
          mode: 'shadow_compare',
          status: 'failed',
          error: 'batch shadow unavailable',
        }),
      );
    });
    expect(observation).toEqual({
      mode: 'shadow_compare',
      status: 'scheduled',
    });
  });

  it('schedules batch shadow only after all legacy kernel queries complete', async () => {
    const query = createFeedQuery('viewer-1', 10);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const social = deferred<{ candidates: [] }>();
    const batchShadow = deferred<never>();
    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn(() => social.promise),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      batch: vi.fn(() => batchShadow.promise),
    };
    const source = new GraphSource({
      client: { recall: vi.fn().mockResolvedValue([]) } as any,
      graphKernelClient: graphKernelClient as any,
      graphKernelBatchMode: 'shadow_compare',
    });

    const serving = source.getCandidates(query);
    await Promise.resolve();

    expect(graphKernelClient.batch).not.toHaveBeenCalled();
    social.resolve({ candidates: [] });
    const candidates = await serving;
    expect(graphKernelClient.batch).toHaveBeenCalledOnce();
    const observation = source.stageDetail(query, candidates)
      ?.graphKernelBatchShadowCompare as Record<string, unknown>;
    expect(observation).toEqual({ mode: 'shadow_compare', status: 'scheduled' });
    batchShadow.reject(new Error('release ordering test shadow permit'));
    await vi.waitFor(() => {
      expect(info).toHaveBeenCalledWith(
        '[GraphSource] graph kernel batch shadow observation',
        expect.objectContaining({
          requestId: query.requestId,
          status: 'failed',
        }),
      );
    });
    expect(observation).toEqual({ mode: 'shadow_compare', status: 'scheduled' });
  });

  it('records batch shadow drift without serving batch candidates', async () => {
    const query = createFeedQuery('viewer-1', 10);
    query.userFeatures = {
      followedUserIds: [],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
    };
    const batchDiagnostics = (kernel: string, candidateCount = 0) => ({
      kernel,
      queryDurationMs: 1,
      candidateCount,
      requestedLimit: 10,
      availableCount: candidateCount,
      truncatedCount: 0,
      scannedCount: candidateCount,
      visitedCount: 0,
      snapshotVersion: 'batch-v2',
      snapshotLoadedAtMs: 200,
      prunedCount: 0,
      frontierMaxSize: 0,
      budgetExhausted: false,
      empty: candidateCount === 0,
      emptyReason: candidateCount === 0 ? 'no_candidates' : null,
      relationKinds: [],
    });
    const batchResponse = {
      userId: query.userId,
      snapshotVersion: 'batch-v2',
      snapshotLoadedAtMs: 200,
      socialNeighbors: {
        candidates: [{ userId: 'batch-only-author', score: 1 }],
        diagnostics: {
          ...batchDiagnostics('social_neighbors', 1),
          scannedCount: 5,
        },
      },
      recentEngagers: {
        candidates: [],
        diagnostics: batchDiagnostics('recent_engagers'),
      },
      bridgeUsers: {
        candidates: [],
        diagnostics: batchDiagnostics('bridge_users'),
      },
      coEngagers: {
        candidates: [],
        diagnostics: batchDiagnostics('co_engagers'),
      },
      contentAffinityNeighbors: {
        candidates: [],
        diagnostics: batchDiagnostics('content_affinity_neighbors'),
      },
    };
    const batchShadow = deferred<typeof batchResponse>();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [],
        diagnostics: {
          kernel: 'social_neighbors',
          candidateCount: 0,
          scannedCount: 2,
          snapshotVersion: 'legacy-v1',
          snapshotLoadedAtMs: 100,
        },
      }),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      batch: vi.fn(() => batchShadow.promise),
    };
    const legacyClient = {
      recall: vi.fn().mockResolvedValue([]),
    };
    const source = new GraphSource({
      client: legacyClient as any,
      graphKernelClient: graphKernelClient as any,
      graphKernelBatchMode: 'shadow_compare',
      maxTotal: 10,
    });

    const candidates = await source.getCandidates(query);

    expect(candidates).toEqual([]);
    expect(legacyClient.recall).toHaveBeenCalledOnce();
    const observation = source.stageDetail(query, candidates)?.graphKernelBatchShadowCompare as
      | Record<string, unknown>
      | undefined;
    expect(observation).toEqual({ mode: 'shadow_compare', status: 'scheduled' });
    batchShadow.resolve(batchResponse);
    await vi.waitFor(() => {
      expect(info).toHaveBeenCalledWith(
        '[GraphSource] graph kernel batch shadow observation',
        expect.objectContaining({
          requestId: query.requestId,
          mode: 'shadow_compare',
          status: 'completed',
          batchSnapshotVersion: 'batch-v2',
          legacySnapshotVersions: ['legacy-v1'],
          versionDrift: true,
          countDrift: expect.objectContaining({
            'social-neighbors': 1,
          }),
          diagnosticDrift: expect.objectContaining({
            'social-neighbors': expect.arrayContaining([
              'snapshotVersion',
              'snapshotLoadedAtMs',
              'candidateCount',
              'scannedCount',
            ]),
          }),
        }),
      );
    });
    expect(observation).toEqual({ mode: 'shadow_compare', status: 'scheduled' });
  });

  it('does not wait for a hanging batch shadow request before serving candidates', async () => {
    const query = createFeedQuery('viewer-1', 10);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    query.userFeatures = {
      followedUserIds: [],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
    };
    const batchRequest = deferred<never>();
    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [{ userId: 'author-1', score: 1 }],
        diagnostics: {
          kernel: 'social_neighbors',
          snapshotVersion: 'legacy-v1',
          snapshotLoadedAtMs: 100,
        },
      }),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      batch: vi.fn(() => batchRequest.promise),
    };
    vi.spyOn(Post as any, 'aggregate').mockReturnValue(aggregateResult([{
      _id: oid('507f191e810c19729de8b003'),
      authorId: 'author-1',
      content: 'served without waiting for batch shadow',
      createdAt: new Date('2026-04-17T02:00:00.000Z'),
      isReply: false,
      isRepost: false,
      deletedAt: null,
    }]));
    const source = new GraphSource({
      client: { recall: vi.fn() } as any,
      graphKernelClient: graphKernelClient as any,
      graphKernelBatchMode: 'shadow_compare',
      maxTotal: 10,
    });

    const candidates = await source.getCandidates(query);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].authorId).toBe('author-1');
    expect(graphKernelClient.batch).toHaveBeenCalledOnce();
    expect(batchRequest.isSettled()).toBe(false);
    const observation = source.stageDetail(query, candidates)
      ?.graphKernelBatchShadowCompare as Record<string, unknown>;
    expect(observation).toEqual({
      mode: 'shadow_compare',
      status: 'scheduled',
    });
    batchRequest.reject(new Error('release nonblocking test shadow permit'));
    await vi.waitFor(() => {
      expect(info).toHaveBeenCalledWith(
        '[GraphSource] graph kernel batch shadow observation',
        expect.objectContaining({
          requestId: query.requestId,
          status: 'failed',
        }),
      );
    });
    expect(observation).toEqual({ mode: 'shadow_compare', status: 'scheduled' });
  });

  it('drops a second hanging batch shadow while preserving both legacy results', async () => {
    const firstQuery = createFeedQuery('viewer-1', 10);
    const secondQuery = createFeedQuery('viewer-2', 10);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const batchRequest = deferred<never>();
    const admittedAfterRelease = deferred<never>();
    const graphKernelClient = {
      socialNeighborsWithDiagnostics: vi.fn().mockResolvedValue({
        candidates: [{ userId: 'author-1', score: 1 }],
      }),
      recentEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      bridgeUsersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      coEngagersWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      contentAffinityNeighborsWithDiagnostics: vi.fn().mockResolvedValue({ candidates: [] }),
      batch: vi.fn()
        .mockImplementationOnce(() => batchRequest.promise)
        .mockImplementation(() => admittedAfterRelease.promise),
    };
    vi.spyOn(Post as any, 'aggregate').mockReturnValue(aggregateResult([{
      _id: oid('507f191e810c19729de8b004'),
      authorId: 'author-1',
      content: 'served under shadow admission pressure',
      createdAt: new Date('2026-04-17T02:30:00.000Z'),
      isReply: false,
      isRepost: false,
      deletedAt: null,
    }]));
    const firstSource = new GraphSource({
      client: { recall: vi.fn() } as any,
      graphKernelClient: graphKernelClient as any,
      graphKernelBatchMode: 'shadow_compare',
      graphKernelBatchShadowMaxInFlight: 1,
      maxTotal: 10,
    });
    const secondSource = new GraphSource({
      client: { recall: vi.fn() } as any,
      graphKernelClient: graphKernelClient as any,
      graphKernelBatchMode: 'shadow_compare',
      graphKernelBatchShadowMaxInFlight: 1,
      maxTotal: 10,
    });

    const firstCandidates = await firstSource.getCandidates(firstQuery);
    const secondCandidates = await secondSource.getCandidates(secondQuery);

    expect(firstCandidates).toHaveLength(1);
    expect(secondCandidates).toHaveLength(1);
    expect(batchRequest.isSettled()).toBe(false);
    expect(graphKernelClient.batch).toHaveBeenCalledOnce();
    const firstObservation = firstSource.stageDetail(firstQuery, firstCandidates)
      ?.graphKernelBatchShadowCompare as Record<string, unknown>;
    expect(firstObservation).toMatchObject({
      status: 'scheduled',
    });
    expect(secondSource.stageDetail(secondQuery, secondCandidates)).toMatchObject({
      graphKernelBatchShadowCompare: {
        status: 'dropped',
        reason: 'max_in_flight',
      },
    });

    batchRequest.reject(new Error('release first shadow permit'));
    await vi.waitFor(() => {
      expect(info).toHaveBeenCalledWith(
        '[GraphSource] graph kernel batch shadow observation',
        expect.objectContaining({
          requestId: firstQuery.requestId,
          status: 'failed',
        }),
      );
    });
    expect(firstObservation).toEqual({ mode: 'shadow_compare', status: 'scheduled' });

    const thirdQuery = createFeedQuery('viewer-3', 10);
    const thirdCandidates = await secondSource.getCandidates(thirdQuery);
    expect(thirdCandidates).toHaveLength(1);
    expect(graphKernelClient.batch).toHaveBeenCalledTimes(2);
    const thirdObservation = secondSource.stageDetail(thirdQuery, thirdCandidates)
      ?.graphKernelBatchShadowCompare as Record<string, unknown>;
    expect(thirdObservation).toMatchObject({ status: 'scheduled' });
    admittedAfterRelease.reject(new Error('release final shadow permit'));
    await vi.waitFor(() => {
      expect(info).toHaveBeenCalledWith(
        '[GraphSource] graph kernel batch shadow observation',
        expect.objectContaining({
          requestId: thirdQuery.requestId,
          status: 'failed',
        }),
      );
    });
    expect(thirdObservation).toEqual({ mode: 'shadow_compare', status: 'scheduled' });
  });

  it('accepts extended graph materializer retry lookback contract', () => {
    expect(
      graphAuthorMaterializationRequestSchema.safeParse({
        authorIds: ['author-1'],
        limitPerAuthor: 8,
        lookbackDays: 180,
      }).success,
    ).toBe(true);
    expect(
      graphAuthorMaterializationRequestSchema.safeParse({
        authorIds: ['author-1'],
        lookbackDays: 181,
      }).success,
    ).toBe(false);
  });

  it('accepts an RFC3339 graph materializer continuation cursor', () => {
    const createdBefore = '2026-08-28T12:00:00.000Z';
    const parsed = graphAuthorMaterializationRequestSchema.parse({
      authorIds: ['author-materializer-cursor-1'],
      createdBefore,
    });

    expect(parsed.createdBefore).toEqual(new Date(createdBefore));
    expect(
      graphAuthorMaterializationRequestSchema.safeParse({
        authorIds: ['author-materializer-cursor-1'],
        createdBefore: 'not-a-timestamp',
      }).success,
    ).toBe(false);
  });
});
