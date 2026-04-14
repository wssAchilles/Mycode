import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/chat';
import type { ChatPersistenceDriver } from '../core/chat/persist/contracts';
import {
  createSqliteOpfsDriver,
  type SqlitePersistenceBackend,
} from '../core/chat/persist/sqliteOpfsDriver';

function buildMessage(id: string, seq: number): Message {
  return {
    id,
    chatId: 'p:1:2',
    chatType: 'private',
    seq,
    content: `hello-${seq}`,
    senderId: '1',
    senderUsername: 'alice',
    userId: '1',
    username: 'alice',
    receiverId: '2',
    timestamp: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    type: 'text',
    isGroupChat: false,
  };
}

function buildFallbackDriver(messages: Message[]): ChatPersistenceDriver {
  return {
    name: 'dexie-indexeddb',
    capabilities: {
      localSearch: true,
      hotChats: true,
      syncPts: true,
      opfsBacked: false,
    },
    loadRecentMessages: vi.fn(async () => messages),
    loadMessagesBeforeSeq: vi.fn(async () => messages),
    loadMessagesByIds: vi.fn(async (_chatId: string, ids: string[]) => messages.filter((msg) => ids.includes(msg.id))),
    saveMessages: vi.fn(async () => undefined),
    saveMessage: vi.fn(async () => undefined),
    loadHotChatCandidates: vi.fn(async () => []),
    loadSyncPts: vi.fn(async () => 0),
    saveSyncPts: vi.fn(async () => undefined),
  };
}

function buildBackend(overrides: Partial<SqlitePersistenceBackend> = {}): SqlitePersistenceBackend {
  return {
    loadRecentMessages: vi.fn(async () => []),
    loadMessagesBeforeSeq: vi.fn(async () => []),
    loadMessagesByIds: vi.fn(async () => []),
    saveMessages: vi.fn(async () => undefined),
    saveMessage: vi.fn(async () => undefined),
    loadHotChatCandidates: vi.fn(async () => []),
    loadSyncPts: vi.fn(async () => 0),
    saveSyncPts: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createSqliteOpfsDriver', () => {
  it('backfills sqlite from IndexedDB when the sqlite cache is cold', async () => {
    const fallbackMessages = [buildMessage('m1', 1), buildMessage('m2', 2)];
    const backend = buildBackend();
    const driver = await createSqliteOpfsDriver({
      backendFactory: async () => backend,
      fallbackDriver: buildFallbackDriver(fallbackMessages),
      shadowIdb: false,
    });

    const result = await driver.loadRecentMessages('p:1:2', 50);

    expect(result).toEqual(fallbackMessages);
    expect(backend.saveMessages).toHaveBeenCalledWith(fallbackMessages);
  });

  it('shadow-writes to IndexedDB while sqlite-opfs is primary', async () => {
    const backend = buildBackend();
    const fallback = buildFallbackDriver([]);
    const driver = await createSqliteOpfsDriver({
      backendFactory: async () => backend,
      fallbackDriver: fallback,
      shadowIdb: true,
    });
    const payload = [buildMessage('m3', 3)];

    await driver.saveMessages(payload);
    await driver.saveSyncPts('u1', 42);

    expect(backend.saveMessages).toHaveBeenCalledWith(payload);
    expect(fallback.saveMessages).toHaveBeenCalledWith(payload);
    expect(fallback.saveSyncPts).toHaveBeenCalledWith('u1', 42);
  });
});
