import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import { redis } from '../config/redis';
import User from '../models/User';
import { MessageType } from '../models/Message';
import ChatMemberState from '../models/ChatMemberState';
import Group from '../models/Group';
import GroupMember, { MemberStatus } from '../models/GroupMember';
import { generateUserAgentReply } from './agentPlane/orchestrator/agentResponseService';
import { waitForMongoReady } from '../config/db';
import { getAllowedOrigins } from '../config/allowedOrigins';
import { createAndFanoutMessage } from './messageWriteService';
import { updateService } from './updateService';
import { chatRuntimeMetrics } from './chatRuntimeMetrics';
import { buildGroupChatId, getPrivateOtherUserId, parseChatId } from '../utils/chat';
import { Op } from 'sequelize';
import { realtimeSessionRegistry } from './realtimeProtocol/realtimeSessionRegistry';
import { realtimeOps } from './realtimeProtocol/realtimeOps';
import {
  createRealtimeEventEnvelope,
  type RealtimeEventAuthFailureClass,
  type RealtimeEventEnvelopeV1,
  type RealtimeEventPayload,
} from './realtimeProtocol/eventBusContracts';
import { realtimeEventPublisher } from './realtimeProtocol/realtimeEventPublisher';
import { CHANNELS, pubSubService, type UserStatusEvent } from './pubSubService';
import { buildPresenceFanoutRequestedEvent } from './platformBus/eventFactory';
import { platformEventPublisher } from './platformBus/eventPublisher';

// 在线用户接口
interface OnlineUser {
  userId: string;
  username: string;
  socketId: string;
  connectedAt: string;
}

// Socket 事件接口
interface ServerToClientEvents {
  message: (data: any) => void;
  userOnline: (user: { userId: string; username: string }) => void;
  userOffline: (user: { userId: string; username: string }) => void;
  onlineUsers: (users: OnlineUser[]) => void;
  authenticated: (data: { userId: string; username: string; message: string }) => void;
  authError: (data: { type: string; message: string }) => void;
  userTyping: (data: { userId: string; username: string; isTyping: boolean }) => void;
  userStatusChanged: (data: { userId: string; username: string; status: string }) => void;
  typingStart: (data: { userId: string; username: string; groupId?: string }) => void;
  typingStop: (data: { userId: string; username: string; groupId?: string }) => void;
  presenceUpdate: (data: { userId: string; status: 'online' | 'offline'; lastSeen?: string }) => void;
  readReceipt: (data: { chatId: string; seq: number; readCount: number; readerId: string }) => void;
  groupUpdate: (data: any) => void;
  realtimeBatch: (events: Array<{ type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }>) => void;
}

interface ClientToServerEvents {
  sendMessage: (data: any, ack?: (response: { success: boolean; messageId?: string; seq?: number; error?: string }) => void) => void;
  join: (data: { token: string }) => void;
  joinRoom: (data: { roomId: string }) => void;
  leaveRoom: (data: { roomId: string }) => void;
  updateStatus: (data: { status: 'online' | 'offline' | 'away' }) => void;
  typing: (data: { receiverId: string; isTyping: boolean }) => void;
  typingStart: (data: { receiverId: string; groupId?: string }) => void;
  typingStop: (data: { receiverId: string; groupId?: string }) => void;
  presenceSubscribe: (userIds: string[]) => void;
  presenceUnsubscribe: (userIds: string[]) => void;
  readChat: (data: { chatId: string; seq: number }) => void;
}

interface InterServerEvents {
  ping: () => void;
}

interface SocketData {
  userId?: string;
  username?: string;
}

function readIntFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

type SocketBatchProfile = 'dev' | 'prod' | 'test';

type SocketBatchProfileDefaults = {
  windowMs: number;
  perTargetLimit: number;
  bucketLimit: number;
  globalLimit: number;
  flushImmediateAt: number;
  emitLimit: number;
};

const SOCKET_BATCH_PROFILE_DEFAULTS: Record<SocketBatchProfile, SocketBatchProfileDefaults> = {
  dev: {
    windowMs: 16,
    perTargetLimit: 512,
    bucketLimit: 2_000,
    globalLimit: 10_000,
    flushImmediateAt: 2_000,
    emitLimit: 1_200,
  },
  prod: {
    windowMs: 12,
    perTargetLimit: 1_024,
    bucketLimit: 10_000,
    globalLimit: 40_000,
    flushImmediateAt: 8_000,
    emitLimit: 2_400,
  },
  test: {
    windowMs: 16,
    perTargetLimit: 256,
    bucketLimit: 512,
    globalLimit: 4_000,
    flushImmediateAt: 1_200,
    emitLimit: 800,
  },
};

function resolveSocketBatchProfile(nodeEnv: string | undefined, profileRaw: string | undefined): SocketBatchProfile {
  const normalized = String(profileRaw || '').trim().toLowerCase();
  if (normalized === 'dev' || normalized === 'prod' || normalized === 'test') {
    return normalized;
  }
  if (String(nodeEnv || '').trim().toLowerCase() === 'production') return 'prod';
  if (String(nodeEnv || '').trim().toLowerCase() === 'test') return 'test';
  return 'dev';
}

