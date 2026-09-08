import { createHash, randomUUID } from 'node:crypto';

import { redis } from '../../../config/redis';

const KEY_PREFIX = 'recommendation:repair-job';
const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

const ACQUIRE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
local fence_token = redis.call('INCR', KEYS[2])
local acquired = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
if not acquired then
  return 0
end
return fence_token
`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const COMPLETE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('DEL', KEYS[1])
return 1
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface RepairLeaseRedis {
  get(key: string): Promise<string | null>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RepairLease {
  key: string;
  completedKey: string;
  ownerToken: string;
  epoch: string;
  attemptId: string;
  fenceToken: number;
}

export interface RepairExecutionAttempt {
  attemptId: string;
  fenceToken: number;
  startedAt: string;
}

export interface RepairCompletionProvenance extends RepairExecutionAttempt {
  completedAt: string;
  trigger?: string;
  releaseTag?: string;
}

export interface RepairExecutionMetadata {
  trigger?: string;
  releaseTag?: string;
}

interface StoredCompletion<T> {
  epoch: string;
  result: T;
  provenance: RepairCompletionProvenance;
}

type AcquireResult<T> =
  | { status: 'acquired'; lease: RepairLease }
  | { status: 'completed'; completion: StoredCompletion<T> }
  | { status: 'busy' };

export interface RepairJobCoordinator {
  execute<T>(
    jobName: string,
    epoch: string,
    body: (signal: AbortSignal, attempt: RepairExecutionAttempt) => Promise<T>,
    onCompleted?: (result: T, provenance: RepairCompletionProvenance) => Promise<void>,
    metadata?: RepairExecutionMetadata,
  ): Promise<T>;
}

export class RepairLeaseUnavailableError extends Error {
  constructor(jobName: string, epoch: string) {
    super(`[RepairLease] ${jobName} is already running for epoch ${epoch}`);
    this.name = 'RepairLeaseUnavailableError';
  }
}

export class RepairLeaseLostError extends Error {
  constructor(jobName: string, epoch: string, cause?: unknown) {
    super(`[RepairLease] Lost ownership for ${jobName} epoch ${epoch}`);
    this.name = 'RepairLeaseLostError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export class RepairLeaseCoordinator implements RepairJobCoordinator {
  private readonly leaseTtlMs: number;
  private readonly heartbeatIntervalMs: number;

  constructor(
    private readonly client: RepairLeaseRedis,
    options: { leaseTtlMs?: number; heartbeatIntervalMs?: number } = {},
  ) {
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  async acquire<T>(jobName: string, epoch: string): Promise<AcquireResult<T>> {
    const normalizedEpoch = requireEpoch(epoch);
    const hashTag = `{repair:${jobName}}`;
    const completedKey = `${KEY_PREFIX}:${hashTag}:completed:${normalizedEpoch}`;
    const completed = await this.readCompleted<T>(completedKey, normalizedEpoch);
    if (completed.found) {
      return { status: 'completed', completion: completed.completion };
    }

    const key = `${KEY_PREFIX}:${hashTag}:lease`;
    const fenceKey = `${KEY_PREFIX}:${hashTag}:fence`;
    const attemptId = randomUUID();
    const ownerToken = JSON.stringify({ epoch: normalizedEpoch, owner: attemptId });
    const fenceToken = Number(await this.client.eval(
      ACQUIRE_SCRIPT,
      2,
      key,
      fenceKey,
      ownerToken,
      String(this.leaseTtlMs),
    ));
    if (fenceToken !== 0 && !isFenceToken(fenceToken)) {
      throw new Error(`[RepairLease] Invalid fencing token for ${jobName}`);
    }
    if (fenceToken > 0) {
      const lease = {
        key,
        completedKey,
        ownerToken,
        epoch: normalizedEpoch,
        attemptId,
        fenceToken,
      };
      const completedAfterAcquire = await this.readCompleted<T>(completedKey, normalizedEpoch);
      if (completedAfterAcquire.found) {
        if (!await this.release(lease)) {
          throw new RepairLeaseLostError(jobName, normalizedEpoch);
        }
        return { status: 'completed', completion: completedAfterAcquire.completion };
      }
      return { status: 'acquired', lease };
    }

    const completedAfterContention = await this.readCompleted<T>(completedKey, normalizedEpoch);
    return completedAfterContention.found
      ? { status: 'completed', completion: completedAfterContention.completion }
      : { status: 'busy' };
  }

  async renew(lease: RepairLease): Promise<boolean> {
    const renewed = await this.client.eval(
      RENEW_SCRIPT,
      1,
      lease.key,
      lease.ownerToken,
      String(this.leaseTtlMs),
    );
    return Number(renewed) === 1;
  }

  async complete<T>(
    lease: RepairLease,
    result: T,
    provenance: RepairCompletionProvenance = {
      attemptId: lease.attemptId,
      fenceToken: lease.fenceToken,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
  ): Promise<boolean> {
    const completed = await this.client.eval(
      COMPLETE_SCRIPT,
      2,
      lease.key,
      lease.completedKey,
      lease.ownerToken,
      JSON.stringify({ epoch: lease.epoch, result, provenance }),
    );
    return Number(completed) === 1;
  }

  async release(lease: RepairLease): Promise<boolean> {
    const released = await this.client.eval(RELEASE_SCRIPT, 1, lease.key, lease.ownerToken);
    return Number(released) === 1;
  }

  async execute<T>(
    jobName: string,
    epoch: string,
    body: (signal: AbortSignal, attempt: RepairExecutionAttempt) => Promise<T>,
    onCompleted?: (result: T, provenance: RepairCompletionProvenance) => Promise<void>,
    metadata: RepairExecutionMetadata = {},
  ): Promise<T> {
    const normalizedEpoch = requireEpoch(epoch);
    const acquisition = await this.acquire<T>(jobName, normalizedEpoch);
    if (acquisition.status === 'completed') {
      const { result, provenance } = acquisition.completion;
      await onCompleted?.(result, provenance);
      return result;
    }
    if (acquisition.status === 'busy') {
      throw new RepairLeaseUnavailableError(jobName, normalizedEpoch);
    }

    const { lease } = acquisition;
    const attempt: RepairExecutionAttempt = {
      attemptId: lease.attemptId,
      fenceToken: lease.fenceToken,
      startedAt: new Date().toISOString(),
    };
    let stopped = false;
    let completed = false;
    let executionError: unknown;
    let heartbeatFailure: RepairLeaseLostError | undefined;
    let heartbeatInFlight: Promise<void> | undefined;
    const abortController = new AbortController();
    let rejectHeartbeat!: (error: RepairLeaseLostError) => void;
    const heartbeatFailed = new Promise<never>((_, reject) => {
      rejectHeartbeat = reject;
    });

    const heartbeat = (): void => {
      if (stopped || heartbeatInFlight) {
        return;
      }
      const current = (async () => {
        if (!await this.renew(lease)) {
          throw new RepairLeaseLostError(jobName, normalizedEpoch);
        }
      })();
      heartbeatInFlight = current;
      void current.then(
        () => {
          if (heartbeatInFlight === current) {
            heartbeatInFlight = undefined;
          }
        },
        (error: unknown) => {
          if (heartbeatInFlight === current) {
            heartbeatInFlight = undefined;
          }
          if (!heartbeatFailure) {
            heartbeatFailure = error instanceof RepairLeaseLostError
              ? error
              : new RepairLeaseLostError(jobName, normalizedEpoch, error);
            stopped = true;
            clearInterval(heartbeatTimer);
            abortController.abort(heartbeatFailure);
            rejectHeartbeat(heartbeatFailure);
          }
        },
      );
    };

    const heartbeatTimer = setInterval(heartbeat, this.heartbeatIntervalMs);
    heartbeatTimer.unref();

    const stopHeartbeat = async (): Promise<void> => {
      stopped = true;
      clearInterval(heartbeatTimer);
      const current = heartbeatInFlight;
      if (current) {
        try {
          await current;
        } catch {
          // heartbeatFailure carries the fail-closed error.
        }
      }
    };

    const bodyPromise = Promise.resolve().then(() => body(abortController.signal, attempt));

    try {
      const result = await Promise.race([bodyPromise, heartbeatFailed]);
      await stopHeartbeat();
      if (heartbeatFailure) {
        throw heartbeatFailure;
      }
      const provenance: RepairCompletionProvenance = {
        ...attempt,
        completedAt: new Date().toISOString(),
        ...metadata,
      };
      if (!await this.complete(lease, result, provenance)) {
        throw new RepairLeaseLostError(jobName, normalizedEpoch);
      }
      completed = true;
      await onCompleted?.(result, provenance);
      return result;
    } catch (error) {
      if (heartbeatFailure) {
        try {
          await bodyPromise;
        } catch {
          // The lease-loss error is the authoritative failure.
        }
        executionError = heartbeatFailure;
        throw heartbeatFailure;
      }
      executionError = error;
      throw error;
    } finally {
      await stopHeartbeat();
      if (!completed) {
        try {
          await this.release(lease);
        } catch (releaseError) {
          if (executionError === undefined) {
            throw releaseError;
          }
        }
      }
    }
  }

  private async readCompleted<T>(
    completedKey: string,
    epoch: string,
  ): Promise<{ found: false } | { found: true; completion: StoredCompletion<T> }> {
    const value = await this.client.get(completedKey);
    if (value === null) {
      return { found: false };
    }
    const parsed = JSON.parse(value) as Partial<StoredCompletion<T>>;
    if (parsed.epoch !== epoch
      || !Object.prototype.hasOwnProperty.call(parsed, 'result')
      || !isCompletionProvenance(parsed.provenance)) {
      throw new Error(`[RepairLease] Invalid completed result for epoch ${epoch}`);
    }
    return {
      found: true,
      completion: parsed as StoredCompletion<T>,
    };
  }
}

export function utcDailyRepairEpoch(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function repairRunId(jobName: string, epoch: string): string {
  return createHash('sha256')
    .update(`${jobName}|repair|${requireEpoch(epoch)}`)
    .digest('hex')
    .slice(0, 24);
}

function requireEpoch(epoch: string): string {
  const normalized = String(epoch ?? '').trim();
  if (!normalized) {
    throw new Error('[RepairLease] A non-empty logical epoch is required');
  }
  return normalized;
}

function isCompletionProvenance(value: unknown): value is RepairCompletionProvenance {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const provenance = value as Partial<RepairCompletionProvenance>;
  return typeof provenance.attemptId === 'string'
    && isFenceToken(provenance.fenceToken)
    && typeof provenance.startedAt === 'string'
    && typeof provenance.completedAt === 'string'
    && (provenance.trigger === undefined || typeof provenance.trigger === 'string')
    && (provenance.releaseTag === undefined || typeof provenance.releaseTag === 'string');
}

function isFenceToken(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export const repairLeaseCoordinator = new RepairLeaseCoordinator(redis);
