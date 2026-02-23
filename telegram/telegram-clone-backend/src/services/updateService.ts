import UpdateCounter from '../models/UpdateCounter';
import UpdateLog, { UpdateType } from '../models/UpdateLog';
import { EventEmitter } from 'node:events';
import { redis } from '../config/redis';
import { chatRuntimeMetrics } from './chatRuntimeMetrics';

interface AppendUpdateParams {
  userId: string;
  type: UpdateType;
  chatId: string;
  seq?: number;
  messageId?: string;
  payload?: Record<string, any>;
}

export type SyncWakeSource = 'event' | 'poll' | 'initial' | 'timeout';

export type WaitForUpdateResult = {
  updateId: number | null;
  wakeSource: SyncWakeSource;
  eventSource?: 'local' | 'pubsub';
};

const ACK_KEY_PREFIX = 'sync:ack:';
const DEFAULT_ACK_TTL_SECONDS = 7 * 24 * 60 * 60;
const WAIT_MIN_TIMEOUT_MS = 200;
const WAIT_MAX_TIMEOUT_MS = 60_000;
const WAIT_POLL_DEFAULT_MS = 1_500;
const WAIT_POLL_MIN_MS = 250;
const WAIT_POLL_MAX_MS = 5_000;
const APPEND_UPDATES_CHUNK_DEFAULT = 200;
const APPEND_UPDATES_CHUNK_MIN = 20;
const APPEND_UPDATES_CHUNK_MAX = 1_000;
const APPEND_UPDATES_FALLBACK_CHUNK_DEFAULT = 200;
const APPEND_UPDATES_FALLBACK_CHUNK_MIN = 20;
const APPEND_UPDATES_FALLBACK_CHUNK_MAX = 1_000;
const WAKE_PUBSUB_CHANNEL = 'sync:update:wake:v1';
const WAKE_PUBSUB_ENABLED_DEFAULT = process.env.NODE_ENV !== 'test';

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function readBool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
}

class UpdateService {
  private readonly updateEvents = new EventEmitter();
  private readonly ackTtlSeconds = clampInt(
    process.env.SYNC_ACK_TTL_SECONDS,
    DEFAULT_ACK_TTL_SECONDS,
    60,
    90 * 24 * 60 * 60,
  );
  private readonly waitPollIntervalMs = clampInt(
    process.env.SYNC_WAIT_POLL_INTERVAL_MS,
    WAIT_POLL_DEFAULT_MS,
    WAIT_POLL_MIN_MS,
    WAIT_POLL_MAX_MS,
  );
  private readonly wakePubSubEnabled = readBool(
    process.env.SYNC_WAKE_PUBSUB_ENABLED,
    WAKE_PUBSUB_ENABLED_DEFAULT,
  );
  private readonly appendUpdatesChunkSize = clampInt(
    process.env.SYNC_APPEND_UPDATES_CHUNK_SIZE,
    APPEND_UPDATES_CHUNK_DEFAULT,
    APPEND_UPDATES_CHUNK_MIN,
    APPEND_UPDATES_CHUNK_MAX,
  );
  private readonly appendUpdatesFallbackChunkSize = clampInt(
    process.env.SYNC_APPEND_UPDATES_FALLBACK_CHUNK_SIZE,
    APPEND_UPDATES_FALLBACK_CHUNK_DEFAULT,
    APPEND_UPDATES_FALLBACK_CHUNK_MIN,
    APPEND_UPDATES_FALLBACK_CHUNK_MAX,
  );
  private wakeSubscriber: any | null = null;
  private wakeSubscriberReady = false;

  constructor() {
    this.updateEvents.setMaxListeners(0);
    this.startWakeSubscriber();
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return 100;
    return Math.min(Math.max(Math.floor(limit), 1), 200);
  }