export class SocketService {
  private io: SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >;
  private realtimeBatchQueues = new Map<string, {
    events: Array<{ type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }>;
    emit: (events: Array<{ type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }>) => void;
  }>();
  private realtimeBatchTimer: NodeJS.Timeout | null = null;
  private realtimeBatchQueuedEvents = 0;
  private realtimeBatchFlushScheduled = false;
  private readonly socketBatchProfile = resolveSocketBatchProfile(process.env.NODE_ENV, process.env.SOCKET_BATCH_PROFILE);
  private readonly socketBatchDefaults = SOCKET_BATCH_PROFILE_DEFAULTS[this.socketBatchProfile];
  private readonly realtimeBatchWindowMs = readIntFromEnv(
    process.env.SOCKET_BATCH_WINDOW_MS,
    this.socketBatchDefaults.windowMs,
    8,
    250,
  );
  private readonly realtimeBatchPerTargetLimit = readIntFromEnv(
    process.env.SOCKET_BATCH_PER_TARGET_LIMIT,
    this.socketBatchDefaults.perTargetLimit,
    32,
    20_000,
  );
  private readonly realtimeBatchBucketLimit = readIntFromEnv(
    process.env.SOCKET_BATCH_BUCKET_LIMIT,
    this.socketBatchDefaults.bucketLimit,
    64,
    50_000,
  );
  private readonly realtimeBatchGlobalLimit = readIntFromEnv(
    process.env.SOCKET_BATCH_GLOBAL_LIMIT,
    this.socketBatchDefaults.globalLimit,
    128,
    200_000,
  );
  private readonly realtimeBatchFlushImmediateAt = readIntFromEnv(
    process.env.SOCKET_BATCH_FLUSH_IMMEDIATE_AT,
    this.socketBatchDefaults.flushImmediateAt,
    128,
    200_000,
  );
  private readonly realtimeBatchEmitLimit = readIntFromEnv(
    process.env.SOCKET_BATCH_EMIT_LIMIT,
    this.socketBatchDefaults.emitLimit,
    32,
    50_000,
  );
  private readonly realtimeHeartbeatThrottleMs = readIntFromEnv(
    process.env.REALTIME_HEARTBEAT_THROTTLE_MS,
    15_000,
    1_000,
    120_000,
  );
  private readonly realtimeHeartbeatLastBySession = new Map<string, number>();
  // Worker-first realtime protocol: only emit `realtimeBatch` to clients.
  private readonly emitLegacyRealtimeEvents = false;

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: getAllowedOrigins(),
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.setupEventHandlers();
    this.setupPlatformPubSubBridge();
    chatRuntimeMetrics.increment(`socket.batch.profile.${this.socketBatchProfile}`);
    chatRuntimeMetrics.observeValue('socket.batch.windowMs', this.realtimeBatchWindowMs);
    chatRuntimeMetrics.observeValue('socket.batch.perTargetLimit', this.realtimeBatchPerTargetLimit);
    chatRuntimeMetrics.observeValue('socket.batch.bucketLimit', this.realtimeBatchBucketLimit);
    chatRuntimeMetrics.observeValue('socket.batch.globalLimit', this.realtimeBatchGlobalLimit);
    chatRuntimeMetrics.observeValue('socket.batch.flushImmediateAt', this.realtimeBatchFlushImmediateAt);
    chatRuntimeMetrics.observeValue('socket.batch.emitLimit', this.realtimeBatchEmitLimit);
  }

  private currentRealtimeQueueDepth(): number {
    return this.realtimeBatchQueuedEvents;
  }

  private setupPlatformPubSubBridge(): void {
    void pubSubService.initialize().catch((error) => {
      console.warn('⚠️ Redis Pub/Sub bridge 初始化失败:', error);
    });

    pubSubService.on<UserStatusEvent>(CHANNELS.USER_ONLINE, (event) => {
      this.emitPresenceBroadcastFromBus({
        userId: event.userId,
        isOnline: true,
        lastSeen: event.lastSeen,
      });
    });

    pubSubService.on<UserStatusEvent>(CHANNELS.USER_OFFLINE, (event) => {
      this.emitPresenceBroadcastFromBus({
        userId: event.userId,
        isOnline: false,
        lastSeen: event.lastSeen,
      });
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🔌 新的 Socket 连接: ${socket.id}`);
      chatRuntimeMetrics.increment('socket.connections.open');
      realtimeSessionRegistry.registerSocketConnection(socket.id);
      realtimeOps.recordSocketConnected(socket.id);
      this.publishRealtimeBoundaryEvent(
        createRealtimeEventEnvelope({
          topic: 'session_opened',
          sessionId: socket.id,
          payload: {
            transport: 'socket_io_compat',
            connectedAt: new Date().toISOString(),
            status: 'unknown',
          },
        }),
      );

      // 用户加入房间（认证）
      socket.on('authenticate', async (data) => {
        try {
          await this.handleUserJoin(socket, data.token);
        } catch (error) {
          chatRuntimeMetrics.increment('socket.authenticate.errors');
          console.error('用户加入失败:', error);
          this.publishSessionHeartbeat(socket, 'authenticate_failed', {
            force: true,
            authFailureClass: this.classifyAuthFailure(error),
          });
          socket.emit('authError', {
            type: 'error',
            message: '认证失败，请重新登录',
          });
        }
      });

      // 处理消息发送 (P1: 支持 ACK 回调)
      socket.on('sendMessage', async (data, ack) => {
        chatRuntimeMetrics.increment('socket.sendMessage.requests');
        this.publishMessageCommandRequested(socket, data);
        console.log('🎯 收到sendMessage事件:', {
          从用户: socket.data.username || '未知',
          用户ID: socket.data.userId || '未知',
          消息内容: data.content || '无内容',
          接收者: data.receiverId || data.groupId || 'unknown',
          消息类型: data.type || 'text',
          chatType: data.chatType || 'unknown'
        });

        try {
          const result = await this.handleMessage(socket, data);
          chatRuntimeMetrics.increment('socket.sendMessage.success');
          // P1: 发送 ACK 确认
          if (typeof ack === 'function') {
            ack({
              success: true,
              messageId: result?.message?._id?.toString(),
              seq: result?.seq,
            });
          }
        } catch (error: any) {
          chatRuntimeMetrics.increment('socket.sendMessage.errors');
          console.error('❌ 消息处理失败:', error);
          // P1: 发送错误 ACK
          if (typeof ack === 'function') {
            ack({
              success: false,
              error: error?.message || '未知错误',
            });
          } else {
            // 兼容旧客户端
            socket.emit('message', {
              type: 'error',
              message: '消息发送失败: ' + (error?.message || '未知错误'),
            });
          }
        }
      });

      // 处理断开连接
      socket.on('disconnect', async (reason) => {
        chatRuntimeMetrics.increment('socket.connections.closed');
        await this.handleUserDisconnect(socket, reason);
      });

      // 加入房间 (群聊/频道)
      socket.on('joinRoom', async (data) => {
        if (!socket.data.userId) {
          socket.emit('message', { type: 'error', message: '请先登录' });
          return;
        }
        const roomId = typeof data === 'string' ? data : data?.roomId;
        if (roomId) {
          const group = await Group.findByPk(roomId, { attributes: ['id', 'isActive'] });
          if (!group || !(group as any).isActive) {
            socket.emit('message', { type: 'error', message: '群组不存在或已解散' });
            return;
          }
          const isMember = await GroupMember.isMember(roomId, socket.data.userId);
          if (!isMember) {
            socket.emit('message', { type: 'error', message: '无权限加入该群聊' });
            return;
          }
          await socket.join(`room:${roomId}`);
          realtimeSessionRegistry.addRoomSubscription(socket.id, `room:${roomId}`);
          realtimeOps.recordRoomJoined(socket.id, socket.data.userId, `room:${roomId}`);
          this.publishSessionHeartbeat(socket, 'room_joined', {
            force: true,
            roomId: `room:${roomId}`,
          });
          console.log(`👥 用户 ${socket.data.username} 加入房间 ${roomId}`);
          socket.emit('message', { type: 'success', message: `已加入房间 ${roomId}` });
        }
      });

      // 离开房间
      socket.on('leaveRoom', async (data) => {
        const roomId = typeof data === 'string' ? data : data?.roomId;
        if (roomId) {
          await socket.leave(`room:${roomId}`);
          realtimeSessionRegistry.removeRoomSubscription(socket.id, `room:${roomId}`);
          realtimeOps.recordRoomLeft(socket.id, socket.data.userId, `room:${roomId}`);
          this.publishSessionHeartbeat(socket, 'room_left', {
            force: true,
            roomId: `room:${roomId}`,
          });
          console.log(`👋 用户 ${socket.data.username} 离开房间 ${roomId}`);
        }
      });

      // 更新在线状态
      socket.on('updateStatus', async (data) => {
        if (!socket.data.userId) return;
        const { status } = data;
        this.publishPresenceUpdated(socket, status || 'unknown', 'status_changed');
        this.publishSessionHeartbeat(socket, 'status_changed');
        // 广播状态变更
        socket.broadcast.emit('userStatusChanged', {
          userId: socket.data.userId,
          username: socket.data.username,
          status,
        });
        console.log(`📊 用户 ${socket.data.username} 状态变更为 ${status}`);
      });

      // 输入状态 - 开始
      socket.on('typingStart', async (data) => {
        if (!socket.data.userId) return;
        const { receiverId, groupId } = data;
        this.publishTypingUpdated(socket, {
          isTyping: true,
          receiverId,
          groupId,
        });
        this.publishSessionHeartbeat(socket, 'typing_start', {
          roomId: groupId ? `room:${groupId}` : undefined,
        });

        if (groupId) {
          if (!socket.rooms.has(`room:${groupId}`)) return;
          socket.to(`room:${groupId}`).emit('typingStart', {
            userId: socket.data.userId,
            username: socket.data.username || 'Unknown',
            groupId
          });
        } else if (receiverId) {
          this.io.to(`user:${receiverId}`).emit('typingStart', {
            userId: socket.data.userId,
            username: socket.data.username || 'Unknown'
          });
        }
      });

      // 输入状态 - 停止
      socket.on('typingStop', async (data) => {
        if (!socket.data.userId) return;
        const { receiverId, groupId } = data;
        this.publishTypingUpdated(socket, {
          isTyping: false,
          receiverId,
          groupId,
        });
        this.publishSessionHeartbeat(socket, 'typing_stop', {
          roomId: groupId ? `room:${groupId}` : undefined,
        });

        if (groupId) {
          if (!socket.rooms.has(`room:${groupId}`)) return;
          socket.to(`room:${groupId}`).emit('typingStop', {
            userId: socket.data.userId,
            username: socket.data.username || 'Unknown',
            groupId
          });
        } else if (receiverId) {
          this.io.to(`user:${receiverId}`).emit('typingStop', {
            userId: socket.data.userId,
            username: socket.data.username || 'Unknown'
          });
        }
      });

      // 订阅在线状态
      socket.on('presenceSubscribe', async (userIds: string[]) => {
        if (!socket.data.userId || !Array.isArray(userIds)) return;
        realtimeOps.recordPresenceSubscription(socket.data.userId, userIds.length);
        this.publishSessionHeartbeat(socket, 'presence_subscribe');

        // 立即发送当前在线状态
        for (const targetId of userIds) {
          const isOnline = await this.isUserOnline(targetId);
          if (isOnline) {
            if (this.emitLegacyRealtimeEvents) {
              socket.emit('presenceUpdate', {
                userId: targetId,
                status: 'online'
              });
            }
            this.emitRealtimeToSocket(socket.id, {
              type: 'presence',
              payload: { userId: targetId, isOnline: true },
            });
          } else {
            const lastSeen = await this.getUserLastSeen(targetId);
            if (this.emitLegacyRealtimeEvents) {
              socket.emit('presenceUpdate', {
                userId: targetId,
                status: 'offline',
                lastSeen: lastSeen || undefined
              });
            }
            this.emitRealtimeToSocket(socket.id, {
              type: 'presence',
              payload: { userId: targetId, isOnline: false, lastSeen: lastSeen || undefined },
            });
          }
        }
      });

      // 标记聊天已读（按 seq）
      socket.on('readChat', async (data) => {
        if (!socket.data.userId) return;
        chatRuntimeMetrics.increment('socket.readChat.requests');
        this.publishReadAckRequested(socket, data);
        try {
          await this.handleReadChat(socket, data);
          chatRuntimeMetrics.increment('socket.readChat.success');
        } catch (error: any) {
          chatRuntimeMetrics.increment('socket.readChat.errors');
          console.error('处理已读回执失败:', error?.message || error);
        }
      });
    });
  }

  private queueRealtimeBatch(
    key: string,
    emit: (events: Array<{ type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }>) => void,
    event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any },
  ): void {
    chatRuntimeMetrics.increment('socket.realtimeBatch.enqueue');
    let bucket = this.realtimeBatchQueues.get(key);
    if (!bucket) {
      if (this.realtimeBatchQueues.size >= this.realtimeBatchBucketLimit) {
        const oldestKey = this.realtimeBatchQueues.keys().next().value as string | undefined;
        if (oldestKey) {
          const oldestBucket = this.realtimeBatchQueues.get(oldestKey);
          const dropped = oldestBucket?.events.length || 0;
          if (dropped > 0) {
            this.realtimeBatchQueuedEvents = Math.max(0, this.realtimeBatchQueuedEvents - dropped);
            chatRuntimeMetrics.increment('socket.realtimeBatch.drop.bucketOverflowEvents', dropped);
          }
          this.realtimeBatchQueues.delete(oldestKey);
          chatRuntimeMetrics.increment('socket.realtimeBatch.drop.bucketOverflowTargets');
        }
      }
      bucket = { events: [], emit };
      this.realtimeBatchQueues.set(key, bucket);
    }
    bucket.events.push(event);
    this.realtimeBatchQueuedEvents += 1;

    if (bucket.events.length > this.realtimeBatchPerTargetLimit) {
      const overflow = bucket.events.length - this.realtimeBatchPerTargetLimit;
      if (overflow > 0) {
        bucket.events.splice(0, overflow);
        this.realtimeBatchQueuedEvents = Math.max(0, this.realtimeBatchQueuedEvents - overflow);
        chatRuntimeMetrics.increment('socket.realtimeBatch.drop.targetOverflow', overflow);
      }
    }

    const globalDropped = this.trimRealtimeQueueGlobalLimit();
    if (globalDropped > 0) {
      chatRuntimeMetrics.increment('socket.realtimeBatch.drop.globalOverflow', globalDropped);
    }

    const queued = this.currentRealtimeQueueDepth();
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.queueDepth', queued);

    if (queued >= this.realtimeBatchFlushImmediateAt) {
      if (this.realtimeBatchTimer) {
        clearTimeout(this.realtimeBatchTimer);
        this.realtimeBatchTimer = null;
      }
      if (!this.realtimeBatchFlushScheduled) {
        this.realtimeBatchFlushScheduled = true;
        queueMicrotask(() => {
          this.realtimeBatchFlushScheduled = false;
          this.flushRealtimeBatches();
        });
      }
      return;
    }

    if (this.realtimeBatchTimer) return;
    this.realtimeBatchTimer = setTimeout(() => {
      this.flushRealtimeBatches();
    }, this.realtimeBatchWindowMs);
  }

  private trimRealtimeQueueGlobalLimit(): number {
    let total = this.realtimeBatchQueuedEvents;
    if (total <= this.realtimeBatchGlobalLimit) return 0;

    let dropped = 0;
    const entries = Array.from(this.realtimeBatchQueues.entries());
    if (!entries.length) return 0;

    let cursor = 0;
    while (total > this.realtimeBatchGlobalLimit) {
      const entry = entries[cursor];
      cursor = (cursor + 1) % entries.length;
      if (!entry) break;
      const [key, bucket] = entry;
      if (!bucket.events.length) {
        continue;
      }
      bucket.events.shift();
      dropped += 1;
      total -= 1;
      this.realtimeBatchQueuedEvents = Math.max(0, this.realtimeBatchQueuedEvents - 1);
      if (!bucket.events.length) {
        this.realtimeBatchQueues.delete(key);
      }
    }
    return dropped;
  }

  private flushRealtimeBatches(): void {
    if (this.realtimeBatchTimer) {
      clearTimeout(this.realtimeBatchTimer);
      this.realtimeBatchTimer = null;
    }
    this.realtimeBatchFlushScheduled = false;
    if (!this.realtimeBatchQueues.size) return;
    chatRuntimeMetrics.increment('socket.realtimeBatch.flush');

    const entries = Array.from(this.realtimeBatchQueues.entries());
    this.realtimeBatchQueues.clear();
    this.realtimeBatchQueuedEvents = 0;
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.flushBucketCount', entries.length);
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.queueDepth', 0);

    for (const [, item] of entries) {
      if (!item.events.length) continue;
      let coalesced = this.coalesceRealtimeEvents(item.events);
      if (coalesced.length > this.realtimeBatchEmitLimit) {
        const overflow = coalesced.length - this.realtimeBatchEmitLimit;
        coalesced = coalesced.slice(overflow);
        chatRuntimeMetrics.increment('socket.realtimeBatch.drop.emitOverflow', overflow);
      }
      if (!coalesced.length) continue;
      chatRuntimeMetrics.observeValue('socket.realtimeBatch.emitSize', coalesced.length);
      item.emit(coalesced);
    }
  }

  private coalesceRealtimeEvents(
    events: Array<{ type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }>,
  ): Array<{ type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }> {
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.coalesceInput', events.length);
    const out: Array<{ type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }> = [];
    const presenceByUser = new Map<string, { type: 'presence'; payload: any }>();
    const readByKey = new Map<string, { type: 'readReceipt'; payload: any }>();
    const groupByKey = new Map<string, { type: 'groupUpdate'; payload: any }>();

    for (const e of events) {
      if (!e) continue;
      if (e.type === 'message') {
        out.push(e);
        continue;
      }

      if (e.type === 'presence') {
        const userId = e.payload?.userId ? String(e.payload.userId) : '';
        if (!userId) continue;
        presenceByUser.set(userId, e as any);
        continue;
      }

      if (e.type === 'readReceipt') {
        const chatId = e.payload?.chatId ? String(e.payload.chatId) : '';
        const seq = Number(e.payload?.seq || 0);
        if (!chatId || !seq) continue;
        const key = `${chatId}:${seq}`;
        const cur = readByKey.get(key);
        const nextReadCount = Number(e.payload?.readCount || 0);
        const curReadCount = Number(cur?.payload?.readCount || 0);
        if (!cur || nextReadCount >= curReadCount) {
          readByKey.set(key, e as any);
        }
        continue;
      }

      if (e.type === 'groupUpdate') {
        const groupId = e.payload?.groupId ? String(e.payload.groupId) : '';
        const action = e.payload?.action ? String(e.payload.action) : '';
        const key = `${groupId}:${action}`;
        groupByKey.set(key, e as any);
      }
    }

    const merged = out.concat(
      Array.from(presenceByUser.values()),
      Array.from(readByKey.values()),
      Array.from(groupByKey.values()),
    );
    chatRuntimeMetrics.observeValue('socket.realtimeBatch.coalesceOutput', merged.length);
    return merged;
  }

  private emitRealtimeToUser(
    userId: string,
    event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any },
  ): void {
    realtimeOps.recordRealtimeEmit('user', event.type, 1);
    if (event.type === 'presence') {
      this.publishPlatformPresenceFanout({
        target: 'user',
        targetId: userId,
        userId: String(event.payload?.userId || ''),
        isOnline: Boolean(event.payload?.isOnline),
        lastSeen: event.payload?.lastSeen,
      });
    }
    this.queueRealtimeBatch(
      `user:${userId}`,
      (events) => this.io.to(`user:${userId}`).emit('realtimeBatch', events),
      event,
    );
  }

  private emitRealtimeToRoom(
    groupId: string,
    event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any },
  ): void {
    realtimeOps.recordRealtimeEmit('room', event.type, 1);
    if (event.type === 'presence') {
      this.publishPlatformPresenceFanout({
        target: 'room',
        targetId: groupId,
        userId: String(event.payload?.userId || ''),
        isOnline: Boolean(event.payload?.isOnline),
        lastSeen: event.payload?.lastSeen,
      });
    }
    this.queueRealtimeBatch(
      `room:${groupId}`,
      (events) => this.io.to(`room:${groupId}`).emit('realtimeBatch', events),
      event,
    );
  }

  private emitRealtimeToSocket(
    socketId: string,
    event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any },
  ): void {
    realtimeOps.recordRealtimeEmit('socket', event.type, 1);
    if (event.type === 'presence') {
      this.publishPlatformPresenceFanout({
        target: 'socket',
        targetId: socketId,
        userId: String(event.payload?.userId || ''),
        isOnline: Boolean(event.payload?.isOnline),
        lastSeen: event.payload?.lastSeen,
      });
    }
    this.queueRealtimeBatch(
      `socket:${socketId}`,
      (events) => this.io.to(socketId).emit('realtimeBatch', events),
      event,
    );
  }

  private emitRealtimeBroadcast(
    event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any },
  ): void {
    realtimeOps.recordRealtimeEmit('broadcast', event.type, 1);
    this.queueRealtimeBatch(
      'broadcast:global',
      (events) => this.io.emit('realtimeBatch', events),
      event,
    );
  }

  private emitPresenceBroadcastFromBus(payload: {
    userId: string;
    isOnline: boolean;
    lastSeen?: string | number;
  }): void {
    if (!payload.userId) {
      return;
    }
    this.emitRealtimeBroadcast({
      type: 'presence',
      payload: {
        userId: payload.userId,
        isOnline: payload.isOnline,
        lastSeen: payload.lastSeen || undefined,
      },
    });
  }

  private publishPlatformPresenceFanout(params: {
    target: 'broadcast' | 'user' | 'room' | 'socket';
    targetId?: string;
    userId: string;
    isOnline: boolean;
    lastSeen?: string | number;
  }): void {
    if (!params.userId) {
      return;
    }
    void platformEventPublisher
      .publish([
        buildPresenceFanoutRequestedEvent({
          userId: params.userId,
          status: params.isOnline ? 'online' : 'offline',
          lastSeen: params.lastSeen ? String(params.lastSeen) : null,
          target: params.target,
          targetId: params.targetId,
          source: 'socket_service',
        }),
      ])
      .catch((error) => {
        chatRuntimeMetrics.increment('platform.eventBus.publish.backgroundErrors');
        console.error('发布 platform presence 事件失败:', error);
      });
  }

  private publishRealtimeBoundaryEvent(event: RealtimeEventEnvelopeV1<RealtimeEventPayload>): void {
    void realtimeEventPublisher.publish([event]).catch((error) => {
      chatRuntimeMetrics.increment('realtime.eventBus.publish.backgroundErrors');
      console.error('发布 realtime 边界事件失败:', error);
    });
  }

  private publishSessionHeartbeat(
    socket: Socket,
    activity: string,
    options?: {
      force?: boolean;
      roomId?: string;
      authFailureClass?: RealtimeEventAuthFailureClass;
    },
  ): void {
    const now = Date.now();
    const lastPublishedAt = this.realtimeHeartbeatLastBySession.get(socket.id) || 0;
    if (!options?.force && now - lastPublishedAt < this.realtimeHeartbeatThrottleMs) {
      return;
    }
    this.realtimeHeartbeatLastBySession.set(socket.id, now);
    this.publishRealtimeBoundaryEvent(
      createRealtimeEventEnvelope({
        topic: 'session_heartbeat',
        sessionId: socket.id,
        userId: socket.data.userId,
        payload: {
          transport: 'socket_io_compat',
          activity,
          roomId: options?.roomId || null,
          authFailureClass: options?.authFailureClass,
          status: socket.data.userId ? 'online' : 'unknown',
        },
      }),
    );
  }

  private publishPresenceUpdated(
    socket: Socket,
    status: 'online' | 'offline' | 'away' | 'unknown',
    reason: string,
  ): void {
    this.publishRealtimeBoundaryEvent(
      createRealtimeEventEnvelope({
        topic: 'presence_updated',
        sessionId: socket.id,
        userId: socket.data.userId,
        payload: {
          transport: 'socket_io_compat',
          status,
          reason,
        },
      }),
    );
  }

  private publishTypingUpdated(
    socket: Socket,
    params: { isTyping: boolean; receiverId?: string; groupId?: string },
  ): void {
    const chatId = params.groupId ? buildGroupChatId(params.groupId) : null;
    this.publishRealtimeBoundaryEvent(
      createRealtimeEventEnvelope({
        topic: 'typing_updated',
        sessionId: socket.id,
        userId: socket.data.userId,
        chatId,
        payload: {
          transport: 'socket_io_compat',
          isTyping: params.isTyping,
          receiverId: params.receiverId || null,
          groupId: params.groupId || null,
        },
      }),
    );
  }

  private publishMessageCommandRequested(socket: Socket, data: any): void {
    const chatType =
      data?.chatType === 'private' || data?.chatType === 'group'
        ? data.chatType
        : data?.groupId
          ? 'group'
          : data?.receiverId
            ? 'private'
            : 'unknown';
    const chatId =
      typeof data?.chatId === 'string' && data.chatId.trim()
        ? data.chatId.trim()
        : chatType === 'group' && typeof data?.groupId === 'string' && data.groupId.trim()
          ? buildGroupChatId(data.groupId.trim())
          : null;
    const messageType = typeof data?.type === 'string' && data.type.trim() ? data.type.trim() : 'text';
    const contentLength = typeof data?.content === 'string' ? data.content.trim().length : 0;
    this.publishSessionHeartbeat(socket, 'send_message');
    this.publishRealtimeBoundaryEvent(
      createRealtimeEventEnvelope({
        topic: 'message_command_requested',
        sessionId: socket.id,
        userId: socket.data.userId,
        chatId,
        payload: {
          transport: 'socket_io_compat',
          chatType,
          receiverId: typeof data?.receiverId === 'string' ? data.receiverId : null,
          groupId: typeof data?.groupId === 'string' ? data.groupId : null,
          messageType,
          contentLength,
          hasAttachments: Boolean(data?.fileUrl || data?.fileName || data?.mimeType),
        },
      }),
    );
  }

  private publishReadAckRequested(socket: Socket, data: { chatId: string; seq: number }): void {
    if (!data?.chatId || typeof data?.seq !== 'number') {
      return;
    }
    this.publishSessionHeartbeat(socket, 'read_ack_requested');
    this.publishRealtimeBoundaryEvent(
      createRealtimeEventEnvelope({
        topic: 'read_ack_requested',
        sessionId: socket.id,
        userId: socket.data.userId,
        chatId: data.chatId,
        payload: {
          transport: 'socket_io_compat',
          seq: data.seq,
        },
      }),
    );
  }

  private classifyAuthFailure(error: unknown): RealtimeEventAuthFailureClass {
    const message = String((error as Error | undefined)?.message || '').toLowerCase();
    if (message.includes('expired')) return 'expired';
    if (message.includes('forbidden') || message.includes('permission')) return 'forbidden';
    if (message.includes('degraded')) return 'degraded_accept';
    if (message) return 'auth_failed';
    return 'unknown';
  }

  public emitGroupUpdate(groupId: string, payload: Record<string, any>): void {
    if (this.emitLegacyRealtimeEvents) {
      this.io.to(`room:${groupId}`).emit('groupUpdate', payload);
    }
    this.emitRealtimeToRoom(groupId, { type: 'groupUpdate', payload });
  }

  public emitGroupUpdateToUsers(userIds: string[], payload: Record<string, any>): void {
    userIds.forEach((userId) => {
      if (this.emitLegacyRealtimeEvents) {
        this.io.to(`user:${userId}`).emit('groupUpdate', payload);
      }
      this.emitRealtimeToUser(userId, { type: 'groupUpdate', payload });
    });
  }

  // 处理用户加入（认证）
  private async handleUserJoin(socket: Socket, token: string): Promise<void> {
    if (!token) {
      throw new Error('缺少认证令牌');
    }

    // 验证 JWT 令牌
    const decoded = await verifyAccessToken(token);

    // 获取用户信息
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      throw new Error('用户不存在');
    }

    // 设置 socket 数据
    socket.data.userId = user.id;
    socket.data.username = user.username;

    // 将用户加入个人房间（用于私聊）
    await socket.join(`user:${user.id}`);

    // 自动加入用户所在的群聊房间
    const joinedRooms = [`user:${user.id}`];
    try {
      const groups = await GroupMember.findAll({
        where: {
          userId: user.id,
          status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] },
          isActive: true,
        },
        attributes: ['groupId'],
      });
      for (const g of groups) {
        const groupId = (g as any).groupId;
        if (groupId) {
          await socket.join(`room:${groupId}`);
          joinedRooms.push(`room:${groupId}`);
        }
      }
    } catch (error) {
      console.error('自动加入群聊房间失败:', error);
    }

    realtimeSessionRegistry.markSocketAuthenticated({
      socketId: socket.id,
      userId: user.id,
      username: user.username,
    });
    realtimeOps.recordSocketAuthenticated(socket.id, user.id);
    for (const roomId of joinedRooms) {
      realtimeSessionRegistry.addRoomSubscription(socket.id, roomId);
      realtimeOps.recordRoomJoined(socket.id, user.id, roomId);
    }
    this.publishSessionHeartbeat(socket, 'authenticate_success', { force: true });
    this.publishPresenceUpdated(socket, 'online', 'authenticated');

    // 更新 Redis 中的在线状态
    await this.setUserOnline(user.id, user.username, socket.id);

    // 通知其他用户有新用户上线
    if (this.emitLegacyRealtimeEvents) {
      socket.broadcast.emit('userOnline', {
        userId: user.id,
        username: user.username,
      });
    }
    this.publishPlatformPresenceFanout({
      target: 'broadcast',
      userId: user.id,
      isOnline: true,
    });
    this.emitRealtimeBroadcast({
      type: 'presence',
      payload: { userId: user.id, isOnline: true },
    });
    chatRuntimeMetrics.increment('socket.presence.onlineBroadcast');

    // 向当前用户发送在线用户列表
    const onlineUsers = await this.getOnlineUsers();
    if (this.emitLegacyRealtimeEvents) {
      socket.emit('onlineUsers', onlineUsers);
    }
    if (onlineUsers.length) {
      for (const u of onlineUsers) {
        this.emitRealtimeToSocket(socket.id, {
          type: 'presence',
          payload: { userId: u.userId, isOnline: true },
        });
      }
    }

    // 发送认证成功事件
    socket.emit('authenticated', {
      userId: user.id,
      username: user.username,
      message: `欢迎, ${user.username}！您已成功连接到聊天服务器。`,
    });

    // 也发送一个消息事件
    socket.emit('message', {
      type: 'success',
      message: `欢迎, ${user.username}！您已成功连接到聊天服务器。`,
    });

    console.log(`✅ 用户已认证并加入: ${user.username} (${user.id})`);
    chatRuntimeMetrics.increment('socket.authenticate.success');
  }

  // 处理消息发送
  private async handleMessage(socket: Socket, data: any): Promise<{ message: any; seq: number } | null> {
    const { userId, username } = socket.data;

    if (!userId || !username) {
      throw new Error('用户未认证');
    }

    try {
      console.log('\n=== 消息处理调试 ===');
      console.log('📨 接收到的数据:', JSON.stringify(data, null, 2));

      const inputContent = typeof data.content === 'string' ? data.content.trim() : '';

      // 检查是否为AI聊天请求
      if (inputContent.startsWith('/ai ')) {
        console.log('🤖 检测到AI聊天请求:', inputContent);

        // 检查是否包含图片数据
        let imageData: any = null;
        if (data.imageData) {
          imageData = {
            mimeType: data.imageData.mimeType,
            base64Data: data.imageData.base64Data,
            fileName: data.imageData.fileName,
            fileSize: data.imageData.fileSize
          };

          console.log('🖼️ AI请求包含图片数据:', {
            mimeType: imageData.mimeType,
            fileName: imageData.fileName,
            hasBase64: !!imageData.base64Data
          });
        }

        await this.handleAiMessage(socket, inputContent, userId, username, imageData);
        return null;
      }

      // 检查是否为JSON格式的AI图片消息
      try {
        const parsedData = JSON.parse(inputContent);
        if (parsedData.content && parsedData.imageData) {
          console.log('🤖 检测到JSON格式的AI图片请求:', parsedData.content);

          const aiMessage = `/ai ${parsedData.content}`;
          const imageData = {
            mimeType: parsedData.imageData.mimeType,
            base64Data: parsedData.imageData.base64Data,
            fileName: parsedData.imageData.fileName,
            fileSize: parsedData.imageData.fileSize
          };

          console.log('🖼️ JSON AI请求包含图片数据:', {
            mimeType: imageData.mimeType,
            fileName: imageData.fileName,
            hasBase64: !!imageData.base64Data
          });

          await this.handleAiMessage(socket, aiMessage, userId, username, imageData);
          return null;
        }
      } catch {
        // 不是JSON格式，继续正常处理
      }

      const inputChatType = data.chatType;
      if (inputChatType !== 'group' && inputChatType !== 'private') {
        socket.emit('message', { type: 'error', message: 'chatType 必须为 private 或 group' });
        return null;
      }
      const receiverId = inputChatType === 'private' ? data.receiverId : undefined;
      const groupId = inputChatType === 'group' ? data.groupId : undefined;
      if (inputChatType === 'private' && !receiverId) {
        socket.emit('message', { type: 'error', message: 'receiverId 不能为空' });
        return null;
      }
      if (inputChatType === 'group' && !groupId) {
        socket.emit('message', { type: 'error', message: 'groupId 不能为空' });
        return null;
      }

      // 智能分析消息类型和内容
      let messageType: string = data.type || 'text';
      let messageContent = inputContent;
      let attachments: any[] | undefined = Array.isArray(data.attachments) ? data.attachments : undefined;

      // 兼容：直接传文件字段
      if (!attachments && (data.fileUrl || data.fileName)) {
        attachments = [{
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          thumbnailUrl: data.thumbnailUrl
        }];
      }

      // 尝试解析JSON文件数据（旧客户端）
      let parsedFileData: any = null;
      try {
        parsedFileData = JSON.parse(data.content);
        console.log('📋 解析到文件数据:', parsedFileData);
      } catch {
        // 如果不是JSON，就是普通文本消息
        console.log('📝 普通文本消息');
      }

      if (parsedFileData && parsedFileData.fileUrl && parsedFileData.fileName) {
        console.log('📁 检测到文件消息');
        messageType = parsedFileData.type || this.determineMessageType(parsedFileData.mimeType, parsedFileData.fileName);
        messageContent = parsedFileData.content || parsedFileData.fileName || messageContent;
        attachments = [{
          fileUrl: parsedFileData.fileUrl,
          fileName: parsedFileData.fileName,
          fileSize: parsedFileData.fileSize,
          mimeType: parsedFileData.mimeType,
          thumbnailUrl: parsedFileData.thumbnailUrl
        }];
      } else if (attachments && attachments.length > 0 && messageType === 'text') {
        const first = attachments[0];
        messageType = this.determineMessageType(first.mimeType, first.fileName);
      }

      if (!messageContent && (!attachments || attachments.length === 0)) {
        socket.emit('message', { type: 'error', message: '消息内容不能为空' });
        return null;
      }

      // 在执行数据库操作前，确保 MongoDB 就绪
      try {
        await waitForMongoReady(15000);
      } catch (e: any) {
        socket.emit('message', {
          type: 'error',
          message: '数据库未就绪，请稍后重试',
        });
        return null;
      }

      const writeStartedAt = Date.now();
      const { message: savedMessage } = await createAndFanoutMessage({
        senderId: userId,
        receiverId,
        groupId: groupId || undefined,
        chatType: inputChatType,
        content: messageContent,
        type: messageType as MessageType,
        attachments: attachments,
        fileUrl: attachments?.[0]?.fileUrl || data.fileUrl,
        fileName: attachments?.[0]?.fileName || data.fileName,
        fileSize: attachments?.[0]?.fileSize || data.fileSize,
        mimeType: attachments?.[0]?.mimeType || data.mimeType,
        thumbnailUrl: attachments?.[0]?.thumbnailUrl || data.thumbnailUrl,
      });

      console.log('💾 消息已保存到数据库:', {
        id: savedMessage._id.toString(),
        type: savedMessage.type,
        content: savedMessage.content.substring(0, 50) + '...',
        hasFileData: !!(attachments && attachments.length)
      });

      // 构造要广播的消息对象
      const messageData: any = {
        id: savedMessage._id.toString(),
        chatId: savedMessage.chatId,
        chatType: savedMessage.chatType,
        groupId: savedMessage.groupId || (inputChatType === 'group' ? groupId : null),
        seq: savedMessage.seq,
        content: savedMessage.content,
        senderId: savedMessage.sender,
        senderUsername: username,
        userId: savedMessage.sender,
        username: username,
        receiverId: savedMessage.receiver,
        timestamp: savedMessage.timestamp.toISOString(),
        type: savedMessage.type,
        isGroupChat: savedMessage.isGroupChat,
        status: savedMessage.status,
        attachments: savedMessage.attachments || null,
        fileUrl: savedMessage.fileUrl,
        fileName: savedMessage.fileName,
        fileSize: savedMessage.fileSize,
        mimeType: savedMessage.mimeType,
        thumbnailUrl: savedMessage.thumbnailUrl,
      };

      // 广播消息
      if (inputChatType === 'group' && groupId) {
        if (this.emitLegacyRealtimeEvents) {
          this.io.to(`room:${groupId}`).emit('message', { type: 'chat', data: messageData });
        }
        this.emitRealtimeToRoom(groupId, { type: 'message', payload: messageData });
      } else if (receiverId) {
        if (this.emitLegacyRealtimeEvents) {
          this.io.to(`user:${receiverId}`).emit('message', { type: 'chat', data: messageData });
          socket.emit('message', { type: 'chat', data: messageData });
        }
        this.emitRealtimeToUser(receiverId, { type: 'message', payload: messageData });
        this.emitRealtimeToSocket(socket.id, { type: 'message', payload: messageData });
      }

      console.log(`📨 消息已保存并发送: ${username} -> ${data.content?.substring(0, 50)}...`);
      chatRuntimeMetrics.observeDuration('socket.sendMessage.writeLatencyMs', Date.now() - writeStartedAt);
      chatRuntimeMetrics.increment(`socket.sendMessage.chatType.${inputChatType}`);
      chatRuntimeMetrics.increment(`socket.sendMessage.messageType.${String(messageType || 'text')}`);

      // P1: 返回消息数据供 ACK 使用
      return { message: savedMessage, seq: savedMessage.seq ?? 0 };

    } catch (error) {
      chatRuntimeMetrics.increment('socket.sendMessage.handleErrors');
      console.error('保存消息失败:', error);
      socket.emit('message', {
        type: 'error',
        message: '消息发送失败，请重试',
      });
      return null;
    }
  }

  // 处理已读回执（按 seq）
  private async handleReadChat(socket: Socket, data: { chatId: string; seq: number }): Promise<void> {
    const { userId } = socket.data;
    if (!userId) return;
    const startedAt = Date.now();
    const { chatId, seq } = data || {};
    if (!chatId || typeof seq !== 'number') return;

    try {
      await waitForMongoReady(15000);
    } catch {
      return;
    }

    const parsed = parseChatId(chatId);
    if (!parsed) {
      return;
    }

    await ChatMemberState.updateOne(
      { chatId, userId },
      { $max: { lastReadSeq: seq }, $set: { lastSeenAt: new Date() } },
      { upsert: true }
    );

    // parsed 已在上方确保非空
    if (parsed.type === 'group' && parsed.groupId) {
      const member = await GroupMember.findOne({
        where: { groupId: parsed.groupId, userId, status: { [Op.in]: [MemberStatus.ACTIVE, MemberStatus.MUTED] }, isActive: true },
      });
      if (!member) return;

      const readCount = await ChatMemberState.countDocuments({
        chatId,
        lastReadSeq: { $gte: seq },
      });

      if (this.emitLegacyRealtimeEvents) {
        this.io.to(`room:${parsed.groupId}`).emit('readReceipt', {
          chatId,
          seq,
          readCount,
          readerId: userId,
        });
      }
      this.emitRealtimeToRoom(parsed.groupId, {
        type: 'readReceipt',
        payload: { chatId, seq, readCount, readerId: userId },
      });
      chatRuntimeMetrics.increment('socket.readChat.group');
      chatRuntimeMetrics.observeValue('socket.readChat.groupReadCount', readCount);
    } else if (parsed.type === 'private') {
      const otherUserId = getPrivateOtherUserId(chatId, userId);
      if (!otherUserId) return;

      if (this.emitLegacyRealtimeEvents) {
        this.io.to(`user:${otherUserId}`).emit('readReceipt', {
          chatId,
          seq,
          readCount: 1,
          readerId: userId,
        });
      }
      this.emitRealtimeToUser(otherUserId, {
        type: 'readReceipt',
        payload: { chatId, seq, readCount: 1, readerId: userId },
      });

      await updateService.appendUpdate({
        userId: otherUserId,
        type: 'read',
        chatId,
        seq,
        payload: { readerId: userId, readCount: 1 },
      });
      chatRuntimeMetrics.increment('socket.readChat.private');
    }
    chatRuntimeMetrics.observeDuration('socket.readChat.latencyMs', Date.now() - startedAt);
  }

  // 处理用户断开连接
  private async handleUserDisconnect(socket: Socket, reason?: string): Promise<void> {
    const { userId, username } = socket.data;
    this.publishRealtimeBoundaryEvent(
      createRealtimeEventEnvelope({
        topic: 'session_closed',
        sessionId: socket.id,
        userId,
        payload: {
          transport: 'socket_io_compat',
          closeReason: reason || 'disconnect',
          closedAt: new Date().toISOString(),
          status: userId ? 'offline' : 'unknown',
        },
      }),
    );
    this.realtimeHeartbeatLastBySession.delete(socket.id);
    realtimeSessionRegistry.removeSocket(socket.id);
    realtimeOps.recordSocketDisconnected(socket.id, userId);

    if (userId && username) {
      // 从 Redis 中移除在线状态
      await this.setUserOffline(userId);

      // 通知其他用户有用户下线
      if (this.emitLegacyRealtimeEvents) {
        socket.broadcast.emit('userOffline', {
          userId,
          username,
        });
      }
      this.publishPlatformPresenceFanout({
        target: 'broadcast',
        userId,
        isOnline: false,
      });
      this.emitRealtimeBroadcast({
        type: 'presence',
        payload: { userId, isOnline: false },
      });
      this.publishPresenceUpdated(socket, 'offline', 'disconnect');
      chatRuntimeMetrics.increment('socket.presence.offlineBroadcast');

      console.log(`❌ 用户已断开连接: ${username} (${userId})`);
    }

    console.log(`🔌 Socket 连接已断开: ${socket.id}`);
  }

  // 处理AI聊天消息（支持多模态）
  private async handleAiMessage(socket: Socket, messageContent: string, userId: string, username: string, imageData?: any): Promise<void> {
    try {
      // 提取AI请求内容（移除'/ai '前缀）
      const aiQuery = messageContent.substring(4).trim();

      if (!aiQuery) {
        socket.emit('message', {
          type: 'error',
          message: 'AI请求内容不能为空，请使用格式：/ai 你的问题',
        });
        return;
      }

      console.log(`🤖 处理AI请求: "${aiQuery}" 来自用户 ${username}`, imageData ? '🖼️ 包含图片' : '');

      // 在执行数据库操作前，确保 MongoDB 就绪
      try {
        await waitForMongoReady(15000);
      } catch (e: any) {
        socket.emit('message', {
          type: 'error',
          message: '数据库未就绪，无法发送AI请求，请稍后重试',
        });
        return;
      }

      const aiBot = await User.findOne({ where: { username: 'Gemini AI' } });
      const aiBotId = aiBot?.id || 'ai';

      const { message: userMessage } = await createAndFanoutMessage({
        senderId: userId,
        receiverId: aiBotId,
        chatType: 'private',
        content: messageContent,
        type: imageData ? MessageType.IMAGE : MessageType.TEXT,
        fileUrl: imageData?.fileUrl,
        fileName: imageData?.fileName,
        mimeType: imageData?.mimeType,
        fileSize: imageData?.fileSize,
      });

      const userMessageData: any = {
        id: userMessage._id.toString(),
        chatId: userMessage.chatId,
        chatType: userMessage.chatType,
        seq: userMessage.seq,
        content: userMessage.content,
        senderId: userId,
        senderUsername: username,
        userId: userId,
        username: username,
        receiverId: userMessage.receiver,
        timestamp: userMessage.timestamp.toISOString(),
        type: userMessage.type,
        isGroupChat: false,
        status: userMessage.status,
        attachments: userMessage.attachments || null,
        fileUrl: userMessage.fileUrl || undefined,
        fileName: userMessage.fileName || undefined,
        mimeType: userMessage.mimeType || undefined,
        fileSize: userMessage.fileSize || undefined,
      };

      if (this.emitLegacyRealtimeEvents) {
        this.io.to(`user:${userId}`).emit('message', {
          type: 'chat',
          data: userMessageData,
        });
      }
      this.emitRealtimeToUser(userId, {
        type: 'message',
        payload: userMessageData,
      });

      // 调用简化的AI函数
      console.log('🔗 向 AI agent plane 发送请求...');
      const agentReply = await generateUserAgentReply({
        userId,
        message: aiQuery,
        imageData: imageData ? {
          mimeType: imageData.mimeType,
          base64Data: imageData.base64Data,
        } : undefined,
      });
      const aiReply = agentReply.message;

      console.log('✅ 收到AI回复:', aiReply.substring(0, 100) + '...');

      // 发送AI回复
      await this.sendAiResponse({ data: { message: aiReply } }, userId, username, aiBotId);

    } catch (error: any) {
      console.error('❌ AI消息处理失败:', error);
      socket.emit('message', {
        type: 'error',
        message: 'AI服务暂时不可用，请稍后再试',
      });
    }
  }

  // 发送AI成功响应
  private async sendAiResponse(aiResponse: any, userId: string, username: string, aiBotId?: string): Promise<void> {
    try {
      const aiMessage = aiResponse.data?.message || '抱歉，我现在无法理解你的问题。';

      const resolvedAiBotId = aiBotId || (await User.findOne({ where: { username: 'Gemini AI' } }))?.id || 'ai';

      // 在执行数据库操作前，确保 MongoDB 就绪
      await waitForMongoReady(15000);

      // 保存AI回复消息
      const { message: aiMessageDoc } = await createAndFanoutMessage({
        senderId: resolvedAiBotId,
        receiverId: userId,
        chatType: 'private',
        content: aiMessage,
        type: MessageType.TEXT,
      });

      // 构建广播消息数据
      const messageData = {
        id: aiMessageDoc._id.toString(),
        chatId: aiMessageDoc.chatId,
        chatType: aiMessageDoc.chatType,
        seq: aiMessageDoc.seq,
        content: aiMessageDoc.content,
        senderId: resolvedAiBotId,
        senderUsername: 'Gemini AI',
        userId: resolvedAiBotId,
        username: 'Gemini AI',
        receiverId: aiMessageDoc.receiver,
        timestamp: aiMessageDoc.timestamp.toISOString(),
        type: aiMessageDoc.type,
        isGroupChat: false,
        status: aiMessageDoc.status,
        attachments: aiMessageDoc.attachments || null,
      };

      // 广播AI回复
      if (this.emitLegacyRealtimeEvents) {
        this.io.to(`user:${userId}`).emit('message', {
          type: 'chat',
          data: messageData,
        });
      }
      this.emitRealtimeToUser(userId, {
        type: 'message',
        payload: messageData,
      });

      console.log(`🤖 AI回复已发送: "${aiMessage.substring(0, 100)}..."`);

    } catch (error) {
      console.error('❌ 发送AI响应失败:', error);
    }
  }

  // 发送AI错误响应
  private async sendAiError(errorResponse: any, socket: Socket): Promise<void> {
    const errorMessage = errorResponse.error || 'AI服务出现错误';
    socket.emit('message', {
      type: 'error',
      message: errorMessage,
    });
  }

  // 设置用户在线状态
  private async setUserOnline(userId: string, username: string, socketId: string): Promise<void> {
    try {
      const onlineUser: OnlineUser = {
        userId,
        username,
        socketId,
        connectedAt: new Date().toISOString(),
      };

      // 存储到 Redis
      await redis.hset('online_users', userId, JSON.stringify(onlineUser));
      await redis.expire('online_users', 86400); // 24小时过期

      // 同时设置用户最后活跃时间
      await redis.set(`user:${userId}:last_seen`, new Date().toISOString(), 'EX', 86400);
    } catch (error) {
      console.error('设置用户在线状态失败:', error);
    }
  }

  // 设置用户离线状态
  private async setUserOffline(userId: string): Promise<void> {
    try {
      // 从在线用户中移除
      await redis.hdel('online_users', userId);

      // 更新最后见过时间
      await redis.set(`user:${userId}:last_seen`, new Date().toISOString(), 'EX', 86400 * 7); // 7天
    } catch (error) {
      console.error('设置用户离线状态失败:', error);
    }
  }

  // 获取在线用户列表
  private async getOnlineUsers(): Promise<OnlineUser[]> {
    try {
      const onlineUsersData = await redis.hgetall('online_users');
      const onlineUsers: OnlineUser[] = [];

      for (const [userId, userData] of Object.entries(onlineUsersData)) {
        try {
          const user = JSON.parse(userData) as OnlineUser;
          onlineUsers.push(user);
        } catch (error) {
          console.error('解析在线用户数据失败:', error);
          // 移除损坏的数据
          await redis.hdel('online_users', userId);
        }
      }

      return onlineUsers;
    } catch (error) {
      console.error('获取在线用户列表失败:', error);
      return [];
    }
  }

  // 获取用户最后见过时间
  public async getUserLastSeen(userId: string): Promise<string | null> {
    try {
      return await redis.get(`user:${userId}:last_seen`);
    } catch (error) {
      console.error('获取用户最后见过时间失败:', error);
      return null;
    }
  }

  // 检查用户是否在线
  public async isUserOnline(userId: string): Promise<boolean> {
    try {
      const userData = await redis.hget('online_users', userId);
      return userData !== null;
    } catch (error) {
      console.error('检查用户在线状态失败:', error);
      return false;
    }
  }

  // 获取 Socket.IO 实例
  public getIO(): SocketIOServer {
    return this.io;
  }

  // 发送消息给指定用户
  public async sendMessageToUser(userId: string, message: any): Promise<void> {
    this.io.to(`user:${userId}`).emit('message', message);
  }

  // 根据MIME类型和文件名确定消息类型
  private determineMessageType(mimeType: string, fileName: string): string {
    console.log(`🔍 分析文件类型: mimeType="${mimeType}", fileName="${fileName}"`);

    if (!mimeType && !fileName) {
      return 'text';
    }

    // 先按MIME类型判断
    if (mimeType) {
      if (mimeType.startsWith('image/')) {
        console.log('🇮 识别为图片类型');
        return 'image';
      }

      if (mimeType.startsWith('audio/')) {
        console.log('🔉 识别为音频类型');
        return 'audio';
      }

      if (mimeType.startsWith('video/')) {
        console.log('🎥 识别为视频类型');
        return 'video';
      }

      // 其他类型的文件
      if (mimeType.includes('pdf')) {
        console.log('📄 识别为PDF文档');
        return 'document';
      }

      if (mimeType.includes('word') || mimeType.includes('officedocument')) {
        console.log('📝 识别为Office文档');
        return 'document';
      }

      if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
        console.log('📊 识别为Excel表格');
        return 'document';
      }

      if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) {
        console.log('📽 识别为PowerPoint演示');
        return 'document';
      }

      if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('compressed')) {
        console.log('🗜 识别为压缩文件');
        return 'document';
      }

      if (mimeType.includes('text/')) {
        console.log('📝 识别为文本文件');
        return 'document';
      }
    }

    // 如果MIME类型无法判断，按文件扩展名判断
    if (fileName) {
      const ext = fileName.toLowerCase();

      if (ext.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/)) {
        console.log('🇮 按扩展名识别为图片');
        return 'image';
      }

      if (ext.match(/\.(mp3|wav|flac|aac|ogg|m4a)$/)) {
        console.log('🔉 按扩展名识别为音频');
        return 'audio';
      }

      if (ext.match(/\.(mp4|avi|mov|mkv|wmv|flv|webm)$/)) {
        console.log('🎥 按扩展名识别为视频');
        return 'video';
      }

      if (ext.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|zip|rar|7z)$/)) {
        console.log('📄 按扩展名识别为文档');
        return 'document';
      }
    }

    // 默认为文档类型
    console.log('📄 默认识别为文档类型');
    return 'document';
  }
}

export default SocketService;
