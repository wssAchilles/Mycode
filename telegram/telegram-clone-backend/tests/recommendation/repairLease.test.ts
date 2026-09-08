import { describe, expect, it, vi } from 'vitest';

import {
  RepairLeaseCoordinator,
  RepairLeaseUnavailableError,
  repairRunId,
  type RepairLease,
  type RepairLeaseRedis,
} from '../../src/services/jobs/coordination/repairLease';

class FakeRedis implements RepairLeaseRedis {
  readonly values = new Map<string, string>();
  readonly acquireCalls: Array<readonly unknown[]> = [];
  readonly fenceCalls: string[] = [];
  failIncr = false;
  failSet = false;
  failRenew = false;
  failComplete = false;
  beforeAcquire?: () => void | Promise<void>;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<number> {
    const keys = args.slice(0, numberOfKeys).map(String);
    const argv = args.slice(numberOfKeys).map(String);

    if (script.includes('fence_token')) {
      const [leaseKey, fenceKey] = keys;
      const [ownerToken] = argv;
      this.acquireCalls.push([...keys, ...argv]);
      const beforeAcquire = this.beforeAcquire;
      this.beforeAcquire = undefined;
      await beforeAcquire?.();
      if (this.failSet) {
        throw new Error('redis acquire failed');
      }
      if (this.values.has(leaseKey)) {
        return 0;
      }
      if (this.failIncr) {
        throw new Error('redis incr failed');
      }
      const fenceToken = Number(this.values.get(fenceKey) ?? '0') + 1;
      this.fenceCalls.push(fenceKey);
      this.values.set(fenceKey, String(fenceToken));
      this.values.set(leaseKey, ownerToken);
      return fenceToken;
    }

    if (numberOfKeys === 2) {
      if (this.failComplete) {
        throw new Error('redis complete failed');
      }
      const [leaseKey, completedKey] = keys;
      const [ownerToken, result] = argv;
      if (this.values.get(leaseKey) !== ownerToken) {
        return 0;
      }
      this.values.set(completedKey, result);
      this.values.delete(leaseKey);
      return 1;
    }

    const [leaseKey] = keys;
    const [ownerToken] = argv;
    if (script.includes('PEXPIRE')) {
      if (this.failRenew) {
        throw new Error('redis renew failed');
      }
      return this.values.get(leaseKey) === ownerToken ? 1 : 0;
    }
    if (this.values.get(leaseKey) !== ownerToken) {
      return 0;
    }
    this.values.delete(leaseKey);
    return 1;
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('repair lease coordination', () => {
  it('allows only one instance to mutate the same job epoch', async () => {
    const redis = new FakeRedis();
    const firstCoordinator = new RepairLeaseCoordinator(redis);
    const secondCoordinator = new RepairLeaseCoordinator(redis);
    const started = deferred();
    const finish = deferred();
    let mutations = 0;

    const first = firstCoordinator.execute('realgraph-decay-repair', '2026-07-15', async () => {
      mutations += 1;
      started.resolve();
      await finish.promise;
      return { decayedEdges: 4 };
    });
    await started.promise;

    await expect(secondCoordinator.execute(
      'realgraph-decay-repair',
      '2026-07-15',
      async () => {
        mutations += 1;
        return { decayedEdges: 9 };
      },
    )).rejects.toBeInstanceOf(RepairLeaseUnavailableError);

    finish.resolve();
    await expect(first).resolves.toEqual({ decayedEdges: 4 });
    expect(mutations).toBe(1);
  });

  it('returns the persisted result for a completed epoch without another mutation', async () => {
    const redis = new FakeRedis();
    const coordinator = new RepairLeaseCoordinator(redis);
    const secondInstance = new RepairLeaseCoordinator(redis);
    const successEvidence = vi.fn();
    let mutations = 0;

    const first = await coordinator.execute(
      'simclusters-batch-repair',
      '2026-07-15',
      async () => {
        mutations += 1;
        return { success: 7, failed: 0 };
      },
      successEvidence,
    );
    const second = await secondInstance.execute(
      'simclusters-batch-repair',
      '2026-07-15',
      async () => {
        mutations += 1;
        return { success: 99, failed: 0 };
      },
      successEvidence,
    );

    expect(first).toEqual({ success: 7, failed: 0 });
    expect(second).toEqual(first);
    expect(mutations).toBe(1);
    expect(successEvidence).toHaveBeenCalledTimes(2);
  });

  it('does not complete a failed epoch and allows the same epoch to retry', async () => {
    const redis = new FakeRedis();
    const coordinator = new RepairLeaseCoordinator(redis);
    const successEvidence = vi.fn();
    let attempts = 0;

    await expect(coordinator.execute(
      'simclusters-batch-repair',
      'retry-failed-epoch',
      async () => {
        attempts += 1;
        throw new Error('partial repair failed');
      },
      successEvidence,
    )).rejects.toThrow('partial repair failed');

    await expect(coordinator.execute(
      'simclusters-batch-repair',
      'retry-failed-epoch',
      async () => {
        attempts += 1;
        return { success: 2, failed: 0 };
      },
      successEvidence,
    )).resolves.toEqual({ success: 2, failed: 0 });

    expect(attempts).toBe(2);
    expect(successEvidence).toHaveBeenCalledTimes(1);
  });

  it('replays failed completion evidence without rerunning the completed body', async () => {
    const redis = new FakeRedis();
    const coordinator = new RepairLeaseCoordinator(redis);
    let mutations = 0;
    let evidenceAttempts = 0;
    const writeEvidence = vi.fn(async () => {
      evidenceAttempts += 1;
      if (evidenceAttempts === 1) {
        throw new Error('mongo success evidence failed');
      }
    });

    await expect(coordinator.execute(
      'realgraph-decay-repair',
      'evidence-retry',
      async () => {
        mutations += 1;
        return { decayedEdges: 5 };
      },
      writeEvidence,
    )).rejects.toThrow('mongo success evidence failed');

    await expect(coordinator.execute(
      'realgraph-decay-repair',
      'evidence-retry',
      async () => {
        mutations += 1;
        return { decayedEdges: 99 };
      },
      writeEvidence,
    )).resolves.toEqual({ decayedEdges: 5 });
    await expect(coordinator.execute(
      'realgraph-decay-repair',
      'evidence-retry',
      async () => {
        mutations += 1;
        return { decayedEdges: 100 };
      },
      writeEvidence,
    )).resolves.toEqual({ decayedEdges: 5 });

    expect(mutations).toBe(1);
    expect(writeEvidence).toHaveBeenCalledTimes(3);
  });

  it('replays the original completion provenance without timestamp or release drift', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-15T03:00:00.000Z'));
      const redis = new FakeRedis();
      const coordinator = new RepairLeaseCoordinator(redis);
      const provenances: unknown[] = [];

      await coordinator.execute(
        'simclusters-batch-repair',
        'stable-provenance',
        async () => ({ success: 1 }),
        async (_result, provenance) => {
          provenances.push(provenance);
        },
        { trigger: 'cron', releaseTag: 'release-original' },
      );

      vi.setSystemTime(new Date('2026-07-16T18:45:00.000Z'));
      await coordinator.execute(
        'simclusters-batch-repair',
        'stable-provenance',
        async () => ({ success: 99 }),
        async (_result, provenance) => {
          provenances.push(provenance);
        },
        { trigger: 'manual', releaseTag: 'release-replay' },
      );

      expect(provenances).toHaveLength(2);
      expect(provenances[1]).toEqual(provenances[0]);
      expect(provenances[0]).toEqual(expect.objectContaining({
        attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        fenceToken: 1,
        startedAt: '2026-07-15T03:00:00.000Z',
        completedAt: '2026-07-15T03:00:00.000Z',
        trigger: 'cron',
        releaseTag: 'release-original',
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mutate when completion lands between the completed read and SET NX', async () => {
    const redis = new FakeRedis();
    const coordinator = new RepairLeaseCoordinator(redis);
    const completedKey = 'recommendation:repair-job:{repair:realgraph-decay-repair}:completed:epoch-race';
    let mutations = 0;
    redis.beforeAcquire = () => {
      redis.values.set(completedKey, JSON.stringify({
        epoch: 'epoch-race',
        result: { decayedEdges: 11 },
        provenance: {
          attemptId: 'completed-attempt',
          fenceToken: 7,
          startedAt: '2026-07-15T00:00:00.000Z',
          completedAt: '2026-07-15T00:01:00.000Z',
        },
      }));
    };

    const result = await coordinator.execute('realgraph-decay-repair', 'epoch-race', async () => {
      mutations += 1;
      return { decayedEdges: 99 };
    });

    expect(result).toEqual({ decayedEdges: 11 });
    expect(mutations).toBe(0);
    expect(redis.values.has('recommendation:repair-job:{repair:realgraph-decay-repair}:lease')).toBe(false);
  });

  it('uses job-isolated atomic leases whose value binds epoch and random owner', async () => {
    const redis = new FakeRedis();
    const coordinator = new RepairLeaseCoordinator(redis, { leaseTtlMs: 12_345 });

    const realGraph = await coordinator.acquire('realgraph-decay-repair', 'epoch-1');
    const simClusters = await coordinator.acquire('simclusters-batch-repair', 'epoch-1');

    expect(realGraph.status).toBe('acquired');
    expect(simClusters.status).toBe('acquired');
    if (realGraph.status !== 'acquired' || simClusters.status !== 'acquired') {
      throw new Error('expected acquired leases');
    }
    expect(realGraph.lease.key).not.toBe(simClusters.lease.key);
    expect(realGraph.lease.fenceToken).toBe(1);
    expect(simClusters.lease.fenceToken).toBe(1);
    expect(extractHashTag(realGraph.lease.key)).toBe('{repair:realgraph-decay-repair}');
    expect(extractHashTag(realGraph.lease.completedKey)).toBe(extractHashTag(realGraph.lease.key));
    expect(extractHashTag(simClusters.lease.completedKey)).toBe(extractHashTag(simClusters.lease.key));
    expect(JSON.parse(realGraph.lease.ownerToken)).toEqual({
      epoch: 'epoch-1',
      owner: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(redis.fenceCalls.map(extractHashTag)).toEqual([
      extractHashTag(realGraph.lease.key),
      extractHashTag(simClusters.lease.key),
    ]);
    expect(redis.acquireCalls[0]?.[3]).toBe('12345');

    await coordinator.release(realGraph.lease);
    await coordinator.release(simClusters.lease);
  });

  it('orders fence tokens by successful lease acquisition when an earlier contender is delayed', async () => {
    const redis = new FakeRedis();
    const delayedCoordinator = new RepairLeaseCoordinator(redis);
    const newerCoordinator = new RepairLeaseCoordinator(redis);
    const delayedAtAcquire = deferred();
    const allowDelayedAcquire = deferred();
    redis.beforeAcquire = async () => {
      delayedAtAcquire.resolve();
      await allowDelayedAcquire.promise;
    };

    const delayedPromise = delayedCoordinator.acquire(
      'realgraph-decay-repair',
      'epoch-delayed',
    );
    await delayedAtAcquire.promise;

    const newer = await newerCoordinator.acquire('realgraph-decay-repair', 'epoch-newer');
    expect(newer.status).toBe('acquired');
    if (newer.status !== 'acquired') {
      throw new Error('expected acquired lease');
    }
    await newerCoordinator.release(newer.lease);

    allowDelayedAcquire.resolve();
    const delayed = await delayedPromise;
    expect(delayed.status).toBe('acquired');
    if (delayed.status !== 'acquired') {
      throw new Error('expected acquired lease');
    }

    expect(newer.lease.fenceToken).toBe(1);
    expect(delayed.lease.fenceToken).toBe(2);
    expect(redis.fenceCalls).toEqual([
      'recommendation:repair-job:{repair:realgraph-decay-repair}:fence',
      'recommendation:repair-job:{repair:realgraph-decay-repair}:fence',
    ]);

    await delayedCoordinator.release(delayed.lease);
  });

  it('does not let a wrong owner renew, release, or complete a lease', async () => {
    const redis = new FakeRedis();
    const coordinator = new RepairLeaseCoordinator(redis);
    const acquired = await coordinator.acquire('realgraph-decay-repair', 'epoch-1');
    expect(acquired.status).toBe('acquired');
    if (acquired.status !== 'acquired') {
      throw new Error('expected acquired lease');
    }
    const wrongOwner: RepairLease = { ...acquired.lease, ownerToken: 'wrong-owner' };

    await expect(coordinator.renew(wrongOwner)).resolves.toBe(false);
    await expect(coordinator.release(wrongOwner)).resolves.toBe(false);
    await expect(coordinator.complete(wrongOwner, { ok: true })).resolves.toBe(false);
    expect(redis.values.get(acquired.lease.key)).toBe(acquired.lease.ownerToken);
    expect(redis.values.has(acquired.lease.completedKey)).toBe(false);

    await coordinator.release(acquired.lease);
  });

  it.each([
    ['fence', (redis: FakeRedis) => { redis.failIncr = true; }],
    ['acquire', (redis: FakeRedis) => { redis.failSet = true; }],
    ['complete', (redis: FakeRedis) => { redis.failComplete = true; }],
  ] as const)('fails closed when Redis %s fails and writes no success evidence', async (stage, fail) => {
    const redis = new FakeRedis();
    fail(redis);
    const coordinator = new RepairLeaseCoordinator(redis, {
      leaseTtlMs: 100,
      heartbeatIntervalMs: 5,
    });
    const successEvidence = vi.fn();
    await expect(coordinator.execute(
      'realgraph-decay-repair',
      '2026-07-15',
      async () => ({ ok: true as const }),
      successEvidence,
    )).rejects.toThrow();
    expect(successEvidence).not.toHaveBeenCalled();
  });

  it('aborts on heartbeat failure but waits for the body to settle before release', async () => {
    const redis = new FakeRedis();
    redis.failRenew = true;
    const coordinator = new RepairLeaseCoordinator(redis, {
      leaseTtlMs: 100,
      heartbeatIntervalMs: 5,
    });
    const bodyCanSettle = deferred();
    let bodySignal: AbortSignal | undefined;
    let executionSettled = false;
    let mutationsAfterAbort = 0;

    const execution = coordinator.execute(
      'realgraph-decay-repair',
      'heartbeat-abort',
      async (signal) => {
        bodySignal = signal;
        await bodyCanSettle.promise;
        signal.throwIfAborted();
        mutationsAfterAbort += 1;
        return { ok: true as const };
      },
    );
    const observedExecution = execution.then(
      (result) => {
        executionSettled = true;
        return result;
      },
      (error: unknown) => {
        executionSettled = true;
        throw error;
      },
    );

    await vi.waitFor(() => expect(bodySignal?.aborted).toBe(true));
    expect(executionSettled).toBe(false);
    expect(redis.values.has('recommendation:repair-job:{repair:realgraph-decay-repair}:lease')).toBe(true);

    bodyCanSettle.resolve();
    await expect(observedExecution).rejects.toThrow(/Lost ownership/);
    expect(mutationsAfterAbort).toBe(0);
    expect(redis.values.has('recommendation:repair-job:{repair:realgraph-decay-repair}:lease')).toBe(false);
  });

  it('rejects an empty logical epoch before acquiring Redis state', async () => {
    const redis = new FakeRedis();
    const coordinator = new RepairLeaseCoordinator(redis);

    await expect(coordinator.execute('realgraph-decay-repair', '  ', async () => ({ ok: true })))
      .rejects.toThrow(/epoch/i);
    expect(redis.acquireCalls).toEqual([]);
  });

  it('derives one stable Mongo ObjectId identity per repair job epoch', () => {
    const ids = Array.from({ length: 4 }, () => repairRunId(
      'realgraph-decay-repair',
      '2026-07-15',
    ));

    expect(new Set(ids)).toEqual(new Set([ids[0]]));
    expect(ids[0]).toMatch(/^[0-9a-f]{24}$/);
    expect(repairRunId('simclusters-batch-repair', '2026-07-15')).not.toBe(ids[0]);
    expect(repairRunId('realgraph-decay-repair', '2026-07-16')).not.toBe(ids[0]);
  });
});

function extractHashTag(key: string): string | undefined {
  return key.match(/\{[^}]+\}/)?.[0];
}