  private normalizeWaitTimeout(timeoutMs: number): number {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return 30_000;
    }
    const normalized = Math.floor(timeoutMs);
    if (normalized < WAIT_MIN_TIMEOUT_MS) return WAIT_MIN_TIMEOUT_MS;
    if (normalized > WAIT_MAX_TIMEOUT_MS) return WAIT_MAX_TIMEOUT_MS;
    return normalized;
  }

  private emitUpdate(userId: string, updateId: number, source: 'local' | 'pubsub' = 'local'): void {
    if (!userId) return;
    const normalized = Number.isFinite(updateId) ? Math.floor(updateId) : 0;
    if (normalized <= 0) return;
    this.updateEvents.emit(`user:${userId}`, {
      updateId: normalized,
      source,
    });
  }

  private parseWakePayload(message: string): { userId: string; updateId: number } | null {
    try {
      const parsed = JSON.parse(message);
      const userId = typeof parsed?.userId === 'string' ? parsed.userId : '';
      const updateIdRaw = Number(parsed?.updateId);
      const updateId = Number.isFinite(updateIdRaw) ? Math.max(0, Math.floor(updateIdRaw)) : 0;
      if (!userId || updateId <= 0) return null;
      return { userId, updateId };
    } catch {
      return null;
    }
  }

  private startWakeSubscriber(): void {
    if (!this.wakePubSubEnabled) return;
    if (this.wakeSubscriber) return;

    const duplicateFn = (redis as any)?.duplicate;
    if (typeof duplicateFn !== 'function') return;

    const sub = duplicateFn.call(redis);
    this.wakeSubscriber = sub;

    sub.on('message', (channel: string, message: string) => {
      if (channel !== WAKE_PUBSUB_CHANNEL) return;
      const payload = this.parseWakePayload(message);
      if (!payload) return;
      this.emitUpdate(payload.userId, payload.updateId, 'pubsub');
    });
    sub.on('close', () => {
      this.wakeSubscriberReady = false;
    });
    sub.on('error', () => undefined);

    void (async () => {
      try {
        if (typeof sub.connect === 'function') {
          try {
            await sub.connect();
          } catch {
            // ignore: subscribe may still trigger a lazy connect.
          }
        }
        await sub.subscribe(WAKE_PUBSUB_CHANNEL);
        this.wakeSubscriberReady = true;
      } catch {
        this.wakeSubscriberReady = false;
      }
    })();
  }

  private async publishWakeUpdate(userId: string, updateId: number): Promise<void> {
    if (!this.wakePubSubEnabled) return;
    if (!userId) return;
    if (!Number.isFinite(updateId) || updateId <= 0) return;
    if (!this.wakeSubscriberReady) {
      this.startWakeSubscriber();
    }

    const payload = JSON.stringify({
      userId,
      updateId: Math.floor(updateId),
    });
    try {
      await redis.publish(WAKE_PUBSUB_CHANNEL, payload);
    } catch {
      // Best-effort only. waitForUpdate still has polling fallback.
    }
  }

  private ackKey(userId: string): string {
    return `${ACK_KEY_PREFIX}${userId}`;
  }

  async getUpdateId(userId: string): Promise<number> {
    const doc = await UpdateCounter.findById(userId).lean();
    return doc?.updateId || 0;
  }

  async incrementUpdateId(userId: string, count: number = 1): Promise<number> {
    const doc = await UpdateCounter.findOneAndUpdate(
      { _id: userId },
      { $inc: { updateId: count } },
      { upsert: true, new: true }
    ).lean();
    return doc?.updateId || count;
  }

  async appendUpdate(params: AppendUpdateParams): Promise<number> {
    const startedAt = Date.now();
    chatRuntimeMetrics.increment('sync.appendUpdate.requests');
    try {
      const updateId = await this.incrementUpdateId(params.userId, 1);
      await UpdateLog.create({
        userId: params.userId,
        updateId,
        type: params.type,
        chatId: params.chatId,
        seq: params.seq,
        messageId: params.messageId,
        payload: params.payload || null,
      });
      this.emitUpdate(params.userId, updateId, 'local');
      void this.publishWakeUpdate(params.userId, updateId);
      chatRuntimeMetrics.increment('sync.appendUpdate.success');
      chatRuntimeMetrics.observeDuration('sync.appendUpdate.latencyMs', Date.now() - startedAt);
      return updateId;
    } catch (error) {
      chatRuntimeMetrics.increment('sync.appendUpdate.errors');
      chatRuntimeMetrics.observeDuration('sync.appendUpdate.latencyMs', Date.now() - startedAt);
      throw error;
    }
  }

  async appendUpdates(userIds: string[], params: Omit<AppendUpdateParams, 'userId'>): Promise<void> {
    const startedAt = Date.now();
    chatRuntimeMetrics.increment('sync.appendUpdates.requests');
    chatRuntimeMetrics.observeValue('sync.appendUpdates.usersRequested', Array.isArray(userIds) ? userIds.length : 0);
    if (!userIds.length) {
      chatRuntimeMetrics.increment('sync.appendUpdates.empty');
      chatRuntimeMetrics.observeDuration('sync.appendUpdates.latencyMs', Date.now() - startedAt);
      return;
    }
    const deduped = Array.from(new Set(userIds.filter(Boolean)));
    chatRuntimeMetrics.observeValue('sync.appendUpdates.usersDeduped', deduped.length);
    if (!deduped.length) {
      chatRuntimeMetrics.increment('sync.appendUpdates.empty');
      chatRuntimeMetrics.observeDuration('sync.appendUpdates.latencyMs', Date.now() - startedAt);
      return;
    }

    // Keep write pressure bounded under large fanout bursts.
    const chunkSize = this.appendUpdatesChunkSize;
    chatRuntimeMetrics.observeValue('sync.appendUpdates.chunkSize', chunkSize);
    chatRuntimeMetrics.observeValue('sync.appendUpdates.fallbackChunkSize', this.appendUpdatesFallbackChunkSize);

    let chunkCount = 0;
    let fallbackChunkCount = 0;
    try {
      for (let i = 0; i < deduped.length; i += chunkSize) {
        const chunk = deduped.slice(i, i + chunkSize);
        if (!chunk.length) continue;
        chunkCount += 1;

        const reserved = await Promise.all(
          chunk.map(async (userId) => ({
            userId,
            updateId: await this.incrementUpdateId(userId, 1),
          })),
        );

        // Insert logs in one round-trip per chunk.
        const docs = reserved.map((entry) => ({
          userId: entry.userId,
          updateId: entry.updateId,
          type: params.type,
          chatId: params.chatId,
          seq: params.seq,
          messageId: params.messageId,
          payload: params.payload || null,
        }));

        try {
          await UpdateLog.insertMany(docs, { ordered: false });
        } catch {
          // Fallback path: maintain idempotency/progress via bounded bulk upserts.
          for (let j = 0; j < docs.length; j += this.appendUpdatesFallbackChunkSize) {
            const fallbackDocs = docs.slice(j, j + this.appendUpdatesFallbackChunkSize);
            if (!fallbackDocs.length) continue;
            fallbackChunkCount += 1;
            const ops = fallbackDocs.map((doc) => ({
              updateOne: {
                filter: { userId: doc.userId, updateId: doc.updateId },
                update: { $setOnInsert: doc },
                upsert: true,
              },
            }));
            await UpdateLog.bulkWrite(ops, { ordered: false });
          }
        }

        for (const entry of reserved) {
          this.emitUpdate(entry.userId, entry.updateId, 'local');
          void this.publishWakeUpdate(entry.userId, entry.updateId);
        }
      }

      chatRuntimeMetrics.observeValue('sync.appendUpdates.chunks', chunkCount);
      chatRuntimeMetrics.observeValue('sync.appendUpdates.fallbackChunks', fallbackChunkCount);
      chatRuntimeMetrics.increment('sync.appendUpdates.success');
      chatRuntimeMetrics.observeDuration('sync.appendUpdates.latencyMs', Date.now() - startedAt);
    } catch (error) {
      chatRuntimeMetrics.observeValue('sync.appendUpdates.chunks', chunkCount);
      chatRuntimeMetrics.observeValue('sync.appendUpdates.fallbackChunks', fallbackChunkCount);
      chatRuntimeMetrics.increment('sync.appendUpdates.errors');
      chatRuntimeMetrics.observeDuration('sync.appendUpdates.latencyMs', Date.now() - startedAt);
      throw error;
    }
  }

  async getUpdates(userId: string, fromUpdateId: number, limit: number = 100): Promise<{ updates: any[]; lastUpdateId: number }> {
    const normalizedLimit = this.normalizeLimit(limit);
    const normalizedFrom = Number.isFinite(fromUpdateId) && fromUpdateId >= 0 ? fromUpdateId : 0;

    const updates = await UpdateLog.find({
      userId,
      updateId: { $gt: normalizedFrom },
    })
      .sort({ updateId: 1 })
      .limit(normalizedLimit)
      .lean();

    const lastUpdateId = updates.length ? updates[updates.length - 1].updateId : normalizedFrom;
    return { updates, lastUpdateId };
  }

  async waitForUpdate(userId: string, fromUpdateId: number, timeoutMs: number): Promise<WaitForUpdateResult> {
    const startedAt = Date.now();
    chatRuntimeMetrics.increment('sync.waitForUpdate.requests');
    if (!userId) {
      const result: WaitForUpdateResult = {
        updateId: null,
        wakeSource: 'timeout',
      };
      chatRuntimeMetrics.increment(`sync.waitForUpdate.wakeSource.${result.wakeSource}`);
      chatRuntimeMetrics.observeDuration('sync.waitForUpdate.latencyMs', Date.now() - startedAt);
      return result;
    }
    const normalizedFrom = Number.isFinite(fromUpdateId) && fromUpdateId >= 0 ? Math.floor(fromUpdateId) : 0;
    const waitMs = this.normalizeWaitTimeout(timeoutMs);
    chatRuntimeMetrics.observeValue('sync.waitForUpdate.timeoutMs', waitMs);

    return new Promise<WaitForUpdateResult>((resolve) => {
      const eventName = `user:${userId}`;
      let settled = false;
      const pollIntervalMs = Math.min(waitMs, this.waitPollIntervalMs);
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (value: WaitForUpdateResult) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        if (pollTimer) {
          clearInterval(pollTimer);
        }
        this.updateEvents.off(eventName, onUpdate);
        chatRuntimeMetrics.increment(`sync.waitForUpdate.wakeSource.${value.wakeSource}`);
        if (value.wakeSource === 'event' && value.eventSource) {
          chatRuntimeMetrics.increment(`sync.waitForUpdate.eventSource.${value.eventSource}`);
        }
        chatRuntimeMetrics.observeDuration('sync.waitForUpdate.latencyMs', Date.now() - startedAt);
        resolve(value);
      };

      const onUpdate = (payload: { updateId: number; source?: 'local' | 'pubsub' } | number) => {
        const nextUpdateId =
          typeof payload === 'number' ? payload : Number(payload?.updateId);
        const eventSource =
          typeof payload === 'number'
            ? 'local'
            : payload?.source === 'pubsub'
              ? 'pubsub'
              : 'local';
        const normalized = Number.isFinite(nextUpdateId) ? Math.floor(nextUpdateId) : 0;
        if (normalized > normalizedFrom) {
          finish({
            updateId: normalized,
            wakeSource: 'event',
            eventSource,
          });
        }
      };

      timeoutTimer = setTimeout(() => {
        finish({
          updateId: null,
          wakeSource: 'timeout',
        });
      }, waitMs);
      if (typeof (timeoutTimer as any)?.unref === 'function') {
        (timeoutTimer as any).unref();
      }

      this.updateEvents.on(eventName, onUpdate);

      // Multi-instance fallback: poll update watermark periodically so long-poll wakeup
      // still works when updates are appended by another process.
      pollTimer = setInterval(() => {
        void this.getUpdateId(userId)
          .then((latest) => {
            if (settled) return;
            const normalized = Number.isFinite(latest) ? Math.floor(latest) : 0;
            if (normalized > normalizedFrom) {
              finish({
                updateId: normalized,
                wakeSource: 'poll',
              });
            }
          })
          .catch(() => undefined);
      }, pollIntervalMs);
      if (typeof (pollTimer as any)?.unref === 'function') {
        (pollTimer as any).unref();
      }

      // Guard against race between initial read and listener registration.
      void this.getUpdateId(userId)
        .then((latest) => {
          const normalized = Number.isFinite(latest) ? Math.floor(latest) : 0;
          if (normalized > normalizedFrom) {
            finish({
              updateId: normalized,
              wakeSource: 'initial',
            });
          }
        })
        .catch(() => undefined);
    });
  }

  async saveAckPts(userId: string, pts: number): Promise<number> {
    if (!userId) return 0;
    const normalizedPts = Number.isFinite(pts) ? Math.max(0, Math.floor(pts)) : 0;
    if (normalizedPts <= 0) return 0;
    const key = this.ackKey(userId);

    try {
      const currentRaw = await redis.get(key);
      const current = currentRaw ? Number.parseInt(currentRaw, 10) : 0;
      const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
      const next = Math.max(safeCurrent, normalizedPts);
      await redis.set(key, String(next), 'EX', this.ackTtlSeconds);
      return next;
    } catch {
      // Redis may be unavailable in degraded environments; ack remains best-effort.
      return normalizedPts;
    }
  }

  async getAckPts(userId: string): Promise<number> {
    if (!userId) return 0;
    try {
      const raw = await redis.get(this.ackKey(userId));
      const parsed = raw ? Number.parseInt(raw, 10) : 0;
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    } catch {
      return 0;
    }
  }
}

export const updateService = new UpdateService();
export default updateService;
