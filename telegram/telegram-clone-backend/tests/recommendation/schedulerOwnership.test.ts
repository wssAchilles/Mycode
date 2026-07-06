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
import { RealGraphDecayJob } from '../../src/services/jobs/RealGraphDecayJob';
import { SimClustersBatchJob } from '../../src/services/jobs/SimClustersBatchJob';

describe('recommendation scheduler ownership', () => {
  afterEach(() => {
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
    mocks.jobRunCreate.mockResolvedValue({ _id: 'repair-run-1' });
    mocks.realGraphAggregate.mockResolvedValue([{ _id: 'user-1' }]);
    mocks.staleEmbeddingFind.mockReturnValue({
      select: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
    });
    mocks.simComputeAndStoreEmbedding.mockResolvedValue(undefined);
    mocks.applyDailyDecay.mockResolvedValue({ totalProcessed: 12, batches: 2 });
    mocks.cleanupStaleEdges.mockResolvedValue(3);

    await new SimClustersBatchJob().run({ trigger: 'manual', maxUsers: 1 });
    await new RealGraphDecayJob().run({ trigger: 'manual' });

    expect(mocks.jobRunCreate).toHaveBeenCalledWith(expect.objectContaining({
      jobName: 'simclusters-batch-repair',
      mode: 'repair',
      status: 'running',
      trigger: 'manual',
    }));
    expect(mocks.jobRunCreate).toHaveBeenCalledWith(expect.objectContaining({
      jobName: 'realgraph-decay-repair',
      mode: 'repair',
      status: 'running',
      trigger: 'manual',
    }));
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      { _id: 'repair-run-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'success',
          counts: expect.objectContaining({ success: 1, failed: 0, skipped: 0 }),
          summary: expect.objectContaining({ mode: 'repair' }),
        }),
      }),
    );
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      { _id: 'repair-run-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'success',
          counts: expect.objectContaining({ decayedEdges: 12, cleanedEdges: 3, batches: 2 }),
          summary: expect.objectContaining({ mode: 'repair' }),
        }),
      }),
    );
  });
});
