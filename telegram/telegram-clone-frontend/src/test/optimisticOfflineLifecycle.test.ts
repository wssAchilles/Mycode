import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createRealtimeActions } from '../features/chat/store/actions/realtimeActions';
import type { MessageStoreDeps, SetState, GetState } from '../features/chat/store/actions/types';
import type { MessageState } from '../features/chat/store/messageTypes';
import * as offlineQueue from '../core/chat/offlineQueue';
import { messageAPI } from '../services/apiClient';
import chatCoreClient from '../core/bridge/chatCoreClient';

vi.mock('../core/chat/offlineQueue', async () => {
  const actual = await vi.importActual<typeof offlineQueue>('../core/chat/offlineQueue');
  return {
    ...actual,
    enqueueMessage: vi.fn().mockResolvedValue('offline_mock_id'),
    flushOfflineQueue: vi.fn().mockResolvedValue({ attempted: 0, sent: 0, failed: 0, remaining: 0 }),
  };
});

vi.mock('../core/bridge/chatCoreClient', () => ({
  default: {
    sendSocketMessage: vi.fn(),
    ensureCoreReady: vi.fn().mockResolvedValue(undefined),
    connectRealtime: vi.fn().mockResolvedValue(undefined),
    disconnectRealtime: vi.fn().mockResolvedValue(undefined),
    getRuntimeInfo: vi.fn().mockResolvedValue({}),
    subscribePresence: vi.fn().mockResolvedValue(undefined),
    setConnectivity: vi.fn().mockResolvedValue(undefined),
    ingestSocketMessages: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/apiClient', () => ({
  messageAPI: {
    sendMessage: vi.fn(),
  },
  authUtils: {
    getCurrentUser: vi.fn().mockReturnValue({ id: 'current-user-id' }),
  },
}));

describe('optimisticOfflineLifecycle - 离线生命周期与容灾保护', () => {
  let mockDeps: MessageStoreDeps;
  let mockSet: SetState;
  let mockGet: GetState;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDeps = {
      PREFETCH_COOLDOWN_MS: 3000,
      resetProjectionCaches: vi.fn(),
      rebuildVisibleEntities: vi.fn(),
      insertOptimisticPendingMessage: vi.fn(),
      removeOptimisticPendingMessage: vi.fn(),
      pendingPatches: [],
      ensureCoreReady: vi.fn().mockResolvedValue(undefined),
      ingestQueue: [],
      trimIngestQueue: vi.fn(),
      flushIngestQueue: vi.fn(),
      enqueueRealtimeEvent: vi.fn(),
      enqueueRealtimeBatch: vi.fn(),
      setWorkerRealtimeMode: vi.fn(),
      clearRealtimeQueue: vi.fn(),
      shouldBridgeLegacyRealtime: vi.fn().mockReturnValue(false),
      prefetchInFlight: new Set(),
      prefetchLastAt: new Map(),
    };

    mockGet = vi.fn().mockReturnValue({
      socketConnected: false,
      syncPhase: 'disconnected',
    } as unknown as MessageState);

    mockSet = vi.fn();
  });

  it('在 Socket 失败且 HTTP fallback 也因断网超时失败时，严禁抹除乐观卡片，必须写入离线持久化队列', async () => {
    const actions = createRealtimeActions(mockSet, mockGet, mockDeps);

    // 模拟 Socket 离线
    vi.mocked(chatCoreClient.sendSocketMessage).mockResolvedValue({
      success: false,
      error: 'SOCKET_DISCONNECTED',
    });

    // 模拟 HTTP 发送抛出网络不可达错误
    vi.mocked(messageAPI.sendMessage).mockRejectedValue(new Error('Network Offline Timeout'));

    const sendPayload = {
      content: '断网消息测试内容',
      receiverId: 'receiver-user-123',
      clientTempId: 'temp_offline_test_1',
      type: 'text' as const,
    };

    const result = await actions.sendRealtimeMessage(sendPayload);

    // 1. 验证乐观卡片先插入
    expect(mockDeps.insertOptimisticPendingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTempId: 'temp_offline_test_1',
        content: '断网消息测试内容',
      }),
    );

    // 2. 关键断言：严禁调用 removeOptimisticPendingMessage 将用户未发出的消息从屏幕上抹去！
    expect(mockDeps.removeOptimisticPendingMessage).not.toHaveBeenCalled();

    // 3. 关键断言：必须调用 enqueueMessage 写入离线持久化存储
    expect(offlineQueue.enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTempId: 'temp_offline_test_1',
        content: '断网消息测试内容',
        receiverId: 'receiver-user-123',
      }),
    );

    // 4. 返回结果指明失败原因
    expect(result.success).toBe(false);
  });
});
