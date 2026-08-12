import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTopConnections: vi.fn(),
  getUserEmbeddingsBatch: vi.fn(),
  findOne: vi.fn(),
  upsertEmbedding: vi.fn(),
  redisDel: vi.fn(),
  invalidateUserEmbedding: vi.fn(),
  aggregate: vi.fn(),
  featureFind: vi.fn(),
  jobRunUpdateOne: vi.fn(),
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
  default: {
    getTopConnections: mocks.getTopConnections,
    find: vi.fn(),
    aggregate: mocks.aggregate,
  },
}));

vi.mock('../../src/models/UserFeatureVector', () => ({
  default: {
    getUserEmbeddingsBatch: mocks.getUserEmbeddingsBatch,
    findOne: mocks.findOne,
    upsertEmbedding: mocks.upsertEmbedding,
    find: mocks.featureFind,
  },
}));

vi.mock('../../src/models/RecommendationJobRun', () => ({
  default: {
    updateOne: mocks.jobRunUpdateOne,
  },
}));

vi.mock('../../src/config/redis', () => ({
  redis: {
    del: mocks.redisDel,
  },
}));

vi.mock('../../src/services/recommendation/FeatureCacheService', () => ({
  FeatureCacheService: {
    getInstance: () => ({ invalidateUserEmbedding: mocks.invalidateUserEmbedding }),
  },
}));

import {
  SimClustersService,
  simClustersService,
} from '../../src/services/recommendation/SimClustersService';
import { SimClustersBatchJob } from '../../src/services/jobs/SimClustersBatchJob';

describe('SimClusters cancellation propagation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.jobRunUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  });

  it('passes signal through reads and stops cache mutations after an aborted upsert', async () => {
    const controller = new AbortController();
    const versionQuery = {
      lean: vi.fn(async () => null),
    };
    mocks.findOne.mockReturnValue(versionQuery);
    mocks.upsertEmbedding.mockImplementation(async () => {
      controller.abort(new Error('lease lost during embedding write'));
      return { userId: 'user-1' };
    });
    const service = new SimClustersService();
    vi.spyOn(service, 'computeInterestedIn').mockResolvedValue([]);
    vi.spyOn(service, 'computeProducerEmbedding').mockResolvedValue([]);

    await expect(service.computeAndStoreEmbedding('user-1', controller.signal))
      .rejects.toThrow('lease lost during embedding write');

    expect(mocks.findOne).toHaveBeenCalledWith(
      { userId: 'user-1' },
      null,
      { signal: controller.signal },
    );
    expect(mocks.upsertEmbedding).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      1,
      controller.signal,
    );
    expect(mocks.redisDel).not.toHaveBeenCalled();
    expect(mocks.invalidateUserEmbedding).not.toHaveBeenCalled();
  });

  it('passes signal through InterestedIn graph and embedding reads', async () => {
    const controller = new AbortController();
    mocks.getTopConnections.mockResolvedValue([{
      targetUserId: 'followed-user',
      decayedSum: 1,
    }]);
    mocks.getUserEmbeddingsBatch.mockResolvedValue(new Map());

    await new SimClustersService().computeInterestedIn('user-1', controller.signal);

    expect(mocks.getTopConnections).toHaveBeenCalledWith('user-1', expect.any(Number), controller.signal);
    expect(mocks.getUserEmbeddingsBatch).toHaveBeenCalledWith(['followed-user'], controller.signal);
  });

  it('waits for in-flight cache invalidations and passes their abort signal', async () => {
    const controller = new AbortController();
    let resolveRedis!: () => void;
    let resolveFeature!: () => void;
    mocks.findOne.mockReturnValue({ lean: vi.fn(async () => null) });
    mocks.upsertEmbedding.mockResolvedValue({ userId: 'user-1' });
    mocks.redisDel.mockReturnValue(new Promise<void>((resolve) => { resolveRedis = resolve; }));
    mocks.invalidateUserEmbedding.mockReturnValue(
      new Promise<void>((resolve) => { resolveFeature = resolve; }),
    );
    const service = new SimClustersService();
    vi.spyOn(service, 'computeInterestedIn').mockResolvedValue([]);
    vi.spyOn(service, 'computeProducerEmbedding').mockResolvedValue([]);
    let settled = false;

    const execution = service.computeAndStoreEmbedding('user-1', controller.signal)
      .finally(() => { settled = true; });
    await vi.waitFor(() => expect(mocks.invalidateUserEmbedding).toHaveBeenCalled());
    controller.abort(new Error('lease lost during cache invalidation'));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mocks.invalidateUserEmbedding).toHaveBeenCalledWith('user-1', controller.signal);

    resolveRedis();
    resolveFeature();
    await expect(execution).rejects.toThrow('lease lost during cache invalidation');
  });

  it('fails the epoch when any user repair fails', async () => {
    mocks.aggregate.mockResolvedValue([{ _id: 'user-1' }]);
    mocks.featureFind.mockReturnValue({ select: vi.fn().mockResolvedValue([]) });
    vi.spyOn(simClustersService, 'computeAndStoreEmbedding').mockRejectedValue(new Error('user failed'));
    const completed = vi.fn();
    const coordinator = {
      execute: async <T>(
        _jobName: string,
        _epoch: string,
        body: (signal: AbortSignal, attempt: {
          attemptId: string;
          fenceToken: number;
          startedAt: string;
        }) => Promise<T>,
      ): Promise<T> => {
        const result = await body(new AbortController().signal, {
          attemptId: 'attempt-failure',
          fenceToken: 1,
          startedAt: '2026-07-15T00:00:00.000Z',
        });
        completed(result);
        return result;
      },
    };

    await expect(new SimClustersBatchJob(coordinator).run({
      epoch: 'user-failure',
      maxUsers: 1,
    })).rejects.toThrow('Batch completed with user failures');

    expect(completed).not.toHaveBeenCalled();
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('propagates the public abort without completing a partial batch', async () => {
    mocks.aggregate.mockResolvedValue([{ _id: 'user-1' }]);
    mocks.featureFind.mockReturnValue({ select: vi.fn().mockResolvedValue([]) });
    let releaseUser!: () => void;
    vi.spyOn(simClustersService, 'computeAndStoreEmbedding').mockReturnValue(
      new Promise((resolve) => { releaseUser = () => resolve(undefined); }),
    );
    const completed = vi.fn();
    const coordinator = {
      execute: async <T>(
        _jobName: string,
        _epoch: string,
        body: (signal: AbortSignal, attempt: {
          attemptId: string;
          fenceToken: number;
          startedAt: string;
        }) => Promise<T>,
      ): Promise<T> => {
        const result = await body(new AbortController().signal, {
          attemptId: 'attempt-abort',
          fenceToken: 1,
          startedAt: '2026-07-15T00:00:00.000Z',
        });
        completed(result);
        return result;
      },
    };
    const job = new SimClustersBatchJob(coordinator);
    const execution = job.run({ epoch: 'manual-abort', maxUsers: 1 });
    await vi.waitFor(() => expect(simClustersService.computeAndStoreEmbedding).toHaveBeenCalled());

    job.abort();
    releaseUser();

    await expect(execution).rejects.toThrow('Abort requested');
    expect(completed).not.toHaveBeenCalled();
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
