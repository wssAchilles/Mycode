import { describe, expect, it, vi } from 'vitest';
import type { ChatPersistenceDriver } from '../core/chat/persist/contracts';
import { selectChatPersistenceDriver } from '../core/chat/persist/driverSelection';

function buildDriver(name: string): ChatPersistenceDriver {
  return {
    name,
    capabilities: {
      localSearch: true,
      hotChats: true,
      syncPts: true,
      opfsBacked: name.includes('sqlite'),
    },
    loadRecentMessages: async () => [],
    loadMessagesBeforeSeq: async () => [],
    loadMessagesByIds: async () => [],
    saveMessages: async () => undefined,
    saveMessage: async () => undefined,
    loadHotChatCandidates: async () => [],
    loadSyncPts: async () => 0,
    saveSyncPts: async () => undefined,
  };
}

describe('selectChatPersistenceDriver', () => {
  it('keeps IndexedDB when requested explicitly', async () => {
    const idb = buildDriver('dexie-indexeddb');
    const selected = await selectChatPersistenceDriver({
      requested: 'idb',
      idbDriver: idb,
      sqliteFactory: vi.fn(async () => buildDriver('sqlite-opfs')),
    });

    expect(selected.driver).toBe(idb);
    expect(selected.selection.requested).toBe('idb');
    expect(selected.selection.selected).toBe('dexie-indexeddb');
    expect(selected.selection.fallbackReason).toBeNull();
  });

  it('falls back to IndexedDB when sqlite-opfs boot fails', async () => {
    const selected = await selectChatPersistenceDriver({
      requested: 'sqlite-opfs',
      idbDriver: buildDriver('dexie-indexeddb'),
      sqliteFactory: vi.fn(async () => {
        throw new Error('OPFS unavailable');
      }),
    });

    expect(selected.driver.name).toBe('dexie-indexeddb');
    expect(selected.selection.requested).toBe('sqlite-opfs');
    expect(selected.selection.selected).toBe('dexie-indexeddb');
    expect(selected.selection.fallbackReason).toContain('OPFS unavailable');
  });

  it('prefers sqlite-opfs in auto mode when available', async () => {
    const sqlite = buildDriver('sqlite-opfs');
    const selected = await selectChatPersistenceDriver({
      requested: 'auto',
      idbDriver: buildDriver('dexie-indexeddb'),
      sqliteFactory: vi.fn(async () => sqlite),
    });

    expect(selected.driver).toBe(sqlite);
    expect(selected.selection.requested).toBe('auto');
    expect(selected.selection.selected).toBe('sqlite-opfs');
    expect(selected.selection.fallbackReason).toBeNull();
  });
});
