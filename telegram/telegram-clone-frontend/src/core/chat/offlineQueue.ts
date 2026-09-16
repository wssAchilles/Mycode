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
  list?: () => Promise<QueuedMessage[]>;
  markSending?: (id: string) => Promise<void>;
  markSent?: (id: string) => Promise<void>;
  markFailed?: (id: string) => Promise<void>;
}

const DEFAULT_MAX_RETRY_COUNT = 8;
const DEFAULT_MAX_MESSAGES = 50;

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
  const eligible = all
    .filter((msg) => (msg.retryCount ?? 0) <= maxRetryCount)
    .filter((msg) => msg.status !== 'sending')
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(0, maxMessages);

  let sent = 0;
  let failed = 0;

  for (const msg of eligible) {
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

  return { attempted: eligible.length, sent, failed, remaining };
}

export type { QueuedMessage };
