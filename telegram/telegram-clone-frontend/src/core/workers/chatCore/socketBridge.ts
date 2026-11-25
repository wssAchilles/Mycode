/**
 * Socket.IO bridge — connection lifecycle, event dispatch, worker-side socket mode.
 *
 * Single responsibility: socket connection management.
 * Sync-related callbacks are injected via SocketBridgeContext.
 */

import { io, type Socket } from 'socket.io-client';
import type { SocketMessageSendAck } from '../../chat/types';
import type { SocketRealtimeEvent } from '../../chat/realtime';

// ---------------------------------------------------------------------------
// Context interface — worker provides these to decouple socket from sync state
// ---------------------------------------------------------------------------

export interface SocketBridgeContext {
  // State getters
  getAccessToken: () => string | null;
  getApiBaseUrl: () => string;
  getIsInited: () => boolean;
  getCurrentUserId: () => string | null;
  getWorkerSocketEnabled: () => boolean;

  // Telemetry
  telemetry: Record<string, number>;
  markTelemetryUpdate: () => void;

  // Sync callbacks
  setSyncPhase: (phase: string, reason?: string) => void;
  stopSyncLoop: () => void;
  requestReadSyncFlush: (delayMs: number) => void;
  setConnectivityFromSocket: (connected: boolean, reason: string) => void;

  // Realtime callback
  enqueueRealtimeEventsForIngest: (events: SocketRealtimeEvent[], source: 'socket' | 'api') => void;
  enqueueTypingUpdate?: (update: {
    chatId: string;
    userId: string;
    username: string;
    isTyping: boolean;
  }) => void;

  // Shared mutable state (owned by worker, referenced by bridge)
  desiredJoinedRooms: Set<string>;
  setSyncAuthError: (error: boolean) => void;
  setSocketConnected: (connected: boolean) => void;
  setWorkerSocketAuthBlocked: (blocked: boolean) => void;
}

// ---------------------------------------------------------------------------
// Socket bridge
// ---------------------------------------------------------------------------

export class SocketBridge {
  private socket: Socket | null = null;
  private socketUrl = '';
  private socketConnectRequested = false;
  private socketHandlersBound = false;
  private socketLastConnectAttemptAt = 0;
  private workerSocketAuthBlocked = false;
  private workerSocketAuthenticated = false;
  private lastAuthTokenSent: string | null = null;
  private previousAuthToken: string | null = null;
  private lastTokenRotateAt = 0;
  private pendingAuthTokens: string[] = [];
  private readonly desiredPresenceUserIds = new Set<string>();

  private readonly SOCKET_CONNECT_THROTTLE_MS = 1_000;
  private readonly MAX_PRESENCE_SUBSCRIBE_BATCH = 200;
  private readonly STALE_AUTH_ERROR_GRACE_MS = 5_000;

  constructor(private readonly ctx: SocketBridgeContext) {}

  // -------------------------------------------------------------------------
  // URL derivation
  // -------------------------------------------------------------------------

