import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketBridge, type SocketBridgeContext } from '../core/workers/chatCore/socketBridge';

type EventHandler = (...args: any[]) => void;

const socketControl = vi.hoisted(() => {
  const listeners = new Map<string, EventHandler[]>();
  const mockSocket = {
    connected: false,
    on: vi.fn((event: string, handler: EventHandler) => {
      const list = listeners.get(event) || [];
      list.push(handler);
      listeners.set(event, list);
    }),
    emit: vi.fn(),
    connect: vi.fn(() => {
      mockSocket.connected = true;
    }),
    disconnect: vi.fn(() => {
      mockSocket.connected = false;
    }),
    removeAllListeners: vi.fn(() => {
      listeners.clear();
    }),
  };

  return {
    listeners,
    mockSocket,
    ioMock: vi.fn(() => mockSocket),
    trigger(event: string, ...args: any[]) {
      for (const handler of listeners.get(event) || []) {
        handler(...args);
      }
    },
    reset() {
      listeners.clear();
      mockSocket.connected = false;
      mockSocket.on.mockClear();
      mockSocket.emit.mockClear();
      mockSocket.connect.mockClear();
      mockSocket.disconnect.mockClear();
      mockSocket.removeAllListeners.mockClear();
      this.ioMock.mockClear();
    },
  };
});

vi.mock('socket.io-client', () => ({
  io: socketControl.ioMock,
}));

function createBridgeContext(): SocketBridgeContext {
  return {
    getAccessToken: () => 'jwt-token',
    getApiBaseUrl: () => 'https://api.example.com',
    getIsInited: () => true,
    getCurrentUserId: () => 'user-self',
    getWorkerSocketEnabled: () => true,
    telemetry: { socketConnects: 0, socketConnectErrors: 0 },
    markTelemetryUpdate: vi.fn(),
    setSyncPhase: vi.fn(),
    stopSyncLoop: vi.fn(),
    requestReadSyncFlush: vi.fn(),
    setConnectivityFromSocket: vi.fn().mockResolvedValue(undefined),
    enqueueRealtimeEventsForIngest: vi.fn(),
    desiredJoinedRooms: new Set<string>(),
    setSyncAuthError: vi.fn(),
    setSocketConnected: vi.fn(),
    setWorkerSocketAuthBlocked: vi.fn(),
  };
}

describe('SocketBridge presence 订阅状态机', () => {
  beforeEach(() => {
    socketControl.reset();
  });

  it('在认证完成前绝不抢跑发送 presenceSubscribe，收到 authenticated 后自动补发', async () => {
    const bridge = new SocketBridge(createBridgeContext());

    // 先建立 Socket 连接（已连接但尚未收到 authenticated）
    await bridge.connectWorkerSocketInternal();
    socketControl.mockSocket.connected = true;

    await bridge.subscribePresence(['u-1', 'u-2', 'ai', '  ']);
    const preAuthPresenceCalls = socketControl.mockSocket.emit.mock.calls.filter(
      (call) => call[0] === 'presenceSubscribe',
    );
    expect(preAuthPresenceCalls).toHaveLength(0);

    // 完成认证后自动补发完整订阅列表（忽略 ai 和空字符串）
    socketControl.trigger('authenticated', { userId: 'user-self' });
    const postAuthPresenceCalls = socketControl.mockSocket.emit.mock.calls.filter(
      (call) => call[0] === 'presenceSubscribe',
    );
    expect(postAuthPresenceCalls).toHaveLength(1);
    expect(postAuthPresenceCalls[0][1]).toEqual(['u-1', 'u-2']);

    // 断线重连并再次认证后仍能自动重发
    socketControl.mockSocket.emit.mockClear();
    socketControl.trigger('disconnect');
    socketControl.trigger('connect');
    socketControl.trigger('authenticated', { userId: 'user-self' });
    const reconnectPresenceCalls = socketControl.mockSocket.emit.mock.calls.filter(
      (call) => call[0] === 'presenceSubscribe',
    );
    expect(reconnectPresenceCalls).toHaveLength(1);
    expect(reconnectPresenceCalls[0][1]).toEqual(['u-1', 'u-2']);
  });

  it('超过 200 个目标用户时按批次切片发送，且 clearPresenceSubscriptions 后不再补发', async () => {
    const bridge = new SocketBridge(createBridgeContext());
    await bridge.connectWorkerSocketInternal();
    socketControl.mockSocket.connected = true;
    socketControl.trigger('authenticated', { userId: 'user-self' });
    socketControl.mockSocket.emit.mockClear();

    const manyIds = Array.from({ length: 250 }, (_, idx) => `user-${idx + 1}`);
    await bridge.subscribePresence(manyIds);

    const calls = socketControl.mockSocket.emit.mock.calls.filter(
      (call) => call[0] === 'presenceSubscribe',
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toHaveLength(200);
    expect(calls[1][1]).toHaveLength(50);

    // 清理后重认证不会残留旧订阅
    socketControl.mockSocket.emit.mockClear();
    bridge.clearPresenceSubscriptions();
    socketControl.trigger('authenticated', { userId: 'user-self' });
    const callsAfterClear = socketControl.mockSocket.emit.mock.calls.filter(
      (call) => call[0] === 'presenceSubscribe',
    );
    expect(callsAfterClear).toHaveLength(0);
  });
});
