import { describe, expect, it } from 'vitest';
import type { Message } from '../types/chat';
import type { ChatPersistenceDriver } from '../core/chat/persist/contracts';
import { ChatPersistenceRuntime } from '../core/chat/persist/runtimePersistence';

function buildDriver(overrides: Partial<ChatPersistenceDriver> = {}): ChatPersistenceDriver {
  return {
    name: 'test-driver',
    capabilities: {
      localSearch: true,
      hotChats: true,
      syncPts: true,
      opfsBacked: false,
    },
    loadRecentMessages: async () => [],
    loadMessagesBeforeSeq: async () => [],
    loadMessagesByIds: async () => [],
    saveMessages: async () => undefined,
    saveMessage: async () => undefined,
    loadHotChatCandidates: async () => [],
    loadSyncPts: async () => 0,
    saveSyncPts: async () => undefined,
    ...overrides,
  };
}

describe('ChatPersistenceRuntime', () => {
  it('tracks degraded state after a driver failure and clears it after recovery', async () => {
    let fail = true;
    const runtime = new ChatPersistenceRuntime(buildDriver({
      loadRecentMessages: async (): Promise<Message[]> => {
        if (fail) {
          throw new Error('driver unavailable');
        }
        return [];
      },
    }));

    await expect(runtime.loadRecentMessages('p:u1:u2')).rejects.toThrow('driver unavailable');

    const degraded = runtime.getRuntimeInfo();
    expect(degraded.phase).toBe('degraded');
    expect(degraded.telemetry.failures).toBe(1);
    expect(degraded.telemetry.consecutiveFailures).toBe(1);
    expect(degraded.telemetry.lastError).toBe('driver unavailable');

    fail = false;
    await expect(runtime.loadRecentMessages('p:u1:u2')).resolves.toEqual([]);

    const ready = runtime.getRuntimeInfo();
    expect(ready.phase).toBe('ready');
    expect(ready.telemetry.failures).toBe(1);
    expect(ready.telemetry.consecutiveFailures).toBe(0);
    expect(ready.telemetry.lastError).toBeNull();
  });

  it('resets telemetry when a new driver is installed', async () => {
    const runtime = new ChatPersistenceRuntime(buildDriver({
      loadSyncPts: async () => {
        throw new Error('sync unavailable');
      },
    }));

    await expect(runtime.loadSyncPts('u1')).rejects.toThrow('sync unavailable');
    expect(runtime.getRuntimeInfo().telemetry.failures).toBe(1);

    runtime.setDriver(buildDriver({ name: 'replacement-driver' }));

    const reset = runtime.getRuntimeInfo();
    expect(reset.driver).toBe('replacement-driver');
    expect(reset.phase).toBe('idle');
    expect(reset.telemetry.failures).toBe(0);
    expect(reset.telemetry.operations).toBe(0);
  });
});
