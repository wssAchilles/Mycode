/**
 * 领域实时事件契约定义
 * 对标 Telegram UpdateLog、Zulip 事件队列与 Centrifugo 语义规范
 */

export type ContactRealtimeAction =
  | 'request_received'
  | 'request_sent'
  | 'request_accepted'
  | 'request_rejected'
  | 'contact_removed'
  | 'contact_blocked'
  | 'alias_updated';

export interface ContactRealtimeRequestSnapshot {
  id: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  alias?: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked';
  addedAt?: string;
}

export interface ContactRealtimeSentSnapshot {
  id: string;
  contactId: string;
  username: string;
  avatarUrl?: string | null;
  addedAt?: string;
}

export interface ContactRealtimeContactSnapshot {
  id: string;
  userId: string;
  contactId: string;
  username: string;
  avatarUrl?: string | null;
  alias?: string | null;
  status: 'accepted' | 'pending' | 'blocked' | 'rejected';
  isOnline?: boolean;
  addedAt?: string;
}

export interface ContactRealtimePayload {
  eventId: string;
  emittedAt: string;
  action: ContactRealtimeAction;
  actorId: string;
  requestId?: string;
  userId?: string;
  contactId?: string;
  alias?: string | null;
  request?: ContactRealtimeRequestSnapshot;
  sentRequest?: ContactRealtimeSentSnapshot;
  contact?: ContactRealtimeContactSnapshot;
}

export type MessageMutationAction = 'edited' | 'deleted' | 'reaction_updated';

export interface MessageReactionSummary {
  emoji: string;
  userIds: string[];
}

export interface MessageMutationRealtimePayload {
  eventId: string;
  emittedAt: string;
  action: MessageMutationAction;
  chatId: string;
  chatType: 'private' | 'group';
  groupId?: string | null;
  messageId: string;
  seq?: number | null;
  actorId: string;
  content?: string;
  editedAt?: string;
  deletedAt?: string;
  reactions?: MessageReactionSummary[];
}

export type SocialNotificationAction = 'like' | 'comment' | 'repost' | 'follow';

export interface SocialNotificationActor {
  id: string;
  username: string;
  avatarUrl?: string | null;
}

export interface SocialNotificationRealtimePayload {
  eventId: string;
  emittedAt: string;
  action: SocialNotificationAction;
  recipientId: string;
  actor: SocialNotificationActor;
  postId?: string;
  commentId?: string;
  previewText?: string;
}

export interface SyncStateRealtimePayload {
  eventId: string;
  emittedAt: string;
  action: 'chat_read';
  userId: string;
  chatId: string;
  seq: number;
}
