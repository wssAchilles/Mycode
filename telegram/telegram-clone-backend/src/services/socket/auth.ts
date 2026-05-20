import { verifyAccessToken } from '../../utils/jwt';
import User from '../../models/User';
import Group from '../../models/Group';
import GroupMember, { MemberStatus } from '../../models/GroupMember';
import { Op } from 'sequelize';
import { createChildLogger } from '../../utils/logger';
import type { SocketHandlerContext, TypedSocket } from './types';
import type { RealtimeEventAuthFailureClass } from '../realtimeProtocol/eventBusContracts';

const log = createChildLogger('services:socket:auth');

export interface AuthHandlerDeps {
  ctx: SocketHandlerContext;
  publishSessionHeartbeat: (socket: TypedSocket, activity: string, options?: {
    force?: boolean;
    roomId?: string;
    authFailureClass?: RealtimeEventAuthFailureClass;
  }) => void;
  publishPresenceUpdated: (socket: TypedSocket, status: 'online' | 'offline' | 'away' | 'unknown', reason: string) => void;
  emitRealtimeBroadcast: (event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }) => void;
  emitRealtimeToSocket: (socketId: string, event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }) => void;
  setUserOnline: (userId: string, username: string, socketId: string) => Promise<void>;
  setUserOffline: (userId: string) => Promise<void>;
  getOnlineUsers: () => Promise<Array<{ userId: string; username: string; socketId: string; connectedAt: string }>>;
  publishPlatformPresenceFanout: (params: {
    target: 'broadcast' | 'user' | 'room' | 'socket';
    targetId?: string;
    userId: string;
    isOnline: boolean;
    lastSeen?: string | number;
  }) => void;
}

export class AuthHandler {
  constructor(private deps: AuthHandlerDeps) {}

  classifyAuthFailure(error: unknown): RealtimeEventAuthFailureClass {
    const message = String((error as Error | undefined)?.message || '').toLowerCase();
    if (message.includes('expired')) return 'expired';
    if (message.includes('forbidden') || message.includes('permission')) return 'forbidden';
    if (message.includes('degraded')) return 'degraded_accept';
    if (message) return 'auth_failed';
    return 'unknown';
  }

  async handleUserJoin(socket: TypedSocket, token: string): Promise<void> {
    const { ctx, publishSessionHeartbeat, publishPresenceUpdated, emitRealtimeBroadcast,
      emitRealtimeToSocket, setUserOnline, getOnlineUsers, publishPlatformPresenceFanout } = this.deps;

    if (!token) {
      throw new Error('缺少认证令牌');
    }

    const decoded = await verifyAccessToken(token);
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      throw new Error('用户不存在');
    }

    socket.data.userId = user.id;
    socket.data.username = user.username;

    await socket.join(`user:${user.id}`);

    const joinedRooms = [`user:${user.id}`];
    await this.joinUserGroupRooms(socket, user.id, joinedRooms);

    ctx.sessionRegistry.markSocketAuthenticated({
      socketId: socket.id,
      userId: user.id,
      username: user.username,
    });
    ctx.ops.recordSocketAuthenticated(socket.id, user.id);

    for (const roomId of joinedRooms) {
      ctx.sessionRegistry.addRoomSubscription(socket.id, roomId);
      ctx.ops.recordRoomJoined(socket.id, user.id, roomId);
      publishSessionHeartbeat(socket, 'room_joined', { force: true, roomId });
    }

    publishSessionHeartbeat(socket, 'authenticate_success', { force: true });
    publishPresenceUpdated(socket, 'online', 'authenticated');

    await setUserOnline(user.id, user.username, socket.id);

    this.broadcastUserOnline(socket, user.id, user.username, emitRealtimeBroadcast, publishPlatformPresenceFanout);

    const onlineUsers = await getOnlineUsers();
    this.sendOnlineUsersToSocket(socket, onlineUsers, emitRealtimeToSocket);

    socket.emit('authenticated', {
      userId: user.id,
      username: user.username,
      message: `欢迎, ${user.username}！您已成功连接到聊天服务器。`,
    });
    socket.emit('message', {
      type: 'success',
      message: `欢迎, ${user.username}！您已成功连接到聊天服务器。`,
    });

    ctx.metrics.increment('socket.authenticate.success');
  }

  async handleUserDisconnect(socket: TypedSocket, reason?: string): Promise<void> {
    const { ctx, publishPresenceUpdated, emitRealtimeBroadcast, setUserOffline,
      publishPlatformPresenceFanout } = this.deps;
    const { userId, username } = socket.data;

    this.deps.publishSessionHeartbeat(socket, 'disconnect_cleanup', { force: true });

    // Clean up heartbeat tracking
    ctx.sessionRegistry.removeSocket(socket.id);
    ctx.ops.recordSocketDisconnected(socket.id, userId);

    if (userId && username) {
      await setUserOffline(userId);

      if (ctx.emitLegacyRealtimeEvents) {
        socket.broadcast.emit('userOffline', { userId, username });
      }

      publishPlatformPresenceFanout({ target: 'broadcast', userId, isOnline: false });
      emitRealtimeBroadcast({
        type: 'presence',
        payload: { userId, isOnline: false },
      });
      publishPresenceUpdated(socket, 'offline', 'disconnect');
      ctx.metrics.increment('socket.presence.offlineBroadcast');

      log.info(`用户已断开连接: ${username} (${userId})`);
    }

    log.info(`Socket 连接已断开: ${socket.id}`);
  }

  private async joinUserGroupRooms(
    socket: TypedSocket,
    userId: string,
    joinedRooms: string[],
  ): Promise<void> {
    try {
      const groups = await GroupMember.findAll({
        where: {
          userId,
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
      log.error({ err: error }, '自动加入群聊房间失败');
    }
  }

  private broadcastUserOnline(
    socket: TypedSocket,
    userId: string,
    username: string,
    emitRealtimeBroadcast: (event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }) => void,
    publishPlatformPresenceFanout: (params: {
      target: 'broadcast' | 'user' | 'room' | 'socket';
      targetId?: string;
      userId: string;
      isOnline: boolean;
    }) => void,
  ): void {
    const { ctx } = this.deps;

    if (ctx.emitLegacyRealtimeEvents) {
      socket.broadcast.emit('userOnline', { userId, username });
    }

    publishPlatformPresenceFanout({ target: 'broadcast', userId, isOnline: true });
    emitRealtimeBroadcast({
      type: 'presence',
      payload: { userId, isOnline: true },
    });
    ctx.metrics.increment('socket.presence.onlineBroadcast');
  }

  private sendOnlineUsersToSocket(
    socket: TypedSocket,
    onlineUsers: Array<{ userId: string }>,
    emitRealtimeToSocket: (socketId: string, event: { type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate'; payload: any }) => void,
  ): void {
    const { ctx } = this.deps;

    if (ctx.emitLegacyRealtimeEvents) {
      socket.emit('onlineUsers', onlineUsers as any);
    }

    if (onlineUsers.length) {
      for (const u of onlineUsers) {
        emitRealtimeToSocket(socket.id, {
          type: 'presence',
          payload: { userId: u.userId, isOnline: true },
        });
      }
    }
  }
}
