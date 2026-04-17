import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import { GraphSource } from '../../src/services/recommendation/sources/GraphSource';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('GraphSource graph kernel orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('combines social, recent, and bridge graph-kernel signals into ranked candidates', async () => {
    const query = createFeedQuery('viewer-1', 10);
    query.userFeatures = {
      followedUserIds: [],
      blockedUserIds: ['blocked-user'],
      mutedKeywords: [],
      seenPostIds: [],
    };

    const graphKernelClient = {
      socialNeighbors: vi.fn().mockResolvedValue([
        {
          userId: 'author-1',
          score: 8,
          engagementScore: 6,
          recentnessScore: 0.4,
          relationKinds: ['follow', 'reply'],
        },
      ]),
      recentEngagers: vi.fn().mockResolvedValue([
        {
          userId: 'author-1',
          score: 3,
          engagementScore: 7,
          recentnessScore: 0.9,
          relationKinds: ['recent_activity'],
        },
      ]),
      bridgeUsers: vi.fn().mockResolvedValue([
        {
          userId: 'author-2',
          score: 4,
          depth: 2,
          pathCount: 3,
          viaUserIds: ['bridge-a', 'bridge-b'],
          bridgeStrength: 6.5,
          viaUserCount: 2,
        },
      ]),
    };

    const legacyClient = {
      recall: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(Post as any, 'aggregate').mockResolvedValue([
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
    ]);

    const source = new GraphSource({
      client: legacyClient as any,
      graphKernelClient: graphKernelClient as any,
      maxTotal: 10,
    });

    const candidates = await source.getCandidates(query);

    expect(graphKernelClient.socialNeighbors).toHaveBeenCalledOnce();
    expect(graphKernelClient.recentEngagers).toHaveBeenCalledOnce();
    expect(graphKernelClient.bridgeUsers).toHaveBeenCalledOnce();
    expect(legacyClient.recall).not.toHaveBeenCalled();

    expect(candidates).toHaveLength(2);
    expect(candidates[0].authorId).toBe('author-1');
    expect(candidates[0].recallSource).toBe('GraphKernelSource');
    expect(candidates[0].graphRecallType).toBe('cpp_graph_multi_signal');
    expect(candidates[0].graphPath).toContain('cpp_graph_social_neighbor');
    expect(candidates[0].graphPath).toContain('cpp_graph_recent_engager');
    expect(candidates[0].graphPath).toContain('relations:follow|recent_activity|reply');

    expect(candidates[1].authorId).toBe('author-2');
    expect(candidates[1].graphRecallType).toBe('cpp_graph_bridge_user');
    expect(candidates[1].graphPath).toContain('via_users:bridge-a|bridge-b');
  });
});
