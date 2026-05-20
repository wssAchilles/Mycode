import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import { redis } from '../../config/redis';
import { getAllowedOrigins } from '../../config/allowedOrigins';
import { realtimeSessionRegistry } from '../realtimeProtocol/realtimeSessionRegistry';
import { realtimeOps } from '../realtimeProtocol/realtimeOps';
import {
  registerRoomMessageDisplayDispatcher,
} from '../realtimeProtocol/displayPlaneContract';
import { createRealtimeEventEnvelope } from '../realtimeProtocol/eventBusContracts';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { isRustRealtimeEdgePrimary } from '../realtimeProtocol/contracts';
import { createChildLogger } from '../../utils/logger';

import type {
  TypedSocketIOServer,
  TypedSocket,
  SocketHandlerContext,
  RealtimeBatchEvent,
  RealtimeDeliveryTarget,
} from './types';
import { AuthHandler } from './auth';
import { MessageHandler } from './messageHandler';
import { AiChatBridge } from './aiChatBridge';
import { BatchEmitter } from './batchEmitter';
import { RealtimeDispatcher } from './realtimeDispatcher';
import { EventPublisher } from './eventPublisher';
import { PresenceManager } from './presenceManager';
import { TypingHandler } from './typingHandler';
import { ReadReceiptHandler } from './readReceiptHandler';

const log = createChildLogger('services:socketService');

export class SocketService {
  private io: TypedSocketIOServer;
  private readonly emitLegacyRealtimeEvents = false;

