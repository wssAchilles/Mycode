import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_CORE_PROTOCOL_VERSION, type ChatCoreInit } from '../core/chat/types';

const bridgeMocks = vi.hoisted(() => ({
  api: null as any,
  getApi: vi.fn(() => bridgeMocks.api),
  ping: vi.fn(async () => true),
  terminate: vi.fn(),
  generation: vi.fn(() => 1),
}));

vi.mock('../core/bridge/workerBridge', () => ({
  getChatCoreApi: bridgeMocks.getApi,
  pingChatCoreWorker: bridgeMocks.ping,
  terminateChatCoreWorker: bridgeMocks.terminate,
  getChatCoreWorkerGeneration: bridgeMocks.generation,
}));

vi.mock('../perf/marks', () => ({
  markWorkerRecoverStart: vi.fn(),
  markWorkerRecoverEnd: vi.fn(),
}));

vi.mock('../core/chat/runtimeFlags', () => ({
  runtimeFlags: {
    strictWorkerBaseline: false,
  },
}));

function createRuntimeInfo() {
  return {
    protocolVersion: CHAT_CORE_PROTOCOL_VERSION,
    workerBuildId: '',
  } as const;
}

function createInitParams(overrides: Partial<ChatCoreInit> = {}): ChatCoreInit {
  return {
    userId: '123',
    accessToken: 'access-token-a',
    refreshToken: 'refresh-token-a',
    apiBaseUrl: 'https://api.xuziqi.tech',
    socketUrl: 'https://api.xuziqi.tech',
    enableWorkerSocket: true,
    runtimeOverrides: {},
    ...overrides,
  };
}

async function loadClient() {
  const module = await import('../core/bridge/chatCoreClient');
  return module.chatCoreClient;
}

describe('chatCoreClient', () => {
  beforeEach(() => {
    vi.resetModules();
    bridgeMocks.api = {
      init: vi.fn(async () => undefined),
      getRuntimeInfo: vi.fn(async () => createRuntimeInfo()),
      updateTokens: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
    };
    bridgeMocks.getApi.mockImplementation(() => bridgeMocks.api);
    bridgeMocks.ping.mockResolvedValue(true);
    bridgeMocks.terminate.mockReset();
  });

  afterEach(async () => {
    const client = await loadClient();
    await client.shutdown();
  });

  it('refreshes worker tokens for same-user reentry without forcing a cold re-init', async () => {
    const client = await loadClient();
    const firstInit = createInitParams();
    const secondInit = createInitParams({
      accessToken: 'access-token-b',
      refreshToken: 'refresh-token-b',
    });

    await client.init(firstInit);
    await client.init(secondInit);

    expect(bridgeMocks.api.init).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.api.updateTokens).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.api.updateTokens).toHaveBeenCalledWith('access-token-b', 'refresh-token-b');
    expect(bridgeMocks.api.getRuntimeInfo).toHaveBeenCalledTimes(2);
  });

  it('forces a worker re-init when the structural runtime contract changes', async () => {
    const client = await loadClient();
    const firstInit = createInitParams({
      socketUrl: 'https://api.xuziqi.tech',
    });
    const secondInit = createInitParams({
      socketUrl: 'https://realtime.xuziqi.tech',
      accessToken: 'access-token-b',
    });

    await client.init(firstInit);
    await client.init(secondInit);

    expect(bridgeMocks.api.init).toHaveBeenCalledTimes(2);
    expect(bridgeMocks.api.updateTokens).not.toHaveBeenCalled();
  });

  it('syncs refreshed tokens on auth:tokens-updated without duplicate RPCs and unbinds on shutdown', async () => {
    const client = await loadClient();
    await client.init(createInitParams());

    window.dispatchEvent(new CustomEvent('auth:tokens-updated', {
      detail: { accessToken: 'access-token-b', refreshToken: 'refresh-token-b' },
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(bridgeMocks.api.updateTokens).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.api.updateTokens).toHaveBeenCalledWith('access-token-b', 'refresh-token-b');

    // 重复派发相同令牌不应再次触发 RPC
    window.dispatchEvent(new CustomEvent('auth:tokens-updated', {
      detail: { accessToken: 'access-token-b', refreshToken: 'refresh-token-b' },
    }));
    await client.updateTokens('access-token-b', 'refresh-token-b');
    expect(bridgeMocks.api.updateTokens).toHaveBeenCalledTimes(1);

    await client.shutdown();
    window.dispatchEvent(new CustomEvent('auth:tokens-updated', {
      detail: { accessToken: 'access-token-c', refreshToken: 'refresh-token-c' },
    }));
    await Promise.resolve();
    expect(bridgeMocks.api.updateTokens).toHaveBeenCalledTimes(1);
  });
});
