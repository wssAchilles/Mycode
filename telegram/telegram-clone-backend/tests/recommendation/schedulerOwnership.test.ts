import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cronSchedule: vi.fn(),
  simComputeAndStoreEmbedding: vi.fn(),
  staleEmbeddingFind: vi.fn(),
  realGraphAggregate: vi.fn(),
  applyDailyDecay: vi.fn(),
  cleanupStaleEdges: vi.fn(),
  jobRunCreate: vi.fn(),
  jobRunUpdateOne: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: mocks.cronSchedule,
  },
}));

vi.mock('../../src/services/spaceService', () => ({
  spaceService: {
    cleanupOldNews: vi.fn(),
  },
}));

vi.mock('../../src/services/newsService', () => ({
  newsService: {
    cleanup: vi.fn(),
    updateUserVectors: vi.fn(),
  },
}));

vi.mock('../../src/services/recommendation/newsMaterialization', () => ({
  newsMaterializationService: {
    materialize: vi.fn(),
  },
}));

vi.mock('../../src/services/jobs/DailyRecommendationRefreshJob', () => ({
  dailyRecommendationRefreshJob: {
    run: vi.fn(),
  },
}));

vi.mock('../../src/services/recommendation/SimClustersService', () => ({
  simClustersService: {
    computeAndStoreEmbedding: mocks.simComputeAndStoreEmbedding,
  },
}));

vi.mock('../../src/services/recommendation/RealGraphService', () => ({
  realGraphService: {
    applyDailyDecay: mocks.applyDailyDecay,
    cleanupStaleEdges: mocks.cleanupStaleEdges,
  },
}));

vi.mock('../../src/models/UserFeatureVector', () => ({
  default: {
    find: mocks.staleEmbeddingFind,
  },
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
  default: {
    aggregate: mocks.realGraphAggregate,
    countDocuments: vi.fn(),
  },
  DECAY_CONFIG: {
    minRetainScore: 0.01,
  },
}));

vi.mock('../../src/models/RecommendationJobRun', () => ({
  default: {
    create: mocks.jobRunCreate,
    updateOne: mocks.jobRunUpdateOne,
  },
}));

vi.mock('../../src/services/controlPlane/runtimeControlPlane', () => ({
  runtimeControlPlane: {
    markUnit: vi.fn(),
  },
  LifecyclePhase: {
    RUNTIME: 'runtime',
  },
  LifecycleStatus: {
    RUNNING: 'running',
  },
}));

import {
  buildRecommendationSchedulePlan,
  registerCronJobs,
} from '../../src/bootstrap/scheduler';
import { RealGraphDecayJob, realGraphDecayJob } from '../../src/services/jobs/RealGraphDecayJob';
import { SimClustersBatchJob, simClustersBatchJob } from '../../src/services/jobs/SimClustersBatchJob';
import { repairRunId } from '../../src/services/jobs/coordination/repairLease';