  // Handler modules
  private batchEmitter!: BatchEmitter;
  private dispatcher!: RealtimeDispatcher;
  private eventPublisher!: EventPublisher;
  private presenceManager!: PresenceManager;
  private authHandler!: AuthHandler;
  private messageHandler!: MessageHandler;
  private aiChatBridge!: AiChatBridge;
  private typingHandler!: TypingHandler;
  private readReceiptHandler!: ReadReceiptHandler;

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: { origin: getAllowedOrigins(), methods: ['GET', 'POST'], credentials: true },
      transports: ['websocket', 'polling'],
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true,
      },
    }) as unknown as TypedSocketIOServer;

    this.attachRedisAdapter();

    this.batchEmitter = new BatchEmitter();
    this.dispatcher = new RealtimeDispatcher(this.io, this.batchEmitter, this.emitLegacyRealtimeEvents);
    this.eventPublisher = new EventPublisher(this.resolveHeartbeatThrottleMs());
    this.initializeHandlers();

    this.dispatcher.setupCompatBridge();
    this.presenceManager.setupPubSubBridge();
    this.registerDisplayDispatcher();
    this.setupEventHandlers();
    this.logBatchConfig();
  }

  private initializeHandlers(): void {
    const ctx: SocketHandlerContext = {
      io: this.io,
      sessionRegistry: realtimeSessionRegistry,
      ops: realtimeOps,
      metrics: chatRuntimeMetrics,
      emitLegacyRealtimeEvents: this.emitLegacyRealtimeEvents,
    };

    this.presenceManager = new PresenceManager({
      io: this.io,
      emitRealtimeToSocket: (id, e) => this.dispatcher.emitToSocket(id, e),
      emitRealtimeBroadcast: (e) => this.dispatcher.emitBroadcast(e),
      emitLegacyRealtimeEvents: this.emitLegacyRealtimeEvents,
      publishSessionHeartbeat: (s, a, o) => this.eventPublisher.publishSessionHeartbeat(s, a, o),
    });

    this.aiChatBridge = new AiChatBridge({
      emitRealtimeToUser: (userId, e) => this.dispatcher.emitToUser(userId, e),
      emitLegacyRealtimeEvents: this.emitLegacyRealtimeEvents,
      io: this.io as any,
    });

    this.authHandler = new AuthHandler({
      ctx,
      publishSessionHeartbeat: (s, a, o) => this.eventPublisher.publishSessionHeartbeat(s, a, o),
      publishPresenceUpdated: (s, st, r) => this.eventPublisher.publishPresenceUpdated(s, st, r),
      emitRealtimeBroadcast: (e) => this.dispatcher.emitBroadcast(e),
      emitRealtimeToSocket: (id, e) => this.dispatcher.emitToSocket(id, e),
      setUserOnline: (uid, u, sid) => this.presenceManager.setUserOnline(uid, u, sid),
      setUserOffline: (uid) => this.presenceManager.setUserOffline(uid),
      getOnlineUsers: () => this.presenceManager.getOnlineUsers(),
      publishPlatformPresenceFanout: (p) => this.eventPublisher.publishPlatformPresenceFanout(p),
    });

    this.messageHandler = new MessageHandler({
      handleAiMessage: (s, c, uid, u, img) => this.aiChatBridge.handleAiMessage(s, c, uid, u, img),
    });

    this.typingHandler = new TypingHandler({
      publishTypingUpdated: (s, p) => this.eventPublisher.publishTypingUpdated(s, p),
      publishSessionHeartbeat: (s, a, o) => this.eventPublisher.publishSessionHeartbeat(s, a, o as any),
      dispatchTyping: (target, payload) => {
        this.dispatcher.emitTypingLocally(target, payload, 'local');
      },
    });

    this.readReceiptHandler = new ReadReceiptHandler({
      io: this.io,
      emitRealtimeToRoom: (gid, e) => this.dispatcher.emitToRoom(gid, e),
      emitRealtimeToUser: (uid, e) => this.dispatcher.emitToUser(uid, e),
      emitLegacyRealtimeEvents: this.emitLegacyRealtimeEvents,
    });
  }

  // --- Public API (preserved) ---

  public getIO(): SocketIOServer { return this.io as any; }

  public async sendMessageToUser(userId: string, message: any): Promise<void> {
    (this.io as any).to(`user:${userId}`).emit('message', message);
  }

  public emitGroupUpdate(groupId: string, payload: Record<string, any>): void {
    if (this.emitLegacyRealtimeEvents) (this.io as any).to(`room:${groupId}`).emit('groupUpdate', payload);
    this.dispatcher.emitToRoom(groupId, { type: 'groupUpdate', payload });
  }

  public emitGroupUpdateToUsers(userIds: string[], payload: Record<string, any>): void {
    userIds.forEach((userId) => {
      if (this.emitLegacyRealtimeEvents) (this.io as any).to(`user:${userId}`).emit('groupUpdate', payload);
      this.dispatcher.emitToUser(userId, { type: 'groupUpdate', payload });
    });
  }

  public async isUserOnline(userId: string): Promise<boolean> { return this.presenceManager.isUserOnline(userId); }

  public async getUserLastSeen(userId: string): Promise<string | null> { return this.presenceManager.getUserLastSeen(userId); }

  async close(): Promise<void> {
    this.batchEmitter.close();

    return new Promise<void>((resolve) => {
      (this.io as any).close(() => {
        log.info('Socket.IO 服务已关闭');
        resolve();
      });
    });
  }

  // --- Private wiring ---

  private attachRedisAdapter(): void {
    try {
      (this.io as any).adapter(createAdapter(redis));
      log.info('Redis Streams adapter 已挂载（connectionStateRecovery 已启用）');

      redis.on('error', (err) => {
        log.error({ err }, 'Redis 连接异常 — adapter 降级为单进程模式');
      });

      redis.on('reconnecting', (delay: number) => {
        log.warn({ delayMs: delay }, 'Redis 正在重连');
      });
    } catch (err) {
      log.warn({ err }, 'Redis Streams adapter 初始化失败，回退为内存 adapter');
    }
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      chatRuntimeMetrics.increment('socket.connections.open');
      realtimeSessionRegistry.registerSocketConnection(socket.id);
      realtimeOps.recordSocketConnected(socket.id);
      this.eventPublisher.publishBoundaryEvent(
        this.createSessionOpenedEvent(socket.id),
      );

      this.registerSocketEventHandlers(socket);
    });
  }

  private registerSocketEventHandlers(socket: TypedSocket): void {
    // Authentication
    socket.on('authenticate', async (data) => {
      try {
        await this.authHandler.handleUserJoin(socket, data.token);
      } catch (error) {
        chatRuntimeMetrics.increment('socket.authenticate.errors');
        log.error({ err: error }, '用户加入失败');
        this.eventPublisher.publishSessionHeartbeat(socket, 'authenticate_failed', {
          force: true,
          authFailureClass: this.authHandler.classifyAuthFailure(error),
        });
        socket.emit('authError', {
          type: 'error',
          message: '认证失败，请重新登录',
        });
      }
    });

    // Message sending
    socket.on('sendMessage', async (data, ack) => {
      chatRuntimeMetrics.increment('socket.sendMessage.requests');
      this.eventPublisher.publishMessageCommandRequested(socket, data);
      try {
        const result = await this.messageHandler.handleMessage(socket, data);
        chatRuntimeMetrics.increment('socket.sendMessage.success');
        if (typeof ack === 'function') {
          ack({
            success: true,
            messageId: result?.message?._id?.toString(),
            seq: result?.seq,
            clientTempId: typeof data?.clientTempId === 'string' ? data.clientTempId : undefined,
          });
        }
      } catch (error: any) {
        chatRuntimeMetrics.increment('socket.sendMessage.errors');
        log.error({ err: error }, '消息处理失败');
        if (typeof ack === 'function') {
          ack({ success: false, error: error?.message || '未知错误' });
        } else {
          socket.emit('message', {
            type: 'error',
            message: '消息发送失败: ' + (error?.message || '未知错误'),
          });
        }
      }
    });

    // Disconnect
    socket.on('disconnect', async (reason) => {
      chatRuntimeMetrics.increment('socket.connections.closed');
      this.eventPublisher.removeHeartbeatSession(socket.id);
      await this.authHandler.handleUserDisconnect(socket, reason);
    });

    // Room join/leave
    socket.on('joinRoom', async (data) => {
      const roomId = typeof data === 'string' ? data : data?.roomId;
      if (roomId) await this.presenceManager.handleJoinRoom(socket, roomId);
    });

    socket.on('leaveRoom', async (data) => {
      const roomId = typeof data === 'string' ? data : data?.roomId;
      if (roomId) await this.presenceManager.handleLeaveRoom(socket, roomId);
    });

    socket.on('updateStatus', async (data) => {
      await this.presenceManager.handleStatusUpdate(socket, data.status || 'unknown');
      socket.broadcast.emit('userStatusChanged', {
        userId: socket.data.userId || '', username: socket.data.username || '', status: data.status,
      });
    });

    socket.on('typingStart', async (data) => { await this.typingHandler.handleTypingStart(socket, data); });
    socket.on('typingStop', async (data) => { await this.typingHandler.handleTypingStop(socket, data); });
    socket.on('presenceSubscribe', async (userIds) => { await this.presenceManager.handlePresenceSubscribe(socket, userIds); });

    socket.on('readChat', async (data) => {
      if (!socket.data.userId) return;
      chatRuntimeMetrics.increment('socket.readChat.requests');
      this.eventPublisher.publishReadAckRequested(socket, data);
      try {
        await this.readReceiptHandler.handleReadChat(socket, data);
        chatRuntimeMetrics.increment('socket.readChat.success');
      } catch (error: any) {
        chatRuntimeMetrics.increment('socket.readChat.errors');
        log.error({ data: error?.message || error }, '处理已读回执失败');
      }
    });
  }

  private registerDisplayDispatcher(): void {
    registerRoomMessageDisplayDispatcher((target, payload) => {
      if (target.id) this.dispatcher.emitToRoom(target.id, { type: 'message', payload });
    });
  }

  private createSessionOpenedEvent(sessionId: string): any {
    return createRealtimeEventEnvelope({
      topic: 'session_opened', sessionId,
      payload: { transport: 'socket_io_compat', connectedAt: new Date().toISOString(), status: 'unknown' },
    });
  }

  private resolveHeartbeatThrottleMs(): number {
    const raw = process.env.REALTIME_HEARTBEAT_THROTTLE_MS;
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(parsed)) return 15_000;
    return Math.max(1_000, Math.min(120_000, Math.floor(parsed)));
  }

  private logBatchConfig(): void {
    const b = this.batchEmitter;
    chatRuntimeMetrics.increment(`socket.batch.profile.${b.profile}`);
    chatRuntimeMetrics.observeValue('socket.batch.windowMs', b.windowMs);
    chatRuntimeMetrics.observeValue('socket.batch.perTargetLimit', b.perTargetLimit);
    chatRuntimeMetrics.observeValue('socket.batch.bucketLimit', b.bucketLimit);
    chatRuntimeMetrics.observeValue('socket.batch.globalLimit', b.globalLimit);
    chatRuntimeMetrics.observeValue('socket.batch.flushImmediateAt', b.flushImmediateAt);
    chatRuntimeMetrics.observeValue('socket.batch.emitLimit', b.emitLimit);
  }
}

export default SocketService;
