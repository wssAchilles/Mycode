import { redis } from '../../config/redis';
import { createChildLogger } from '../../utils/logger';
import { realtimeOps } from '../realtimeProtocol/realtimeOps';
import { buildGroupChatId } from '../../utils/chat';
import { CHANNELS, pubSubService, type UserStatusEvent } from '../pubSubService';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import type { TypedSocket, TypedSocketIOServer, OnlineUser, RealtimeBatchEvent } from './types';

const log = createChildLogger('services:socket:presence');

export interface PresenceManagerDeps {
  io: TypedSocketIOServer;
  emitRealtimeToSocket: (socketId: string, event: RealtimeBatchEvent) => void;
  emitRealtimeBroadcast: (event: RealtimeBatchEvent) => void;
  emitLegacyRealtimeEvents: boolean;
  publishSessionHeartbeat: (socket: TypedSocket, activity: string, options?: { force?: boolean }) => void;
}

export class PresenceManager {
  constructor(private deps: PresenceManagerDeps) {}

  setupPubSubBridge(): void {
    void pubSubService.initialize().catch((error) => {
      log.warn({ err: error }, 'Redis Pub/Sub bridge 初始化失败');
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

  async handlePresenceSubscribe(socket: TypedSocket, userIds: string[]): Promise<void> {
    if (!socket.data.userId || !Array.isArray(userIds)) return;

    realtimeOps.recordPresenceSubscription(socket.data.userId, userIds.length);
    this.deps.publishSessionHeartbeat(socket, 'presence_subscribe');

    for (const targetId of userIds) {
      const isOnline = await this.isUserOnline(targetId);
      if (isOnline) {
        this.emitPresenceUpdateToSocket(socket.id, targetId, true);
      } else {
        const lastSeen = await this.getUserLastSeen(targetId);
        this.emitPresenceUpdateToSocket(socket.id, targetId, false, lastSeen || undefined);
      }
    }
  }

  async handleStatusUpdate(socket: TypedSocket, status: string): Promise<void> {
    if (!socket.data.userId) return;

    this.deps.publishSessionHeartbeat(socket, 'status_changed');
    this.deps.publishSessionHeartbeat(socket, 'status_broadcast');

    const { io, emitLegacyRealtimeEvents } = this.deps;

    if (emitLegacyRealtimeEvents) {
      socket.broadcast.emit('userStatusChanged', {
        userId: socket.data.userId || '',
        username: socket.data.username || '',
        status,
      });
    }

    log.info(`用户 ${socket.data.username} 状态变更为 ${status}`);
  }

  async handleJoinRoom(socket: TypedSocket, roomId: string): Promise<void> {
    const { io } = this.deps;

    if (!socket.data.userId) {
      socket.emit('message', { type: 'error', message: '请先登录' });
      return;
    }

    const Group = (await import('../../models/Group')).default;
    const GroupMember = (await import('../../models/GroupMember')).default;

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
    log.info(`用户 ${socket.data.username} 加入房间 ${roomId}`);
    socket.emit('message', { type: 'success', message: `已加入房间 ${roomId}` });
  }

  async handleLeaveRoom(socket: TypedSocket, roomId: string): Promise<void> {
    if (roomId) {
      await socket.leave(`room:${roomId}`);
      log.info(`用户 ${socket.data.username} 离开房间 ${roomId}`);
    }
  }

  // Redis presence operations
  async setUserOnline(userId: string, username: string, socketId: string): Promise<void> {
    try {
      const onlineUser: OnlineUser = {
        userId,
        username,
        socketId,
        connectedAt: new Date().toISOString(),
      };
      const now = new Date().toISOString();
      const pipe = redis.pipeline();
      pipe.hset('online_users', userId, JSON.stringify(onlineUser));
      pipe.expire('online_users', 86400);
      pipe.set(`user:${userId}:last_seen`, now, 'EX', 86400);
      await pipe.exec();
    } catch (error) {
      log.error({ err: error }, '设置用户在线状态失败');
    }
  }

  async setUserOffline(userId: string): Promise<void> {
    try {
      const pipe = redis.pipeline();
      pipe.hdel('online_users', userId);
      pipe.set(`user:${userId}:last_seen`, new Date().toISOString(), 'EX', 86400 * 7);
      await pipe.exec();
    } catch (error) {
      log.error({ err: error }, '设置用户离线状态失败');
    }
  }

  async getOnlineUsers(): Promise<OnlineUser[]> {
    try {
      const onlineUsersData = await redis.hgetall('online_users');
      const onlineUsers: OnlineUser[] = [];

      for (const [userId, userData] of Object.entries(onlineUsersData)) {
        try {
          onlineUsers.push(JSON.parse(userData) as OnlineUser);
        } catch (error) {
          log.error({ err: error }, '解析在线用户数据失败');
          await redis.hdel('online_users', userId);
        }
      }

      return onlineUsers;
    } catch (error) {
      log.error({ err: error }, '获取在线用户列表失败');
      return [];
    }
  }

  async getUserLastSeen(userId: string): Promise<string | null> {
    try {
      return await redis.get(`user:${userId}:last_seen`);
    } catch (error) {
      log.error({ err: error }, '获取用户最后见过时间失败');
      return null;
    }
  }

  async isUserOnline(userId: string): Promise<boolean> {
    try {
      const userData = await redis.hget('online_users', userId);
      return userData !== null;
    } catch (error) {
      log.error({ err: error }, '检查用户在线状态失败');
      return false;
    }
  }

  private emitPresenceBroadcastFromBus(payload: {
    userId: string;
    isOnline: boolean;
    lastSeen?: string | number;
  }): void {
    if (!payload.userId) return;
    this.deps.emitRealtimeBroadcast({
      type: 'presence',
      payload: {
        userId: payload.userId,
        isOnline: payload.isOnline,
        lastSeen: payload.lastSeen || undefined,
      },
    });
  }

  private emitPresenceUpdateToSocket(
    socketId: string,
    targetId: string,
    isOnline: boolean,
    lastSeen?: string,
  ): void {
    const { io, emitLegacyRealtimeEvents, emitRealtimeToSocket } = this.deps;

    if (emitLegacyRealtimeEvents) {
      io.to(socketId).emit('presenceUpdate', {
        userId: targetId,
        status: isOnline ? 'online' : 'offline',
        lastSeen: lastSeen || undefined,
      });
    }

    emitRealtimeToSocket(socketId, {
      type: 'presence',
      payload: { userId: targetId, isOnline, lastSeen: lastSeen || undefined },
    });
  }
}
