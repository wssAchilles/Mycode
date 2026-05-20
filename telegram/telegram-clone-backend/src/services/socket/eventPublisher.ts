import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import {
  createRealtimeEventEnvelope,
  type RealtimeEventAuthFailureClass,
  type RealtimeEventEnvelopeV1,
  type RealtimeEventPayload,
} from '../realtimeProtocol/eventBusContracts';
import { realtimeEventPublisher } from '../realtimeProtocol/realtimeEventPublisher';
import { buildGroupChatId } from '../../utils/chat';
import { platformEventPublisher } from '../platformBus/eventPublisher';
import { buildPresenceFanoutRequestedEvent } from '../platformBus/eventFactory';
import { createChildLogger } from '../../utils/logger';
import type { TypedSocket } from './types';

const log = createChildLogger('services:socket:eventPub');

export class EventPublisher {
  private readonly heartbeatThrottleMs: number;
  private readonly heartbeatLastBySession = new Map<string, number>();

  constructor(heartbeatThrottleMs: number) {
    this.heartbeatThrottleMs = heartbeatThrottleMs;
  }

  publishBoundaryEvent(event: RealtimeEventEnvelopeV1<RealtimeEventPayload>): void {
    void realtimeEventPublisher.publish([event]).catch((error) => {
      chatRuntimeMetrics.increment('realtime.eventBus.publish.backgroundErrors');
      log.error({ err: error }, '发布 realtime 边界事件失败');
    });
  }

  publishSessionHeartbeat(
    socket: TypedSocket,
    activity: string,
    options?: {
      force?: boolean;
      roomId?: string;
      authFailureClass?: RealtimeEventAuthFailureClass;
    },
  ): void {
    const now = Date.now();
    const lastPublishedAt = this.heartbeatLastBySession.get(socket.id) || 0;
    if (!options?.force && now - lastPublishedAt < this.heartbeatThrottleMs) return;

    this.heartbeatLastBySession.set(socket.id, now);
    this.publishBoundaryEvent(
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

  publishPresenceUpdated(
    socket: TypedSocket,
    status: 'online' | 'offline' | 'away' | 'unknown',
    reason: string,
  ): void {
    this.publishBoundaryEvent(
      createRealtimeEventEnvelope({
        topic: 'presence_updated',
        sessionId: socket.id,
        userId: socket.data.userId,
        payload: { transport: 'socket_io_compat', status, reason },
      }),
    );
  }

  publishTypingUpdated(
    socket: TypedSocket,
    params: { isTyping: boolean; receiverId?: string; groupId?: string },
  ): void {
    const chatId = params.groupId ? buildGroupChatId(params.groupId) : null;
    this.publishBoundaryEvent(
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

  publishMessageCommandRequested(socket: TypedSocket, data: any): void {
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
    this.publishBoundaryEvent(
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

  publishReadAckRequested(socket: TypedSocket, data: { chatId: string; seq: number }): void {
    if (!data?.chatId || typeof data?.seq !== 'number') return;

    this.publishSessionHeartbeat(socket, 'read_ack_requested');
    this.publishBoundaryEvent(
      createRealtimeEventEnvelope({
        topic: 'read_ack_requested',
        sessionId: socket.id,
        userId: socket.data.userId,
        chatId: data.chatId,
        payload: { transport: 'socket_io_compat', seq: data.seq },
      }),
    );
  }

  publishPlatformPresenceFanout(params: {
    target: 'broadcast' | 'user' | 'room' | 'socket';
    targetId?: string;
    userId: string;
    isOnline: boolean;
    lastSeen?: string | number;
  }): void {
    if (!params.userId) return;
    if (params.target !== 'broadcast') return;

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
        log.error({ err: error }, '发布 platform presence 事件失败');
      });
  }

  removeHeartbeatSession(socketId: string): void {
    this.heartbeatLastBySession.delete(socketId);
  }
}
