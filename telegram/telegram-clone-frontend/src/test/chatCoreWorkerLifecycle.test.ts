import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCoreApi } from '../core/chat/types';

const workerTestState = vi.hoisted(() => ({
  exposedApi: null as ChatCoreApi | null,
  socketHandlers: new Map<string, Array<(...args: unknown[]) => void>>(),
  mockSocket: null as {
    connected: boolean;
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  } | null,
}));

vi.mock('comlink', () => ({
  expose: vi.fn((impl: ChatCoreApi) => {
    workerTestState.exposedApi = impl;
  }),
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    workerTestState.socketHandlers.clear();
    const socket = {
      connected: false,
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        const list = workerTestState.socketHandlers.get(event) || [];
        list.push(cb);
        workerTestState.socketHandlers.set(event, list);
        return socket;
      }),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(() => {
        workerTestState.socketHandlers.clear();
      }),
    };
    workerTestState.mockSocket = socket;
    return socket;
  }),
}));

vi.mock('../core/chat/persist/idb', () => ({
  chatPersistence: Object.assign(
    vi.fn(() => ({
      preloadHotData: vi.fn(async () => ({ messages: new Map() })),
    })),
    {
      getRuntimeInfo: vi.fn(() => ({ backend: 'idb' })),
    },
  ),
  configureChatPersistence: vi.fn(async () => undefined),
  loadHotChatCandidates: vi.fn(async () => []),
  loadMessagesBeforeSeq: vi.fn(async () => []),
  loadMessagesByIds: vi.fn(async () => []),
  loadRecentMessages: vi.fn(async () => []),
  loadSyncPts: vi.fn(async () => 0),
  saveMessages: vi.fn(async () => undefined),
  saveSyncPts: vi.fn(async () => undefined),
}));

vi.mock('../core/chat/persist/driverSelection', () => ({
  selectChatPersistenceDriver: vi.fn(async () => ({
    driver: {
      preloadHotData: vi.fn(async () => ({ messages: new Map() })),
    },
    selection: {
      requested: 'idb',
      fallbackReason: null,
    },
  })),
}));

vi.mock('../core/chat/persist/sqliteOpfsDriver', () => ({
  createSqliteOpfsDriver: vi.fn(() => null),
}));

vi.mock('../core/wasm/chat_wasm/wasm', () => ({
  getChatWasmApi: vi.fn(async () => null),
}));

vi.mock('../core/chat/runtimeFlags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/chat/runtimeFlags')>();
  return {
    ...actual,
    runtimeFlags: {
      ...actual.runtimeFlags,
      wasmRequired: false,
      wasmSeqOps: false,
    },
  };
});

function triggerSocketEvent(event: string, ...args: unknown[]) {
  const list = workerTestState.socketHandlers.get(event) || [];
  for (const cb of list) {
    cb(...args);
  }
}

