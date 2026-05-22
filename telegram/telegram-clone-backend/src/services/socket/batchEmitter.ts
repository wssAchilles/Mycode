import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { createChildLogger } from '../../utils/logger';
import type { RealtimeBatchEvent } from './types';

const log = createChildLogger('services:socket:batch');

// --- Batch profile configuration ---

type SocketBatchProfile = 'dev' | 'prod' | 'test';

type SocketBatchProfileDefaults = {
  windowMs: number;
  perTargetLimit: number;
  bucketLimit: number;
  globalLimit: number;
  flushImmediateAt: number;
  emitLimit: number;
};

const SOCKET_BATCH_PROFILE_DEFAULTS: Record<SocketBatchProfile, SocketBatchProfileDefaults> = {
  dev: {
    windowMs: 16,
    perTargetLimit: 512,
    bucketLimit: 2_000,
    globalLimit: 10_000,
    flushImmediateAt: 2_000,
    emitLimit: 1_200,
  },
  prod: {
    windowMs: 12,
    perTargetLimit: 1_024,
    bucketLimit: 10_000,
    globalLimit: 40_000,
    flushImmediateAt: 8_000,
    emitLimit: 2_400,
  },
  test: {
    windowMs: 16,
    perTargetLimit: 256,
    bucketLimit: 512,
    globalLimit: 4_000,
    flushImmediateAt: 1_200,
    emitLimit: 800,
  },
};

function readIntFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return Math.max(min, Math.min(max, normalized));
}

function resolveSocketBatchProfile(nodeEnv: string | undefined, profileRaw: string | undefined): SocketBatchProfile {
  const normalized = String(profileRaw || '').trim().toLowerCase();
  if (normalized === 'dev' || normalized === 'prod' || normalized === 'test') {
    return normalized;
  }
  if (String(nodeEnv || '').trim().toLowerCase() === 'production') return 'prod';
  if (String(nodeEnv || '').trim().toLowerCase() === 'test') return 'test';
  return 'dev';
}

export type BatchEmitFn = (events: RealtimeBatchEvent[]) => void;

// --- Batch emitter ---

export class BatchEmitter {
  private queues = new Map<string, { events: RealtimeBatchEvent[]; emit: BatchEmitFn }>();
  private timer: NodeJS.Timeout | null = null;
  private queuedEvents = 0;
  private flushScheduled = false;

  readonly profile = resolveSocketBatchProfile(process.env.NODE_ENV, process.env.SOCKET_BATCH_PROFILE);
  private readonly defaults = SOCKET_BATCH_PROFILE_DEFAULTS[this.profile];

  readonly windowMs = readIntFromEnv(process.env.SOCKET_BATCH_WINDOW_MS, this.defaults.windowMs, 8, 250);
  readonly perTargetLimit = readIntFromEnv(process.env.SOCKET_BATCH_PER_TARGET_LIMIT, this.defaults.perTargetLimit, 32, 20_000);
  readonly bucketLimit = readIntFromEnv(process.env.SOCKET_BATCH_BUCKET_LIMIT, this.defaults.bucketLimit, 64, 50_000);
  readonly globalLimit = readIntFromEnv(process.env.SOCKET_BATCH_GLOBAL_LIMIT, this.defaults.globalLimit, 128, 200_000);
  readonly flushImmediateAt = readIntFromEnv(process.env.SOCKET_BATCH_FLUSH_IMMEDIATE_AT, this.defaults.flushImmediateAt, 128, 200_000);
  readonly emitLimit = readIntFromEnv(process.env.SOCKET_BATCH_EMIT_LIMIT, this.defaults.emitLimit, 32, 50_000);

  queue(key: string, emit: BatchEmitFn, event: RealtimeBatchEvent): void {
    chatRuntimeMetrics.increment('socket.realtimeBatch.enqueue');

    let bucket = this.queues.get(key);
    if (!bucket) {
      if (this.queues.size >= this.bucketLimit) {
        this.dropOldestBucket();
      }
      bucket = { events: [], emit };
      this.queues.set(key, bucket);
    }

    bucket.events.push(event);
    this.queuedEvents += 1;

    this.trimBucketIfOverflow(bucket);
    const globalDropped = this.trimGlobalLimit();
    if (globalDropped > 0) {
      chatRuntimeMetrics.increment('socket.realtimeBatch.drop.globalOverflow', globalDropped);
    }

    const queued = this.queuedEvents;
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.queueDepth', queued);

    if (queued >= this.flushImmediateAt) {
      this.scheduleImmediateFlush();
      return;
    }

    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.windowMs);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushScheduled = false;
    if (!this.queues.size) return;

    chatRuntimeMetrics.increment('socket.realtimeBatch.flush');

    const entries = Array.from(this.queues.entries());
    this.queues.clear();
    this.queuedEvents = 0;

    chatRuntimeMetrics.observeValue('socket.realtimeBatch.flushBucketCount', entries.length);
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.queueDepth', 0);

