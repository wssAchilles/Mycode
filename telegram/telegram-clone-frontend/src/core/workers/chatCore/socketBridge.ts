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

  private readonly SOCKET_CONNECT_THROTTLE_MS = 1_000;

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
    this.socketLastConnectAttemptAt = 0;
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
      this.ctx.setWorkerSocketAuthBlocked(false);
      this.socketConnectRequested = true;
      this.socketLastConnectAttemptAt = Date.now();
      const token = this.ctx.getAccessToken();
      if (token) {
        socket.emit('authenticate', { token });
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
      this.ctx.setSyncAuthError(false);
      this.workerSocketAuthBlocked = false;
      this.workerSocketAuthenticated = true;
      this.ctx.setWorkerSocketAuthBlocked(false);
      if (this.ctx.desiredJoinedRooms.size) {
        for (const roomId of this.ctx.desiredJoinedRooms.values()) {
          socket.emit('joinRoom', { roomId });
        }
      }
      this.ctx.setSyncPhase('live', 'worker_socket_authenticated');
      this.ctx.stopSyncLoop();
      this.ctx.requestReadSyncFlush(0);
    });

    socket.on('authError', () => {
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
        resolve(ack);
      });
    });
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