describe('chatCore.worker lifecycle & sync guards', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    workerTestState.exposedApi = null;
    workerTestState.mockSocket = null;
    workerTestState.socketHandlers.clear();
  });

  afterEach(async () => {
    if (workerTestState.exposedApi) {
      await workerTestState.exposedApi.shutdown();
    }
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('does not schedule HTTP sync loop when disconnectRealtime triggers manual disconnect', async () => {
    const syncStateCalls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sync/state')) {
        syncStateCalls.push(url);
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: { protocolVersion: 2, watermarkField: 'updateId', pts: 10 },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-sync-protocol-version': '2',
            'x-sync-watermark-field': 'updateId',
            'x-sync-server-pts': '10',
            'x-sync-state-pts': '10',
          },
        },
      );
    }) as typeof fetch;

    await import('../core/workers/chatCore.worker');
    const api = workerTestState.exposedApi!;
    expect(api).toBeTruthy();

    await api.init({
      userId: 'u-1',
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      apiBaseUrl: 'https://api.example.com',
      socketUrl: 'https://api.example.com',
      enableWorkerSocket: true,
      runtimeOverrides: {
        workerSyncFallback: true,
        wasmRequired: false,
      },
    });

    // 模拟 Socket 建连成功并完成鉴权
    if (workerTestState.mockSocket) {
      workerTestState.mockSocket.connected = true;
    }
    triggerSocketEvent('connect');
    triggerSocketEvent('authenticated');

    // 模拟 ChatPage 卸载主动调用 disconnectRealtime
    await api.disconnectRealtime();
    await vi.advanceTimersByTimeAsync(5000);

    const runtime = await api.getRuntimeInfo();
    expect(runtime.telemetry.syncLoopStarts).toBe(0);
    expect(syncStateCalls).toHaveLength(0);
  });

  it('deduplicates concurrent /api/sync/state fetches during gap recovery', async () => {
    let resolveSyncState!: (res: Response) => void;
    let syncStateCallCount = 0;

    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sync/state')) {
        syncStateCallCount += 1;
        return new Promise<Response>((resolve) => {
          resolveSyncState = resolve;
        });
      }
      if (url.includes('/api/sync/updates')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: { protocolVersion: 2, watermarkField: 'updateId', updates: [], messages: [], state: { pts: 0 } },
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'x-sync-protocol-version': '2',
                'x-sync-watermark-field': 'updateId',
                'x-sync-server-pts': '0',
                'x-sync-state-pts': '0',
              },
            },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
    }) as typeof fetch;

    await import('../core/workers/chatCore.worker');
    const api = workerTestState.exposedApi!;

    await api.init({
      userId: 'u-1',
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      apiBaseUrl: 'https://api.example.com',
      socketUrl: 'https://api.example.com',
      enableWorkerSocket: true,
      runtimeOverrides: {
        workerSyncFallback: true,
        wasmRequired: false,
      },
    });

    // 触发意外断连与并发的令牌刷新恢复，验证只会发出一次 /api/sync/state
    triggerSocketEvent('disconnect');
    await vi.advanceTimersByTimeAsync(1200);
    await api.updateTokens('token-2', 'refresh-2');

    expect(syncStateCallCount).toBe(1);

    resolveSyncState(
      new Response(
        JSON.stringify({
          success: true,
          data: { protocolVersion: 2, watermarkField: 'updateId', pts: 0 },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-sync-protocol-version': '2',
            'x-sync-watermark-field': 'updateId',
            'x-sync-server-pts': '0',
            'x-sync-state-pts': '0',
          },
        },
      ),
    );
    await Promise.resolve();
    await Promise.resolve();

    // 优雅关闭前验证不再发新请求
    await api.shutdown();
    expect(syncStateCallCount).toBe(1);
  });

  it('does not block markChatRead or flip authBlocked when background prefetch receives 403 Forbidden', async () => {
    const readHttpCalls: string[] = [];
    const { loadHotChatCandidates } = await import('../core/chat/persist/idb');
    vi.mocked(loadHotChatCandidates).mockResolvedValueOnce([
      { chatId: 'g:forbidden-group', isGroup: true, lastTs: Date.now() },
      { chatId: 'p:other-a:other-b', isGroup: false, lastTs: Date.now() },
    ]);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('forbidden-group')) {
        return new Response(JSON.stringify({ success: false, message: 'Forbidden' }), { status: 403 });
      }
      if (url.includes('/api/messages/chat/p%3Au-1%3Au-2/read')) {
        readHttpCalls.push(url);
        return new Response(JSON.stringify({ success: true, data: { chatId: 'p:u-1:u-2', seq: 5, readCount: 1 } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }) as typeof fetch;

    await import('../core/workers/chatCore.worker');
    const api = workerTestState.exposedApi!;

    await api.init({
      userId: 'u-1',
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      apiBaseUrl: 'https://api.example.com',
      socketUrl: 'https://api.example.com',
      enableWorkerSocket: true,
      runtimeOverrides: {
        workerSyncFallback: false,
        wasmRequired: false,
      },
    });

    if (workerTestState.mockSocket) {
      workerTestState.mockSocket.connected = true;
    }
    triggerSocketEvent('connect');
    triggerSocketEvent('authenticated');

    // 等待预取触发 403
    await vi.advanceTimersByTimeAsync(100);

    await api.markChatRead('p:u-1:u-2', 5);

    const runtime = await api.getRuntimeInfo();
    expect(runtime.sync.authBlocked).toBe(false);
    expect(workerTestState.mockSocket?.emit).toHaveBeenCalledWith('readChat', {
      chatId: 'p:u-1:u-2',
      seq: 5,
    });
    expect(readHttpCalls).toHaveLength(1);
  });
});