    for (const [, item] of entries) {
      if (!item.events.length) continue;
      let coalesced = this.coalesce(item.events);
      if (coalesced.length > this.emitLimit) {
        const overflow = coalesced.length - this.emitLimit;
        coalesced = coalesced.slice(overflow);
        chatRuntimeMetrics.increment('socket.realtimeBatch.drop.emitOverflow', overflow);
      }
      if (!coalesced.length) continue;
      chatRuntimeMetrics.observeValue('socket.realtimeBatch.emitSize', coalesced.length);
      item.emit(coalesced);
    }
  }

  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queues.clear();
    this.queuedEvents = 0;
  }

  private dropOldestBucket(): void {
    const oldestKey = this.queues.keys().next().value as string | undefined;
    if (!oldestKey) return;
    const oldestBucket = this.queues.get(oldestKey);
    const dropped = oldestBucket?.events.length || 0;
    if (dropped > 0) {
      this.queuedEvents = Math.max(0, this.queuedEvents - dropped);
      chatRuntimeMetrics.increment('socket.realtimeBatch.drop.bucketOverflowEvents', dropped);
    }
    this.queues.delete(oldestKey);
    chatRuntimeMetrics.increment('socket.realtimeBatch.drop.bucketOverflowTargets');
  }

  private trimBucketIfOverflow(bucket: { events: RealtimeBatchEvent[] }): void {
    if (bucket.events.length > this.perTargetLimit) {
      const overflow = bucket.events.length - this.perTargetLimit;
      if (overflow > 0) {
        bucket.events.splice(0, overflow);
        this.queuedEvents = Math.max(0, this.queuedEvents - overflow);
        chatRuntimeMetrics.increment('socket.realtimeBatch.drop.targetOverflow', overflow);
      }
    }
  }

  private trimGlobalLimit(): number {
    let total = this.queuedEvents;
    if (total <= this.globalLimit) return 0;

    let dropped = 0;
    const entries = Array.from(this.queues.entries());
    if (!entries.length) return 0;

    let cursor = 0;
    while (total > this.globalLimit) {
      const entry = entries[cursor];
      cursor = (cursor + 1) % entries.length;
      if (!entry) break;
      const [key, bucket] = entry;
      if (!bucket.events.length) continue;
      bucket.events.shift();
      dropped += 1;
      total -= 1;
      this.queuedEvents = Math.max(0, this.queuedEvents - 1);
      if (!bucket.events.length) {
        this.queues.delete(key);
      }
    }
    return dropped;
  }

  private scheduleImmediateFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flushScheduled = false;
        this.flush();
      });
    }
  }

  private coalesce(events: RealtimeBatchEvent[]): RealtimeBatchEvent[] {
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.coalesceInput', events.length);

    const out: RealtimeBatchEvent[] = [];
    const presenceByUser = new Map<string, RealtimeBatchEvent>();
    const readByKey = new Map<string, RealtimeBatchEvent>();
    const groupByKey = new Map<string, RealtimeBatchEvent>();
    const messagesByChat = new Map<string, unknown[]>();

    for (const e of events) {
      if (!e) continue;

      if (e.type === 'message') {
        const chatId = this.extractChatId(e.payload);
        if (chatId) {
          const existing = messagesByChat.get(chatId) ?? [];
          existing.push(e.payload);
          messagesByChat.set(chatId, existing);
        } else {
          out.push(e);
        }
        continue;
      }

      if (e.type === 'presence') {
        const userId = e.payload?.userId ? String(e.payload.userId) : '';
        if (userId) presenceByUser.set(userId, e);
        continue;
      }

      if (e.type === 'readReceipt') {
        const chatId = e.payload?.chatId ? String(e.payload.chatId) : '';
        const seq = Number(e.payload?.seq || 0);
        if (!chatId || !seq) continue;
        const key = `${chatId}:${seq}`;
        const cur = readByKey.get(key);
        const nextReadCount = Number(e.payload?.readCount || 0);
        const curReadCount = Number(cur?.payload?.readCount || 0);
        if (!cur || nextReadCount >= curReadCount) {
          readByKey.set(key, e);
        }
        continue;
      }

      if (e.type === 'groupUpdate') {
        const groupId = e.payload?.groupId ? String(e.payload.groupId) : '';
        const action = e.payload?.action ? String(e.payload.action) : '';
        groupByKey.set(`${groupId}:${action}`, e);
      }
    }

    // Emit batched messages per chat
    for (const [chatId, messages] of messagesByChat) {
      if (messages.length === 1) {
        out.push({ type: 'message', payload: messages[0] });
      } else {
        out.push({ type: 'batch_messages', payload: { chatId, messages } });
      }
    }

    const merged = out.concat(
      Array.from(presenceByUser.values()),
      Array.from(readByKey.values()),
      Array.from(groupByKey.values()),
    );
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.coalesceOutput', merged.length);
    return merged;
  }

  private extractChatId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    const chatId = p.chatId ?? p.chat_id ?? p.chatID;
    return chatId ? String(chatId) : null;
  }
}
