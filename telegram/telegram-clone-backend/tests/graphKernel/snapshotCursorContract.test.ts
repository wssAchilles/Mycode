import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

import RealGraphEdge from '../../src/models/RealGraphEdge';
import {
  GraphKernelSnapshotVersionMismatchError,
  graphKernelSnapshotService,
} from '../../src/services/graphKernel/snapshotService';

vi.mock('../../src/models/RealGraphEdge', () => ({
  default: {
    find: vi.fn(),
    findOne: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

function queryReturning<T>(value: T) {
  return {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

describe('graph kernel snapshot cursor contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a keyset cursor and rejects snapshot version drift', async () => {
    const firstEdgeId = new Types.ObjectId('65f000000000000000000101');
    const latestEdgeId = new Types.ObjectId('65f000000000000000000201');
    const latestQuery = queryReturning({
      _id: latestEdgeId,
      updatedAt: new Date('2026-07-06T00:00:00.000Z'),
    });
    const pageQuery = queryReturning([
      {
        _id: firstEdgeId,
        sourceUserId: 'source-1',
        targetUserId: 'target-1',
        decayedSum: 0.9,
        interactionProbability: 0.7,
        dailyCounts: { likeCount: 1 },
        rollupCounts: { followCount: 1 },
        updatedAt: new Date('2026-07-05T00:00:00.000Z'),
      },
    ]);
    vi.mocked(RealGraphEdge.findOne).mockReturnValue(latestQuery as any);
    vi.mocked(RealGraphEdge.find).mockReturnValue(pageQuery as any);
    vi.mocked(RealGraphEdge.countDocuments).mockResolvedValue(2 as never);

    const page = await graphKernelSnapshotService.getSnapshotPage({
      limit: 1,
      minScore: 0.05,
    });

    expect(page.snapshotVersion).toBe(`graph_snapshot_v2:1783296000000:${latestEdgeId}:2`);
    expect(page.nextCursor).toEqual({
      afterSourceUserId: 'source-1',
      afterTargetUserId: 'target-1',
      afterId: String(firstEdgeId),
    });
    expect(page.nextOffset).toBe(1);

    const nextQuery = queryReturning([]);
    vi.mocked(RealGraphEdge.find).mockReturnValue(nextQuery as any);
    await graphKernelSnapshotService.getSnapshotPage({
      limit: 1,
      minScore: 0.05,
      snapshotVersion: page.snapshotVersion,
      ...page.nextCursor,
    });

    expect(RealGraphEdge.find).toHaveBeenLastCalledWith({
      decayedSum: { $gte: 0.05 },
      $or: [
        { sourceUserId: { $gt: 'source-1' } },
        {
          sourceUserId: 'source-1',
          targetUserId: { $gt: 'target-1' },
        },
        {
          sourceUserId: 'source-1',
          targetUserId: 'target-1',
          _id: { $gt: firstEdgeId },
        },
      ],
    });
    expect(nextQuery.skip).not.toHaveBeenCalled();

    await expect(
      graphKernelSnapshotService.getSnapshotPage({
        limit: 1,
        minScore: 0.05,
        snapshotVersion: 'graph_snapshot_v2:stale',
        ...page.nextCursor,
      }),
    ).rejects.toBeInstanceOf(GraphKernelSnapshotVersionMismatchError);
  });
});
