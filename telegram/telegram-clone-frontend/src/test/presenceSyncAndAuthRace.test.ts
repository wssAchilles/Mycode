import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketBridge, type SocketBridgeContext } from '../core/workers/chatCore/socketBridge';
import {
  collectPresenceTargetUserIds,
  deriveSelfPresence,
  resolveMergedPresence,
} from '../features/chat/presence/presenceState';
import { useChatStore } from '../features/chat/store/chatStore';
import { contactAPI, groupAPI } from '../services/apiClient';

type EventHandler = (...args: any[]) => void;

const socketControl = vi.hoisted(() => {
  interface MockSocket {
    connected: boolean;
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    listeners: Map<string, EventHandler[]>;
  }

  const sockets: MockSocket[] = [];

  const createSocket = (): MockSocket => {
    const listeners = new Map<string, EventHandler[]>();
    const instance: MockSocket = {
      connected: false,
      listeners,
      on: vi.fn((event: string, handler: EventHandler) => {
        const list = listeners.get(event) || [];
        list.push(handler);
        listeners.set(event, list);
      }),
      emit: vi.fn(),
      connect: vi.fn(() => {
        instance.connected = true;
      }),
      disconnect: vi.fn(() => {
        instance.connected = false;
      }),
      removeAllListeners: vi.fn(() => {
        listeners.clear();
      }),
    };
    sockets.push(instance);
    return instance;
  };

  return {
    sockets,
    ioMock: vi.fn(() => createSocket()),
    latest(): MockSocket {
      return sockets[sockets.length - 1];
    },
    trigger(socketIndex: number, event: string, ...args: any[]) {
      const target = sockets[socketIndex];
      if (!target) return;
      for (const handler of target.listeners.get(event) || []) {
        handler(...args);
      }
    },
    reset() {
      sockets.length = 0;
      this.ioMock.mockClear();
    },
  };
});

vi.mock('socket.io-client', () => ({
  io: socketControl.ioMock,
}));

function createBridgeContext(tokenHolder: { token: string }): {
  ctx: SocketBridgeContext;
  setSyncPhase: ReturnType<typeof vi.fn>;
  setWorkerSocketAuthBlocked: ReturnType<typeof vi.fn>;
} {
  const setSyncPhase = vi.fn();
  const setWorkerSocketAuthBlocked = vi.fn();

  const ctx: SocketBridgeContext = {
    getAccessToken: () => tokenHolder.token,
    getApiBaseUrl: () => 'https://api.example.com',
    getIsInited: () => true,
    getCurrentUserId: () => 'user-self',
    getWorkerSocketEnabled: () => true,
    telemetry: { socketConnects: 0, socketConnectErrors: 0 },
    markTelemetryUpdate: vi.fn(),
    setSyncPhase,
    stopSyncLoop: vi.fn(),
    requestReadSyncFlush: vi.fn(),
    setConnectivityFromSocket: vi.fn().mockResolvedValue(undefined),
    enqueueRealtimeEventsForIngest: vi.fn(),
    desiredJoinedRooms: new Set<string>(),
    setSyncAuthError: vi.fn(),
    setSocketConnected: vi.fn(),
    setWorkerSocketAuthBlocked,
  };

  return { ctx, setSyncPhase, setWorkerSocketAuthBlocked };
}