  deriveSocketUrl(apiUrl: string): string {
    try {
      const u = new URL(apiUrl);
      if (u.pathname.startsWith('/api')) {
        u.pathname = '';
      }
      u.search = '';
      u.hash = '';
      return u.toString().replace(/\/$/, '');
    } catch {
      return apiUrl.replace(/\/$/, '');
    }
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  detachWorkerSocket(): void {
    if (!this.socket) return;
    try {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    } catch {
      // ignore
    }
    this.socket = null;
    this.socketHandlersBound = false;
    this.socketConnectRequested = false;
    this.workerSocketAuthenticated = false;
    this.lastAuthTokenSent = null;
    this.previousAuthToken = null;
    this.lastTokenRotateAt = 0;
    this.pendingAuthTokens = [];
    this.socketLastConnectAttemptAt = 0;
  }

  private emitAuthenticate(socket: Socket, token: string): void {
    const cleanToken = token.trim();
    if (!cleanToken) return;
    if (this.lastAuthTokenSent && this.lastAuthTokenSent !== cleanToken) {
      this.previousAuthToken = this.lastAuthTokenSent;
      this.lastTokenRotateAt = Date.now();
    }
    this.lastAuthTokenSent = cleanToken;
    this.workerSocketAuthenticated = false;
    this.pendingAuthTokens.push(cleanToken);
    if (this.pendingAuthTokens.length > 16) {
      this.pendingAuthTokens.splice(0, this.pendingAuthTokens.length - 16);
    }
    socket.emit('authenticate', { token: cleanToken });
  }

  requestWorkerSocketConnect(force = false): void {
    if (!this.socket) return;
    if (this.workerSocketAuthBlocked) return;
    const now = Date.now();
    if (!force && now - this.socketLastConnectAttemptAt < this.SOCKET_CONNECT_THROTTLE_MS) {
      return;
    }
    this.socketLastConnectAttemptAt = now;
    this.socketConnectRequested = true;
    this.socket.connect();
  }

  bindWorkerSocketHandlers(socket: Socket): void {
    if (this.socketHandlersBound) return;
    this.socketHandlersBound = true;

    socket.on('connect', () => {
      this.ctx.telemetry.socketConnects += 1;
      this.ctx.markTelemetryUpdate();
      this.workerSocketAuthBlocked = false;
      this.workerSocketAuthenticated = false;
      this.pendingAuthTokens = [];
      this.ctx.setWorkerSocketAuthBlocked(false);
      this.socketConnectRequested = true;
      this.socketLastConnectAttemptAt = Date.now();
      const token = this.ctx.getAccessToken();
      if (token) {
        this.emitAuthenticate(socket, token);
      }
      void this.ctx.setConnectivityFromSocket(true, 'worker_socket_connected');
    });

    socket.on('disconnect', () => {
      this.socketConnectRequested = false;
      this.workerSocketAuthenticated = false;
      void this.ctx.setConnectivityFromSocket(false, 'worker_socket_disconnected');
    });

    socket.on('connect_error', () => {
      this.ctx.telemetry.socketConnectErrors += 1;
      this.ctx.markTelemetryUpdate();
      this.socketConnectRequested = false;
      void this.ctx.setConnectivityFromSocket(false, 'worker_socket_connect_error');
    });

    socket.on('authenticated', () => {
      this.pendingAuthTokens.shift();
      this.ctx.setSyncAuthError(false);
      this.workerSocketAuthBlocked = false;
      this.workerSocketAuthenticated = true;
      this.ctx.setWorkerSocketAuthBlocked(false);
      if (this.ctx.desiredJoinedRooms.size) {
        for (const roomId of this.ctx.desiredJoinedRooms.values()) {
          socket.emit('joinRoom', { roomId });
        }
      }
      this.emitPresenceSubscribe(socket);
      this.ctx.setSyncPhase('live', 'worker_socket_authenticated');
      this.ctx.stopSyncLoop();
      this.ctx.requestReadSyncFlush(0);
    });

    socket.on('authError', () => {
      const shiftedToken = this.pendingAuthTokens.shift();
      const failedToken = shiftedToken ?? this.lastAuthTokenSent;
      const latestToken = this.ctx.getAccessToken()?.trim() || null;

      // 若上下文中已有更新的令牌，说明当前 authError 是旧令牌的迟到响应，直接用新令牌重认证而不阻断会话
      if (latestToken && failedToken && latestToken !== failedToken) {
        this.workerSocketAuthBlocked = false;
        this.ctx.setWorkerSocketAuthBlocked(false);
        this.emitAuthenticate(socket, latestToken);
        return;
      }

      // 若队列中仍有更新一次发出的认证请求尚未返回，保留连接等待最新认证结果
      if (this.pendingAuthTokens.length > 0) {
        this.workerSocketAuthBlocked = false;
        this.ctx.setWorkerSocketAuthBlocked(false);
        return;
      }

      // 乱序竞态保护：若刚刚完成了令牌轮换且当前已处于 authenticated 状态，忽略一次旧令牌的迟到失败回报
      if (
        this.workerSocketAuthenticated
        && this.previousAuthToken
        && Date.now() - this.lastTokenRotateAt < this.STALE_AUTH_ERROR_GRACE_MS
      ) {
        this.previousAuthToken = null;
        return;
      }

      this.ctx.setSyncAuthError(true);
      this.workerSocketAuthBlocked = true;
      this.workerSocketAuthenticated = false;
      this.ctx.setWorkerSocketAuthBlocked(true);
      this.socketConnectRequested = false;
      void this.ctx.setConnectivityFromSocket(false, 'worker_socket_auth_error');
      this.detachWorkerSocket();
      this.ctx.setSyncPhase('auth_error', 'socket_auth');
    });

    socket.on('realtimeBatch', (events: SocketRealtimeEvent[]) => {
      this.ctx.enqueueRealtimeEventsForIngest(events, 'socket');
    });

    const handleTypingEvent = (isTyping: boolean) => (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return;
      const data = raw as { userId?: unknown; username?: unknown; groupId?: unknown };
      const userId = typeof data.userId === 'string' ? data.userId.trim() : '';
      if (!userId || userId === this.ctx.getCurrentUserId()) return;
      const rawGroupId = typeof data.groupId === 'string' ? data.groupId.trim().replace(/^g:/, '') : '';
      const chatId = rawGroupId || userId;
      const username = typeof data.username === 'string' && data.username.trim() ? data.username.trim() : '对方';
      this.ctx.enqueueTypingUpdate?.({ chatId, userId, username, isTyping });
    };

    socket.on('typingStart', handleTypingEvent(true));
    socket.on('typingStop', handleTypingEvent(false));
  }

  async connectWorkerSocketInternal(force = false): Promise<void> {
    if (!this.ctx.getWorkerSocketEnabled()) return;
    if (this.workerSocketAuthBlocked) throw new Error('AUTH_ERROR');
    if (!this.ctx.getIsInited()) return;
    const token = this.ctx.getAccessToken();
    if (!token) return;
    if (!this.ctx.getCurrentUserId()) return;

    if (!this.socketUrl) {
      this.socketUrl = this.deriveSocketUrl(this.ctx.getApiBaseUrl());
    }

    if (this.socket) {
      if (!this.socket.connected && (force || !this.socketConnectRequested)) {
        this.requestWorkerSocketConnect(force);
      }
      return;
    }

    this.socketConnectRequested = true;
    this.socketLastConnectAttemptAt = Date.now();
    try {
      const socket = io(this.socketUrl, {
        transports: ['websocket', 'polling'],
        timeout: 5000,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        forceNew: true,
      });
      this.socket = socket;
      this.bindWorkerSocketHandlers(socket);
    } catch (err) {
      this.ctx.telemetry.socketConnectErrors += 1;
      this.ctx.markTelemetryUpdate();
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Emit helpers
  // -------------------------------------------------------------------------

  async emitWorkerSocket(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.ctx.getWorkerSocketEnabled()) return;
    await this.connectWorkerSocketInternal();
    if (!this.socket) throw new Error('SOCKET_NOT_AVAILABLE');
    if (!this.socket.connected) {
      this.requestWorkerSocketConnect();
      throw new Error('SOCKET_NOT_CONNECTED');
    }
    if (!this.workerSocketAuthenticated) {
      throw new Error('SOCKET_NOT_AUTHENTICATED');
    }
    this.socket.emit(event as any, payload as any);
  }

  async emitWorkerSocketWithAck(
    event: string,
    payload: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<SocketMessageSendAck> {
    if (!this.ctx.getWorkerSocketEnabled()) {
      return { success: false, error: 'SOCKET_DISABLED' };
    }

    await this.connectWorkerSocketInternal();
    if (!this.socket) {
      return { success: false, error: 'SOCKET_NOT_AVAILABLE' };
    }
    if (!this.socket.connected) {
      this.requestWorkerSocketConnect();
      return { success: false, error: 'SOCKET_NOT_CONNECTED' };
    }
    if (!this.workerSocketAuthenticated) {
      return { success: false, error: 'SOCKET_NOT_AUTHENTICATED' };
    }

    return new Promise<SocketMessageSendAck>((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ success: false, error: 'ACK_TIMEOUT' });
      }, timeoutMs);

      this.socket!.emit(event as any, payload as any, (ack: SocketMessageSendAck) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!ack || typeof ack.success !== 'boolean') {
          resolve({ success: false, error: 'ACK_INVALID' });
          return;
        }
        if (!ack.success && this.isAckAuthenticationError(ack.error)) {
          // 会话内缓存令牌已过期，标记待重认证，交由上层 HTTP Fallback 触发单飞刷新后通过 updateTokens 恢复
          this.workerSocketAuthenticated = false;
        }
        resolve(ack);
      });
    });
  }

  private isAckAuthenticationError(reason?: string): boolean {
    if (!reason) return false;
    const normalized = String(reason).trim().toUpperCase();
    return (
      normalized.includes('AUTH_ERROR')
      || normalized.includes('NOT_AUTHENTICATED')
      || normalized.includes('UNAUTHORIZED')
      || /\b401\b/.test(normalized)
    );
  }

  // 主线程完成 401 单飞刷新后同步新令牌至桥接器，解除阻断并向已连接 Socket 重发 authenticate
  async handleTokensUpdated(nextAccessToken: string): Promise<void> {
    this.workerSocketAuthBlocked = false;
    this.ctx.setWorkerSocketAuthBlocked(false);
    const cleanToken = nextAccessToken.trim();
    if (!this.ctx.getWorkerSocketEnabled() || !cleanToken) return;
    await this.connectWorkerSocketInternal(true);
    if (this.socket?.connected) {
      if (!this.workerSocketAuthenticated || this.lastAuthTokenSent !== cleanToken) {
        this.emitAuthenticate(this.socket, cleanToken);
      }
    }
  }

  async subscribePresence(userIds: string[]): Promise<void> {
    this.desiredPresenceUserIds.clear();
    if (Array.isArray(userIds)) {
      for (const userId of userIds) {
        const clean = typeof userId === 'string' ? userId.trim() : '';
        if (clean && clean !== 'ai') {
          this.desiredPresenceUserIds.add(clean);
        }
      }
    }
    if (!this.desiredPresenceUserIds.size) return;
    await this.connectWorkerSocketInternal();
    // 严格等待 Socket 完成认证后再发送订阅，防止未认证抢跑触发网关 authError 断连锁定
    if (!this.socket?.connected || !this.workerSocketAuthenticated) return;
    this.emitPresenceSubscribe(this.socket);
  }

  clearPresenceSubscriptions(): void {
    this.desiredPresenceUserIds.clear();
  }

  private emitPresenceSubscribe(socket: Socket): void {
    if (!this.desiredPresenceUserIds.size || !this.workerSocketAuthenticated) return;
    const allIds = Array.from(this.desiredPresenceUserIds);
    for (let i = 0; i < allIds.length; i += this.MAX_PRESENCE_SUBSCRIBE_BATCH) {
      socket.emit('presenceSubscribe', allIds.slice(i, i + this.MAX_PRESENCE_SUBSCRIBE_BATCH));
    }
  }

  // -------------------------------------------------------------------------
  // State accessors
  // -------------------------------------------------------------------------

  getSocket(): Socket | null {
    return this.socket;
  }

  isSocketConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  isAuthBlocked(): boolean {
    return this.workerSocketAuthBlocked;
  }

  getSocketUrl(): string {
    return this.socketUrl;
  }
}