describe('recommendation scheduler ownership', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.RECOMMENDATION_REPAIR_JOBS_ENABLED;
  });

  it('uses daily refresh as the only default RealGraph and SimClusters scheduled owner', () => {
    const plan = buildRecommendationSchedulePlan({ enableRepairJobs: false });

    expect(plan.defaultJobs.map((job) => job.name)).toContain('daily-recommendation-refresh');
    expect(plan.defaultJobs.map((job) => job.name)).not.toContain('realgraph-decay-repair');
    expect(plan.defaultJobs.map((job) => job.name)).not.toContain('simclusters-batch-repair');
    expect(plan.repairJobs).toEqual([]);
  });

  it('registers repair cron jobs only behind the explicit repair flag', () => {
    registerCronJobs();
    expect(mocks.cronSchedule.mock.calls.map((call) => call[0])).toEqual([
      '0 0 * * *',
      '30 0 * * *',
      '0 1 * * *',
      '20 1 * * *',
      '0 2 * * *',
    ]);

    vi.clearAllMocks();
    process.env.RECOMMENDATION_REPAIR_JOBS_ENABLED = 'true';
    registerCronJobs();

    expect(mocks.cronSchedule.mock.calls.map((call) => call[0])).toEqual([
      '0 0 * * *',
      '30 0 * * *',
      '0 1 * * *',
      '20 1 * * *',
      '0 2 * * *',
      '0 3 * * *',
      '0 4 * * *',
    ]);
  });

  it('persists repair-mode evidence for standalone repair jobs', async () => {
    mocks.jobRunUpdateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });
    mocks.realGraphAggregate.mockResolvedValue([{ _id: 'user-1' }]);
    mocks.staleEmbeddingFind.mockReturnValue({
      select: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
    });
    mocks.simComputeAndStoreEmbedding.mockResolvedValue(undefined);
    mocks.applyDailyDecay.mockResolvedValue({ totalProcessed: 12, batches: 2 });
    mocks.cleanupStaleEdges.mockResolvedValue(3);

    const coordinator = {
      execute: async <T>(
        _jobName: string,
        _epoch: string,
        body: (
          signal: AbortSignal,
          attempt: { attemptId: string; fenceToken: number; startedAt: string },
        ) => Promise<T>,
        onCompleted?: (
          result: T,
          provenance: {
            attemptId: string;
            fenceToken: number;
            startedAt: string;
            completedAt: string;
            trigger: string;
          },
        ) => Promise<void>,
      ): Promise<T> => {
        const attempt = {
          attemptId: `attempt-${_jobName}`,
          fenceToken: 1,
          startedAt: '2026-07-15T00:00:00.000Z',
        };
        const result = await body(new AbortController().signal, attempt);
        await onCompleted?.(result, {
          ...attempt,
          completedAt: '2026-07-15T00:01:00.000Z',
          trigger: 'manual',
        });
        return result;
      },
    };

    await new SimClustersBatchJob(coordinator).run({
      epoch: 'manual-epoch-1',
      trigger: 'manual',
      maxUsers: 1,
    });
    await new RealGraphDecayJob(coordinator).run({ epoch: 'manual-epoch-1', trigger: 'manual' });

    expect(mocks.jobRunCreate).not.toHaveBeenCalled();
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      {
        _id: repairRunId('simclusters-batch-repair', 'manual-epoch-1'),
        status: { $ne: 'success' },
        $or: [
          { 'summary.fenceToken': { $lt: 1 } },
          { 'summary.fenceToken': { $exists: false } },
        ],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          jobName: 'simclusters-batch-repair',
          mode: 'repair',
          status: 'running',
          trigger: 'manual',
          summary: expect.objectContaining({
            attemptId: 'attempt-simclusters-batch-repair',
            fenceToken: 1,
          }),
        }),
      }),
      { upsert: true, signal: expect.any(AbortSignal) },
    );
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      {
        _id: repairRunId('realgraph-decay-repair', 'manual-epoch-1'),
        status: { $ne: 'success' },
        $or: [
          { 'summary.fenceToken': { $lt: 1 } },
          { 'summary.fenceToken': { $exists: false } },
        ],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          jobName: 'realgraph-decay-repair',
          mode: 'repair',
          status: 'running',
          trigger: 'manual',
          summary: expect.objectContaining({
            attemptId: 'attempt-realgraph-decay-repair',
            fenceToken: 1,
          }),
        }),
      }),
      { upsert: true, signal: expect.any(AbortSignal) },
    );
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      {
        _id: repairRunId('simclusters-batch-repair', 'manual-epoch-1'),
        $or: [
          {
            'summary.attemptId': 'attempt-simclusters-batch-repair',
            'summary.fenceToken': 1,
          },
          { 'summary.fenceToken': { $lt: 1 } },
          {
            status: { $exists: false },
            'summary.fenceToken': { $exists: false },
          },
        ],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'success',
          counts: expect.objectContaining({ success: 1, failed: 0, skipped: 0 }),
          summary: expect.objectContaining({
            mode: 'repair',
            epoch: 'manual-epoch-1',
            fenceToken: 1,
          }),
        }),
      }),
      { upsert: true },
    );
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      {
        _id: repairRunId('realgraph-decay-repair', 'manual-epoch-1'),
        $or: [
          {
            'summary.attemptId': 'attempt-realgraph-decay-repair',
            'summary.fenceToken': 1,
          },
          { 'summary.fenceToken': { $lt: 1 } },
          {
            status: { $exists: false },
            'summary.fenceToken': { $exists: false },
          },
        ],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'success',
          counts: expect.objectContaining({ decayedEdges: 12, cleanedEdges: 3, batches: 2 }),
          summary: expect.objectContaining({
            mode: 'repair',
            epoch: 'manual-epoch-1',
            fenceToken: 1,
          }),
        }),
      }),
      { upsert: true },
    );
  });

  it('passes the same UTC daily epoch algorithm to both repair cron owners', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T23:30:00.000Z'));
    process.env.RECOMMENDATION_REPAIR_JOBS_ENABLED = 'true';
    const simRun = vi.spyOn(simClustersBatchJob, 'run').mockResolvedValue({
      success: 1,
      failed: 0,
      skipped: 0,
      durationMs: 1,
    });
    const realRun = vi.spyOn(realGraphDecayJob, 'run').mockResolvedValue({
      decayedEdges: 1,
      cleanedEdges: 0,
      batches: 1,
      durationMs: 1,
    });

    registerCronJobs();
    const scheduled = mocks.cronSchedule.mock.calls;
    await scheduled.find((call) => call[0] === '0 3 * * *')?.[1]();
    await scheduled.find((call) => call[0] === '0 4 * * *')?.[1]();

    expect(simRun).toHaveBeenCalledWith({ trigger: 'cron', epoch: '2026-07-15' });
    expect(realRun).toHaveBeenCalledWith({ trigger: 'cron', epoch: '2026-07-15' });
  });

  it('does not enter repair mutations with an aborted coordinator signal', async () => {
    mocks.jobRunCreate.mockResolvedValue({ _id: 'aborted-run' });
    mocks.realGraphAggregate.mockResolvedValue([{ _id: 'user-1' }]);
    mocks.staleEmbeddingFind.mockReturnValue({
      select: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
    });
    mocks.simComputeAndStoreEmbedding.mockResolvedValue(undefined);
    mocks.applyDailyDecay.mockResolvedValue({ totalProcessed: 1, batches: 1 });
    const coordinator = {
      execute: async <T>(
        _jobName: string,
        _epoch: string,
        body: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> => {
        const controller = new AbortController();
        controller.abort(new Error('lease lost'));
        return body(controller.signal);
      },
    };

    await expect(new SimClustersBatchJob(coordinator).run({
      epoch: 'aborted-epoch',
      maxUsers: 1,
    })).rejects.toThrow();
    await expect(new RealGraphDecayJob(coordinator).run({
      epoch: 'aborted-epoch',
    })).rejects.toThrow();

    expect(mocks.simComputeAndStoreEmbedding).not.toHaveBeenCalled();
    expect(mocks.applyDailyDecay).not.toHaveBeenCalled();
  });

  it('repairs stable epoch success evidence after completed-result replay', async () => {
    mocks.applyDailyDecay.mockResolvedValue({ totalProcessed: 12, batches: 2 });
    mocks.cleanupStaleEdges.mockResolvedValue(3);
    let completedResult: {
      decayedEdges: number;
      cleanedEdges: number;
      batches: number;
      durationMs: number;
    } | undefined;
    let successFailures = 0;
    let evidenceExists = false;
    const evidenceIds: string[] = [];
    mocks.jobRunUpdateOne.mockImplementation(async (filter, update, options) => {
      evidenceIds.push(String(filter?._id));
      if (update?.$set?.status === 'running') {
        evidenceExists = true;
        return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
      }
      if (update?.$set?.status === 'success' && successFailures === 0) {
        successFailures += 1;
        throw new Error('success evidence unavailable');
      }
      const existed = evidenceExists;
      evidenceExists = true;
      return {
        acknowledged: true,
        matchedCount: existed ? 1 : 0,
        upsertedCount: !existed && options?.upsert ? 1 : 0,
      };
    });
    const originalProvenance = {
      attemptId: 'attempt-original',
      fenceToken: 7,
      startedAt: '2026-07-15T03:00:00.000Z',
      completedAt: '2026-07-15T03:00:02.000Z',
      trigger: 'script',
      releaseTag: 'release-original',
    };
    const coordinator = {
      execute: async <T>(
        _jobName: string,
        _epoch: string,
        body: (
          signal: AbortSignal,
          attempt: { attemptId: string; fenceToken: number; startedAt: string },
        ) => Promise<T>,
        onCompleted?: (result: T, provenance: typeof originalProvenance) => Promise<void>,
      ): Promise<T> => {
        if (!completedResult) {
          completedResult = await body(
            new AbortController().signal,
            originalProvenance,
          ) as typeof completedResult;
        }
        await onCompleted?.(completedResult as T, originalProvenance);
        return completedResult as T;
      },
    };
    const job = new RealGraphDecayJob(coordinator);

    const previousRelease = process.env.RELEASE_TAG;
    process.env.RELEASE_TAG = 'release-original';
    await expect(job.run({ epoch: 'stable-evidence', trigger: 'script' }))
      .rejects.toThrow('success evidence unavailable');
    process.env.RELEASE_TAG = 'release-replay';
    evidenceExists = false;
    await expect(job.run({ epoch: 'stable-evidence', trigger: 'manual' }))
      .resolves.toMatchObject({ decayedEdges: 12 });
    await expect(job.run({ epoch: 'stable-evidence', trigger: 'manual' }))
      .resolves.toMatchObject({ decayedEdges: 12 });
    if (previousRelease === undefined) {
      delete process.env.RELEASE_TAG;
    } else {
      process.env.RELEASE_TAG = previousRelease;
    }

    expect(mocks.applyDailyDecay).toHaveBeenCalledTimes(1);
    expect(mocks.jobRunCreate).not.toHaveBeenCalled();
    expect(new Set(evidenceIds)).toEqual(new Set([
      repairRunId('realgraph-decay-repair', 'stable-evidence'),
    ]));
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      {
        _id: repairRunId('realgraph-decay-repair', 'stable-evidence'),
        $or: [
          {
            'summary.attemptId': originalProvenance.attemptId,
            'summary.fenceToken': originalProvenance.fenceToken,
          },
          { 'summary.fenceToken': { $lt: originalProvenance.fenceToken } },
          {
            status: { $exists: false },
            'summary.fenceToken': { $exists: false },
          },
        ],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          jobName: 'realgraph-decay-repair',
          mode: 'repair',
          status: 'success',
          startedAt: new Date(originalProvenance.startedAt),
          finishedAt: new Date(originalProvenance.completedAt),
          trigger: 'script',
          releaseTag: 'release-original',
          summary: expect.objectContaining({ epoch: 'stable-evidence', fenceToken: 7 }),
        }),
      }),
      { upsert: true },
    );
    expect(mocks.jobRunUpdateOne.mock.calls.filter((call) => call[1]?.$set?.status === 'failed'))
      .toHaveLength(0);
  });

  it('rejects an older running write that arrives after a newer owner', async () => {
    type EvidenceState = {
      status: string;
      attemptId: string;
      fenceToken: number;
    };
    let evidenceState: EvidenceState | undefined;
    const matchesValue = (actual: unknown, expected: unknown): boolean => {
      if (!expected || typeof expected !== 'object') {
        return actual === expected;
      }
      const operator = expected as Record<string, unknown>;
      if ('$ne' in operator) {
        return actual !== operator.$ne;
      }
      if ('$lt' in operator) {
        return typeof actual === 'number'
          && typeof operator.$lt === 'number'
          && actual < operator.$lt;
      }
      if ('$exists' in operator) {
        return (actual !== undefined) === operator.$exists;
      }
      return false;
    };
    const matchesFilter = (
      filter: Record<string, unknown>,
      current: EvidenceState,
    ): boolean => Object.entries(filter).every(([key, expected]) => {
      if (key === '_id') {
        return true;
      }
      if (key === '$or') {
        return (expected as Array<Record<string, unknown>>)
          .some((clause) => matchesFilter(clause, current));
      }
      const actual = key === 'status'
        ? current.status
        : key === 'summary.attemptId'
          ? current.attemptId
          : key === 'summary.fenceToken'
            ? current.fenceToken
            : undefined;
      return matchesValue(actual, expected);
    });
    mocks.jobRunUpdateOne.mockImplementation(async (filter, update, options) => {
      const matched = evidenceState
        ? matchesFilter(filter as Record<string, unknown>, evidenceState)
        : false;
      const inserted = !evidenceState && Boolean(options?.upsert);
      if (!matched && !inserted) {
        return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };
      }
      evidenceState = {
        status: update.$set.status,
        attemptId: update.$set.summary.attemptId,
        fenceToken: update.$set.summary.fenceToken,
      };
      return {
        acknowledged: true,
        matchedCount: matched ? 1 : 0,
        upsertedCount: inserted ? 1 : 0,
      };
    });

    let notifyNewerStarted!: () => void;
    const newerStarted = new Promise<void>((resolve) => {
      notifyNewerStarted = resolve;
    });
    let allowNewerToFinish!: () => void;
    const newerCanFinish = new Promise<void>((resolve) => {
      allowNewerToFinish = resolve;
    });
    let mutationCalls = 0;
    mocks.applyDailyDecay.mockImplementation(async () => {
      mutationCalls += 1;
      if (mutationCalls === 1) {
        notifyNewerStarted();
        await newerCanFinish;
        return { totalProcessed: 12, batches: 2 };
      }
      throw new Error('stale owner entered the mutation path');
    });
    mocks.cleanupStaleEdges.mockResolvedValue(0);

    const coordinatorFor = (
      attemptId: string,
      fenceToken: number,
    ) => ({
      execute: async <T>(
        _jobName: string,
        _epoch: string,
        body: (
          signal: AbortSignal,
          attempt: { attemptId: string; fenceToken: number; startedAt: string },
        ) => Promise<T>,
        onCompleted?: (
          result: T,
          provenance: {
            attemptId: string;
            fenceToken: number;
            startedAt: string;
            completedAt: string;
            trigger: string;
          },
        ) => Promise<void>,
      ): Promise<T> => {
        const attempt = {
          attemptId,
          fenceToken,
          startedAt: '2026-07-15T03:00:00.000Z',
        };
        const result = await body(new AbortController().signal, attempt);
        await onCompleted?.(result, {
          ...attempt,
          completedAt: '2026-07-15T03:00:02.000Z',
          trigger: 'manual',
        });
        return result;
      },
    });

    const newerRun = new RealGraphDecayJob(coordinatorFor('attempt-newer', 2))
      .run({ epoch: 'late-running-write' });
    await newerStarted;

    await expect(new RealGraphDecayJob(coordinatorFor('attempt-older', 1))
      .run({ epoch: 'late-running-write' }))
      .rejects.toThrow();
    const stateAfterOlderWrite = evidenceState && { ...evidenceState };

    allowNewerToFinish();
    await expect(newerRun).resolves.toMatchObject({ decayedEdges: 12 });

    expect(stateAfterOlderWrite).toEqual({
      status: 'running',
      attemptId: 'attempt-newer',
      fenceToken: 2,
    });
    expect(evidenceState).toEqual({
      status: 'success',
      attemptId: 'attempt-newer',
      fenceToken: 2,
    });
    expect(mocks.applyDailyDecay).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale attempt overwrite a newer successful evidence row', async () => {
    const evidenceState = { status: 'missing', attemptId: '', fenceToken: 0 };
    mocks.jobRunUpdateOne.mockImplementation(async (filter, update) => {
      const nextStatus = update?.$set?.status;
      if (nextStatus === 'running') {
        evidenceState.status = 'running';
        evidenceState.attemptId = update.$set.summary.attemptId ?? 'unfenced';
        evidenceState.fenceToken = update.$set.summary.fenceToken ?? 0;
        return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
      }
      if (nextStatus === 'failed') {
        const matchesFence = filter?.status === 'running'
          && filter?.['summary.attemptId'] === evidenceState.attemptId
          && filter?.['summary.fenceToken'] === evidenceState.fenceToken;
        if (matchesFence) {
          evidenceState.status = 'failed';
        } else if (!filter?.status && !filter?.['summary.attemptId']) {
          evidenceState.status = 'failed';
        }
        return {
          acknowledged: true,
          matchedCount: matchesFence ? 1 : 0,
          upsertedCount: 0,
        };
      }
      return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
    });
    mocks.applyDailyDecay.mockImplementation(async () => {
      evidenceState.status = 'success';
      evidenceState.attemptId = 'attempt-newer';
      evidenceState.fenceToken = 2;
      throw new Error('old attempt body failed late');
    });
    const coordinator = {
      execute: async <T>(
        _jobName: string,
        _epoch: string,
        body: (
          signal: AbortSignal,
          attempt: { attemptId: string; fenceToken: number; startedAt: string },
        ) => Promise<T>,
      ): Promise<T> => body(new AbortController().signal, {
        attemptId: 'attempt-stale',
        fenceToken: 1,
        startedAt: '2026-07-15T03:00:00.000Z',
      }),
    };

    await expect(new RealGraphDecayJob(coordinator).run({ epoch: 'stale-attempt' }))
      .rejects.toThrow();

    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      {
        _id: repairRunId('realgraph-decay-repair', 'stale-attempt'),
        status: 'running',
        'summary.attemptId': 'attempt-stale',
        'summary.fenceToken': 1,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          summary: expect.objectContaining({
            attemptId: 'attempt-stale',
            fenceToken: 1,
          }),
        }),
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(evidenceState).toEqual({
      status: 'success',
      attemptId: 'attempt-newer',
      fenceToken: 2,
    });
  });
});
