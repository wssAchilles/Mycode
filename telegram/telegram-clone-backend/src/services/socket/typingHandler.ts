import { createChildLogger } from '../../utils/logger';
import type { TypedSocket, RealtimeDeliveryTarget } from './types';

const log = createChildLogger('services:socket:typing');

export interface TypingHandlerDeps {
  publishTypingUpdated: (socket: TypedSocket, params: { isTyping: boolean; receiverId?: string; groupId?: string }) => void;
  publishSessionHeartbeat: (socket: TypedSocket, activity: string, options?: { roomId?: string }) => void;
  dispatchTyping: (
    target: RealtimeDeliveryTarget,
    payload: { userId: string; username: string; isTyping: boolean; groupId?: string },
  ) => void;
}

export class TypingHandler {
  constructor(private deps: TypingHandlerDeps) {}

  async handleTypingStart(socket: TypedSocket, data: { receiverId: string; groupId?: string }): Promise<void> {
    if (!socket.data.userId) return;
    const { receiverId, groupId } = data;

    this.deps.publishTypingUpdated(socket, { isTyping: true, receiverId, groupId });
    this.deps.publishSessionHeartbeat(socket, 'typing_start', {
      roomId: groupId ? `room:${groupId}` : undefined,
    });

    if (groupId) {
      if (!socket.rooms.has(`room:${groupId}`)) return;
      this.deps.dispatchTyping(
        { kind: 'room', id: groupId, excludeSocketIds: [socket.id] },
        {
          userId: socket.data.userId,
          username: socket.data.username || 'Unknown',
          isTyping: true,
          groupId,
        },
      );
    } else if (receiverId) {
      this.deps.dispatchTyping(
        { kind: 'user', id: receiverId },
        {
          userId: socket.data.userId,
          username: socket.data.username || 'Unknown',
          isTyping: true,
        },
      );
    }
  }

  async handleTypingStop(socket: TypedSocket, data: { receiverId: string; groupId?: string }): Promise<void> {
    if (!socket.data.userId) return;
    const { receiverId, groupId } = data;

    this.deps.publishTypingUpdated(socket, { isTyping: false, receiverId, groupId });
    this.deps.publishSessionHeartbeat(socket, 'typing_stop', {
      roomId: groupId ? `room:${groupId}` : undefined,
    });

    if (groupId) {
      if (!socket.rooms.has(`room:${groupId}`)) return;
      this.deps.dispatchTyping(
        { kind: 'room', id: groupId, excludeSocketIds: [socket.id] },
        {
          userId: socket.data.userId,
          username: socket.data.username || 'Unknown',
          isTyping: false,
          groupId,
        },
      );
    } else if (receiverId) {
      this.deps.dispatchTyping(
        { kind: 'user', id: receiverId },
        {
          userId: socket.data.userId,
          username: socket.data.username || 'Unknown',
          isTyping: false,
        },
      );
    }
  }
}
