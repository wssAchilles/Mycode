/**
 * 离线消息队列
 * 持久化未发送消息到 IndexedDB，支持重连后自动重发
 */

import { openDB, type IDBPDatabase } from 'idb';

interface QueuedMessage {
  id: string;
  chatId: string;
  content: string;
  senderId: string;
  clientTempId: string;
  /** HTTP resend payload fields (optional for legacy queue rows). */
  chatType?: 'private' | 'group';
  receiverId?: string;
  groupId?: string;
  type?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  vectorClock: { userId: string; timestamp: number };
  createdAt: number;
  retryCount: number;
  status: 'pending' | 'sending' | 'failed';
}

const DB_NAME = 'offline-message-queue';
const DB_VERSION = 1;
const STORE_NAME = 'pending-messages';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('chatId', 'chatId');
          store.createIndex('status', 'status');
          store.createIndex('clientTempId', 'clientTempId', { unique: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueueMessage(msg: Omit<QueuedMessage, 'id' | 'createdAt' | 'retryCount' | 'status'>): Promise<string> {
  const db = await getDB();
  const id = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const queued: QueuedMessage = {
    ...msg,
    id,
    createdAt: Date.now(),
    retryCount: 0,
    status: 'pending',
  };
  await db.put(STORE_NAME, queued);
  return id;
}

export async function getPendingMessages(chatId?: string): Promise<QueuedMessage[]> {
  const db = await getDB();
  if (chatId) {
    return db.getAllFromIndex(STORE_NAME, 'chatId', chatId);
  }
  return db.getAll(STORE_NAME);
}

export async function markMessageSending(id: string): Promise<void> {
  const db = await getDB();
  const msg = await db.get(STORE_NAME, id);
  if (msg) {
    msg.status = 'sending';
    await db.put(STORE_NAME, msg);
  }
}

export async function markMessageSent(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function markMessageFailed(id: string): Promise<void> {
  const db = await getDB();
  const msg = await db.get(STORE_NAME, id);
  if (msg) {
    msg.status = 'failed';
    msg.retryCount += 1;
    await db.put(STORE_NAME, msg);
  }
}

export async function removeMessage(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function clearQueue(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE_NAME);
}

export interface OfflineFlushSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface OfflineFlushResult {
  attempted: number;
  sent: number;
  failed: number;
  remaining: number;
}

export interface OfflineFlushOptions {
  maxRetryCount?: number;
  maxMessages?: number;
  usePerChatScheduling?: boolean;
  list?: () => Promise<QueuedMessage[]>;
  markSending?: (id: string) => Promise<void>;
  markSent?: (id: string) => Promise<void>;
  markFailed?: (id: string) => Promise<void>;
}

const DEFAULT_MAX_RETRY_COUNT = 8;
const DEFAULT_MAX_MESSAGES = 50;

/**
 * 去相关抖动算法（Decorrelated Jitter）
 * 公式: sleep_i = min(cap, random_between(base, sleep_{i-1} * 3))
 * 有效打散网络恢复时的瞬时重试脉冲，规避惊群冲击。
 */
export function calculateDecorrelatedJitter(
  baseDelay: number,
  maxDelay: number,
  previousDelay: number,
): number {
  const safeBase = Math.max(1, baseDelay);
  const safePrev = Math.max(safeBase, previousDelay);
  const upperBound = Math.max(safeBase, safePrev * 3);
  const randomDelay = Math.random() * (upperBound - safeBase) + safeBase;
  return Math.min(maxDelay, randomDelay);
}

/**
 * 消息优先级与权重评分函数
 * P(m) = TypeWeight * e^(-lambda * DeltaT) - RetryPenalty
 * 优先保留轻量文本与近期关键消息。
 */
export function calculateMessagePriority(msg: QueuedMessage, now: number = Date.now()): number {
  const isText = !msg.type || msg.type === 'text';
  let typeBaseScore = isText ? 100 : 40;

  // 媒体大文件适度扣减优先级
  if (typeof msg.fileSize === 'number' && msg.fileSize > 1024 * 1024) {
    const sizeMb = msg.fileSize / (1024 * 1024);
    typeBaseScore = Math.max(10, typeBaseScore - Math.min(25, Math.floor(sizeMb * 2)));
  }

  // 时间衰减（以 24 小时为衰减周期）
  const ageMs = Math.max(0, now - (msg.createdAt || now));
  const timeDecayFactor = Math.exp(-ageMs / (24 * 3600 * 1000));

  // 重试惩罚
  const retryPenalty = (msg.retryCount || 0) * 4;

  return Math.max(0, (typeBaseScore - retryPenalty) * timeDecayFactor);
}

export interface PruneOptions {
  markFailed?: (id: string) => Promise<void>;
  now?: number;
}

/**
 * 有界容量淘汰机制
 * 当离线队列堆积超过上限时，淘汰优先级最低的消息并标记为 failed，防止客户端 OOM。
 */
export async function pruneOfflineQueue(
  queue: QueuedMessage[],
  maxCapacity: number,
  options: PruneOptions = {},
): Promise<QueuedMessage[]> {
  if (queue.length <= maxCapacity) {
    return queue;
  }
  const now = options.now ?? Date.now();
  const markFailed = options.markFailed ?? markMessageFailed;

  // 按优先级从高到低排序
  const sorted = [...queue].sort((a, b) => {
    return calculateMessagePriority(b, now) - calculateMessagePriority(a, now);
  });

  const retained = sorted.slice(0, maxCapacity);
  const evicted = sorted.slice(maxCapacity);

  // 淘汰的消息标记为失败
  for (const msg of evicted) {
    await markFailed(msg.id);
  }

  return retained;
}

/**
 * 按会话进行 FIFO 保序与跨会话公平调度
 * - 会话内: 按 createdAt 严格升序（保证消息因果时序）
 * - 跨会话: 采用轮询（Round-Robin）交替重放，防止单群刷屏卡死其他私聊
 */
export function sortOfflineQueuePerChatFIFO(queue: QueuedMessage[]): QueuedMessage[] {
  if (queue.length <= 1) return queue;

  const chatBuckets = new Map<string, QueuedMessage[]>();
  for (const msg of queue) {
    const key = msg.chatId || 'global_default';
    let bucket = chatBuckets.get(key);
    if (!bucket) {
      bucket = [];
      chatBuckets.set(key, bucket);
    }
    bucket.push(msg);
  }

  // 会话内按 createdAt 严格正序
  for (const bucket of chatBuckets.values()) {
    bucket.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  // 跨会话轮询交织
  const result: QueuedMessage[] = [];
  const bucketsArray = Array.from(chatBuckets.values());
  let hasMore = true;
  let index = 0;

  while (hasMore) {
    hasMore = false;
    for (const bucket of bucketsArray) {
      if (index < bucket.length) {
        result.push(bucket[index]);
        hasMore = true;
      }
    }
    index += 1;
  }

  return result;
}

/**
 * Replay queued offline messages oldest-first.
 * Injectable ops keep the control flow unit-testable without IndexedDB.
 */
export async function flushOfflineQueue(
  send: (msg: QueuedMessage) => Promise<OfflineFlushSendResult>,
  options: OfflineFlushOptions = {},
): Promise<OfflineFlushResult> {
  const maxRetryCount = options.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT;
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const list = options.list ?? getPendingMessages;
  const markSending = options.markSending ?? markMessageSending;
  const markSent = options.markSent ?? markMessageSent;
  const markFailed = options.markFailed ?? markMessageFailed;

  const all = await list();
  let eligible = all
    .filter((msg) => (msg.retryCount ?? 0) <= maxRetryCount)
    .filter((msg) => msg.status !== 'sending');

  if (options.usePerChatScheduling) {
    eligible = sortOfflineQueuePerChatFIFO(eligible);
  } else {
    eligible.sort((left, right) => left.createdAt - right.createdAt);
  }

  const batch = eligible.slice(0, maxMessages);

  let sent = 0;
  let failed = 0;

  for (const msg of batch) {
    await markSending(msg.id);
    try {
      const result = await send(msg);
      if (result?.success) {
        await markSent(msg.id);
        sent += 1;
      } else {
        await markFailed(msg.id);
        failed += 1;
      }
    } catch {
      await markFailed(msg.id);
      failed += 1;
    }
  }

  // Remaining eligible work after this flush (failed rows stay queued).
  const remaining = eligible.length - sent;

  return { attempted: batch.length, sent, failed, remaining };
}

export type { QueuedMessage };

