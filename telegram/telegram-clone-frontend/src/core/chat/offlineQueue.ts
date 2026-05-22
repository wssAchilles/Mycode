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

export type { QueuedMessage };
