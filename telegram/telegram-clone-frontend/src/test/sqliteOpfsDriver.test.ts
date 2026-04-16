import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/chat';
import type {
  ChatPersistenceDriver,
  ChatPersistenceMigrationRecord,
  ChatPersistenceMigrationSource,
} from '../core/chat/persist/contracts';
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

function buildFallbackDriver(
  messages: Message[],
  migrationSource?: ChatPersistenceMigrationSource,
): ChatPersistenceDriver {
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
    migrationSource,
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
    readMeta: vi.fn(async () => null),
    writeMeta: vi.fn(async () => undefined),
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

  it('runs a background migration from IndexedDB into sqlite-opfs and exposes progress state', async () => {
    const migratedMessages = [buildMessage('m1', 1), buildMessage('m2', 2), buildMessage('m3', 3)];
    const migratedSyncStates = [{ userId: 'u1', pts: 88 }];
    const migrationSource: ChatPersistenceMigrationSource = {
      getMigrationStats: vi.fn(async () => ({
        messageCount: migratedMessages.length,
        syncStateCount: migratedSyncStates.length,
      })),
      getMigrationMessages: vi.fn(async (offset: number, limit: number) => migratedMessages.slice(offset, offset + limit)),
      getMigrationSyncStates: vi.fn(async (offset: number, limit: number) => migratedSyncStates.slice(offset, offset + limit)),
    };
    const backend = buildBackend();
    const driver = await createSqliteOpfsDriver({
      backendFactory: async () => backend,
      fallbackDriver: buildFallbackDriver([], migrationSource),
      migrationBatchSize: 2,
      shadowIdb: false,
    });

    await vi.waitFor(() => {
      expect(driver.inspectRuntime?.().migration?.phase).toBe('completed');
    });

    expect(backend.saveMessages).toHaveBeenCalledTimes(2);
    expect(backend.saveMessages).toHaveBeenNthCalledWith(1, migratedMessages.slice(0, 2));
    expect(backend.saveMessages).toHaveBeenNthCalledWith(2, migratedMessages.slice(2, 3));
    expect(backend.saveSyncPts).toHaveBeenCalledWith('u1', 88);
    expect(backend.writeMeta).toHaveBeenCalled();
    expect(driver.inspectRuntime?.().migration).toMatchObject({
      phase: 'completed',
      source: 'dexie-indexeddb',
      importedMessages: migratedMessages.length,
      totalMessages: migratedMessages.length,
      importedSyncStates: migratedSyncStates.length,
      totalSyncStates: migratedSyncStates.length,
    });
  });

  it('skips rerunning migration when sqlite-opfs already stores a completed migration marker', async () => {
    const completedRecord: ChatPersistenceMigrationRecord = {
      version: 1,
      source: 'dexie-indexeddb',
      phase: 'completed',
      startedAt: 100,
      updatedAt: 200,
      completedAt: 200,
      importedMessages: 12,
      totalMessages: 12,
      importedSyncStates: 1,
      totalSyncStates: 1,
      lastError: null,
    };
    const migrationSource: ChatPersistenceMigrationSource = {
      getMigrationStats: vi.fn(async () => ({ messageCount: 99, syncStateCount: 2 })),
      getMigrationMessages: vi.fn(async () => []),
      getMigrationSyncStates: vi.fn(async () => []),
    };
    const backend = buildBackend({
      readMeta: vi.fn(async () => JSON.stringify(completedRecord)),
    });

    const driver = await createSqliteOpfsDriver({
      backendFactory: async () => backend,
      fallbackDriver: buildFallbackDriver([], migrationSource),
      migrationBatchSize: 2,
      shadowIdb: false,
    });

    expect(migrationSource.getMigrationStats).not.toHaveBeenCalled();
    expect(driver.inspectRuntime?.().migration).toMatchObject({
      phase: 'completed',
      importedMessages: 12,
      totalMessages: 12,
      importedSyncStates: 1,
      totalSyncStates: 1,
    });
  });

  it('records shadow mismatches when sqlite-opfs diverges from IndexedDB during compare reads', async () => {
    const backend = buildBackend({
      loadRecentMessages: vi.fn(async () => [buildMessage('sqlite-only', 1)]),
    });
    const fallback = buildFallbackDriver([buildMessage('idb-only', 2)]);
    const driver = await createSqliteOpfsDriver({
      backendFactory: async () => backend,
      fallbackDriver: fallback,
      shadowReadCompare: true,
      shadowReadCompareSampleRate: 100,
      shadowIdb: false,
    });

    await driver.loadRecentMessages('p:1:2', 50);

    expect(driver.inspectRuntime?.().shadow).toMatchObject({
      enabled: true,
      sampleRate: 100,
      readsCompared: 1,
      mismatches: 1,
      lastMismatchReason: 'loadRecentMessages:message_count:2:1',
      backfillWrites: 1,
    });
  });
});
