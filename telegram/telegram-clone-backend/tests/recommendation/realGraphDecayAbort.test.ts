import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyDailyDecay: vi.fn(),
  jobRunUpdateOne: vi.fn(),
}));

vi.mock('../../src/models/RealGraphEdge', () => ({
  default: {
    applyDailyDecay: mocks.applyDailyDecay,
  },
  DECAY_CONFIG: { minRetainScore: 0.01 },
  REALGRAPH_FEATURE_VERSION: 'test-feature',
  REALGRAPH_MODEL_VERSION: 'test-model',
  REALGRAPH_PREDICTION_MODE: 'test-mode',
}));

vi.mock('../../src/models/RecommendationJobRun', () => ({
  default: {
    updateOne: mocks.jobRunUpdateOne,
  },
}));

vi.mock('../../src/config/redis', () => ({
  redis: {},
}));

import {
  RealGraphService,
  realGraphService,
} from '../../src/services/recommendation/RealGraphService';
import { RealGraphDecayJob } from '../../src/services/jobs/RealGraphDecayJob';

describe('RealGraph daily decay cancellation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.jobRunUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  });

  it('checks abort after each mutation and does not start another batch', async () => {
    const controller = new AbortController();
    mocks.applyDailyDecay
      .mockImplementationOnce(async () => {
        controller.abort(new Error('lease lost'));
        return 5;
      })
      .mockResolvedValueOnce(0);

    await expect(new RealGraphService().applyDailyDecay(controller.signal)).rejects.toThrow('lease lost');
    expect(mocks.applyDailyDecay).toHaveBeenCalledTimes(1);
  });

  it('fails the repair instead of completing an epoch with decay errors', async () => {
    vi.spyOn(realGraphService, 'applyDailyDecay').mockResolvedValue({
      totalProcessed: 3,
      batches: 1,
      errors: 1,
    });
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
        onCompleted?: (result: T, provenance: never) => Promise<void>,
      ): Promise<T> => {
        const result = await body(new AbortController().signal, {
          attemptId: 'attempt-errors',
          fenceToken: 1,
          startedAt: '2026-07-15T00:00:00.000Z',
        });
        completed(result);
        await onCompleted?.(result, undefined as never);
        return result;
      },
    };

    await expect(new RealGraphDecayJob(coordinator).run({
      epoch: 'decay-errors',
      skipCleanup: true,
    })).rejects.toThrow('Decay completed with mutation errors');

    expect(completed).not.toHaveBeenCalled();
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('propagates the public abort without completing a partial repair', async () => {
    let releaseMutation!: () => void;
    const decay = vi.spyOn(realGraphService, 'applyDailyDecay').mockReturnValue(
      new Promise((resolve) => {
        releaseMutation = () => resolve({ totalProcessed: 1, batches: 1, errors: 0 });
      }),
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
    const job = new RealGraphDecayJob(coordinator);
    const execution = job.run({ epoch: 'manual-abort', skipCleanup: true });
    await vi.waitFor(() => expect(decay).toHaveBeenCalled());

    job.abort();
    releaseMutation();

    await expect(execution).rejects.toThrow('Abort requested');
    expect(completed).not.toHaveBeenCalled();
    expect(mocks.jobRunUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
