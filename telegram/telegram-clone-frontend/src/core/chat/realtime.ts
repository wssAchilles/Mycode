import type {
  ContactRealtimePayload,
  MessageMutationRealtimePayload,
  SocialNotificationRealtimePayload,
  SyncStateRealtimePayload,
} from '../../features/realtime/contracts';

export type SocketRealtimeEvent =
  | { type: 'message'; payload: unknown }
  | { type: 'batch_messages'; payload: { chatId: string; messages: unknown[] } }
  | { type: 'presence'; payload: { userId: string; isOnline: boolean; lastSeen?: string } }
  | { type: 'readReceipt'; payload: { chatId: string; seq: number; readCount: number; readerId?: string } }
  | { type: 'groupUpdate'; payload: unknown }
  | { type: 'contactUpdate'; payload: ContactRealtimePayload }
  | { type: 'messageMutation'; payload: MessageMutationRealtimePayload }
  | { type: 'socialNotification'; payload: SocialNotificationRealtimePayload }
  | { type: 'syncState'; payload: SyncStateRealtimePayload };