describe('SocketBridge 鉴权竞态与重连恢复', () => {
  beforeEach(() => {
    socketControl.reset();
    vi.restoreAllMocks();
  });

  it('先刷新令牌后收到旧令牌迟到 authError 时，保持连接不阻断并完成 presence 订阅', async () => {
    const tokenHolder = { token: 'jwt-old' };
    const { ctx, setSyncPhase } = createBridgeContext(tokenHolder);
    const bridge = new SocketBridge(ctx);

    await bridge.connectWorkerSocketInternal();
    const sock = socketControl.latest();
    sock.connected = true;
    await bridge.subscribePresence(['u-1', 'u-2']);
    socketControl.trigger(0, 'connect');

    // 先刷新令牌并发送新令牌 authenticate
    tokenHolder.token = 'jwt-new';
    await bridge.handleTokensUpdated('jwt-new');

    // 紧接着旧 jwt-old 的迟到 authError 返回：不能杀掉当前连接
    socketControl.trigger(0, 'authError', { code: 'AUTH_ERROR' });
    expect(bridge.isAuthBlocked()).toBe(false);
    expect(sock.disconnect).not.toHaveBeenCalled();
    expect(setSyncPhase).not.toHaveBeenCalledWith('auth_error', 'socket_auth');

    // 新令牌 authenticated 到达后恢复 live 并自动补发 presenceSubscribe
    socketControl.trigger(0, 'authenticated', { userId: 'user-self' });
    const presenceCalls = sock.emit.mock.calls.filter((call) => call[0] === 'presenceSubscribe');
    expect(presenceCalls).toHaveLength(1);
    expect(presenceCalls[0][1]).toEqual(['u-1', 'u-2']);
    expect(setSyncPhase).toHaveBeenCalledWith('live', 'worker_socket_authenticated');
  });

  it('上下文令牌已更新而 authError 先于 handleTokensUpdated 到达时，直接原地重发新令牌认证', async () => {
    const tokenHolder = { token: 'jwt-old' };
    const { ctx } = createBridgeContext(tokenHolder);
    const bridge = new SocketBridge(ctx);

    await bridge.connectWorkerSocketInternal();
    const sock = socketControl.latest();
    sock.connected = true;
    socketControl.trigger(0, 'connect');

    // 主线程已写入最新令牌，旧请求的 authError 才到达
    tokenHolder.token = 'jwt-new';
    socketControl.trigger(0, 'authError', { code: 'AUTH_ERROR' });

    expect(bridge.isAuthBlocked()).toBe(false);
    expect(sock.disconnect).not.toHaveBeenCalled();
    const authCalls = sock.emit.mock.calls.filter((call) => call[0] === 'authenticate');
    expect(authCalls.map((c) => c[1].token)).toEqual(['jwt-old', 'jwt-new']);
  });

  it('新令牌先返回 authenticated 后旧令牌 authError 乱序到达时，不销毁已就绪连接', async () => {
    const tokenHolder = { token: 'jwt-old' };
    const { ctx } = createBridgeContext(tokenHolder);
    const bridge = new SocketBridge(ctx);

    await bridge.connectWorkerSocketInternal();
    const sock = socketControl.latest();
    sock.connected = true;
    socketControl.trigger(0, 'connect');

    tokenHolder.token = 'jwt-new';
    await bridge.handleTokensUpdated('jwt-new');

    // 乱序：新令牌先完成 authenticated，旧令牌随后才返回 authError
    socketControl.trigger(0, 'authenticated', { userId: 'user-self' });
    socketControl.trigger(0, 'authError', { code: 'AUTH_ERROR' });

    expect(bridge.isAuthBlocked()).toBe(false);
    expect(sock.disconnect).not.toHaveBeenCalled();
  });

  it('当前最新令牌确实过期触发 authError 后进入阻断态，并在 handleTokensUpdated 后重建连接与重订阅', async () => {
    const tokenHolder = { token: 'jwt-expired' };
    const { ctx, setSyncPhase } = createBridgeContext(tokenHolder);
    const bridge = new SocketBridge(ctx);

    await bridge.connectWorkerSocketInternal();
    const firstSock = socketControl.latest();
    firstSock.connected = true;
    await bridge.subscribePresence(['u-peer']);
    socketControl.trigger(0, 'connect');

    socketControl.trigger(0, 'authError', { code: 'AUTH_ERROR' });
    expect(bridge.isAuthBlocked()).toBe(true);
    expect(firstSock.disconnect).toHaveBeenCalledTimes(1);
    expect(setSyncPhase).toHaveBeenCalledWith('auth_error', 'socket_auth');

    // 主线程刷新完成后更新令牌，应自动新建 Socket 并恢复订阅
    tokenHolder.token = 'jwt-fresh';
    await bridge.handleTokensUpdated('jwt-fresh');
    expect(bridge.isAuthBlocked()).toBe(false);
    expect(socketControl.sockets).toHaveLength(2);

    const secondSock = socketControl.latest();
    secondSock.connected = true;
    socketControl.trigger(1, 'connect');
    const secondAuthCalls = secondSock.emit.mock.calls.filter((call) => call[0] === 'authenticate');
    expect(secondAuthCalls.map((c) => c[1].token)).toEqual(['jwt-fresh']);

    socketControl.trigger(1, 'authenticated', { userId: 'user-self' });
    const presenceCalls = secondSock.emit.mock.calls.filter((call) => call[0] === 'presenceSubscribe');
    expect(presenceCalls).toHaveLength(1);
    expect(presenceCalls[0][1]).toEqual(['u-peer']);
  });
});

