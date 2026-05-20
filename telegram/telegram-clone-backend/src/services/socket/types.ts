import { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  RealtimeDeliveryTarget,
  RealtimeDeliveryTopic,
  RealtimeEventAuthFailureClass,
  RealtimeEventEnvelopeV1,
  RealtimeEventPayload,
  RealtimeCompatDispatchEnvelopeV1,
} from '../realtimeProtocol/eventBusContracts';
import type { realtimeSessionRegistry } from '../realtimeProtocol/realtimeSessionRegistry';
import type { realtimeOps } from '../realtimeProtocol/realtimeOps';
import type { chatRuntimeMetrics } from '../chatRuntimeMetrics';

// Online user interface
export interface OnlineUser {
  userId: string;
  username: string;
  socketId: string;
  connectedAt: string;
}

// Socket.IO event maps
export interface ServerToClientEvents {
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

export interface ClientToServerEvents {
  authenticate: (data: { token: string }) => void;
  sendMessage: (data: any, ack?: (response: { success: boolean; messageId?: string; seq?: number; clientTempId?: string; error?: string }) => void) => void;
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

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId?: string;
  username?: string;
}

export type TypedSocketIOServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// Realtime batch event types
export type RealtimeBatchEvent = {
  type: 'message' | 'presence' | 'readReceipt' | 'groupUpdate';
  payload: any;
};

export type RealtimeDispatchEvent =
  | RealtimeBatchEvent
  | {
      type: 'typing';
      payload: {
        userId: string;
        username: string;
        isTyping: boolean;
        groupId?: string;
      };
    };

// Shared dependency context for all handlers
export interface SocketHandlerContext {
  io: TypedSocketIOServer;
  sessionRegistry: typeof realtimeSessionRegistry;
  ops: typeof realtimeOps;
  metrics: typeof chatRuntimeMetrics;
  emitLegacyRealtimeEvents: boolean;
}

// Re-export realtime protocol types for handler convenience
export type {
  RealtimeDeliveryTarget,
  RealtimeDeliveryTopic,
  RealtimeEventAuthFailureClass,
  RealtimeEventEnvelopeV1,
  RealtimeEventPayload,
  RealtimeCompatDispatchEnvelopeV1,
};