describe('presenceState 领域规则与 chatStore 在线态权威合并', () => {
  it('deriveSelfPresence 严格区分离线、连接中与真实在线', () => {
    expect(
      deriveSelfPresence({
        hasUser: false,
        isBrowserOnline: true,
        socketConnected: true,
        syncPhase: 'live',
      }),
    ).toEqual({ status: 'offline', label: '离线', isOnline: false });

    expect(
      deriveSelfPresence({
        hasUser: true,
        isBrowserOnline: false,
        socketConnected: true,
        syncPhase: 'live',
      }),
    ).toEqual({ status: 'offline', label: '离线', isOnline: false });

    expect(
      deriveSelfPresence({
        hasUser: true,
        isBrowserOnline: true,
        socketConnected: false,
        syncPhase: 'disconnected',
      }),
    ).toEqual({ status: 'connecting', label: '连接中...', isOnline: false });

    expect(
      deriveSelfPresence({
        hasUser: true,
        isBrowserOnline: true,
        socketConnected: false,
        syncPhase: 'auth_error',
      }),
    ).toEqual({ status: 'connecting', label: '重连中...', isOnline: false });

    expect(
      deriveSelfPresence({
        hasUser: true,
        isBrowserOnline: true,
        socketConnected: true,
        syncPhase: 'live',
      }),
    ).toEqual({ status: 'online', label: '在线', isOnline: true });
  });

  it('resolveMergedPresence 防止近期实时推送被滞后 HTTP 快照回滚', () => {
    const realtime = resolveMergedPresence(undefined, { isOnline: true, source: 'realtime' }, 10_000);
    expect(realtime.isOnline).toBe(true);
    expect(realtime.source).toBe('realtime');

    // 保护窗口内收到的滞后 snapshot 不应把在线冲掉
    const blockedSnapshot = resolveMergedPresence(
      realtime,
      { isOnline: false, source: 'snapshot' },
      13_000,
      8_000,
    );
    expect(blockedSnapshot).toBe(realtime);

    // 超出保护窗口后允许 snapshot 对齐
    const acceptedSnapshot = resolveMergedPresence(
      realtime,
      { isOnline: false, source: 'snapshot' },
      20_000,
      8_000,
    );
    expect(acceptedSnapshot.isOnline).toBe(false);
    expect(acceptedSnapshot.source).toBe('snapshot');
  });

  it('collectPresenceTargetUserIds 合并联系人、私聊与群成员并过滤自己和 ai', () => {
    const ids = collectPresenceTargetUserIds({
      contacts: [{ userId: 'u-2' }, { userId: 'u-self' }, { userId: 'ai' }],
      chats: [
        { id: 'u-3', isGroup: false },
        { id: 'g-1', isGroup: true },
      ],
      selectedContact: { userId: 'u-4' },
      selectedGroup: {
        members: [{ userId: 'u-2' }, { userId: 'u-5' }, { userId: 'u-self' }],
      },
      currentUserId: 'u-self',
    });

    expect(ids).toEqual(['u-2', 'u-3', 'u-4', 'u-5']);
  });

  it('chatStore 在 loadChats / loadGroupDetails 中保留实时在线态并同步群成员上下线', async () => {
    useChatStore.setState({
      chats: [],
      contacts: [],
      pendingRequests: [],
      selectedContact: null,
      selectedGroup: null,
      selectedChatId: undefined,
      isGroupChatMode: false,
      presenceByUserId: {},
      isLoading: false,
      isLoadingContacts: false,
      isLoadingPendingRequests: false,
      isLoadingGroupDetails: false,
      groupDetailsSeq: 0,
      error: null,
    });

    // 先收到实时上线事件
    useChatStore.getState().applyChatMetaBatch({
      onlineUpdates: [{ userId: 'u-2', isOnline: true }],
    });

    vi.spyOn(contactAPI, 'getContacts').mockResolvedValueOnce({
      contacts: [
        {
          id: 'c-2',
          contactId: 'u-2',
          userId: 'u-2',
          status: 'accepted',
          isOnline: false, // 模拟 HTTP 快照短暂滞后
          contact: { username: '123' },
        },
      ],
      pagination: { page: 1, limit: 1, total: 1 },
    } as any);
    vi.spyOn(groupAPI, 'getUserGroups').mockResolvedValueOnce({
      groups: [],
    } as any);

    await useChatStore.getState().loadChats();
    expect(useChatStore.getState().chats[0]).toMatchObject({ id: 'u-2', online: true });

    vi.spyOn(groupAPI, 'getGroupDetails').mockResolvedValueOnce({
      group: {
        id: 'g-1',
        name: '测试群',
        ownerId: 'u-self',
        type: 'private',
        memberCount: 2,
        maxMembers: 200,
        createdAt: '2026-01-01T00:00:00.000Z',
        isActive: true,
      },
      members: [
        {
          id: 'gm-1',
          userId: 'u-2',
          role: 'member',
          joinedAt: '2026-01-01T00:00:00.000Z',
          user: { username: '123' },
        },
      ],
      memberCount: 1,
    } as any);

    await useChatStore.getState().loadGroupDetails('g-1');
    expect(useChatStore.getState().selectedGroup?.members?.[0]?.isOnline).toBe(true);

    // 实时下线事件应同步刷新群成员在线标识
    useChatStore.getState().updateContactOnlineStatus('u-2', false);
    expect(useChatStore.getState().selectedGroup?.members?.[0]?.isOnline).toBe(false);
    expect(useChatStore.getState().chats[0]?.online).toBe(false);
  });
});
