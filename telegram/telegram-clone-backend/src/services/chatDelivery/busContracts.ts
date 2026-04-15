import type {
  FanoutTopology,
  MessageFanoutCommand,
  MessageFanoutDispatchResult,
  MessageFanoutProjectionResult,
} from './contracts';

export const CHAT_DELIVERY_EVENT_SPEC_VERSION = 'chat.delivery.v1';
export const CHAT_DELIVERY_EVENT_STREAM_KEY = 'chat:delivery:bus:v1';
export const CHAT_DELIVERY_EVENT_DLQ_STREAM_KEY = 'chat:delivery:bus:dlq:v1';
export const CHAT_DELIVERY_EVENT_STREAM_MAX_LEN = 5000;
export const CHAT_DELIVERY_EVENT_RECENT_LIMIT = 120;

export type ChatDeliveryEventTopic =
  | 'message_written'
  | 'fanout_requested'
  | 'fanout_skipped'
  | 'fanout_sync_fallback'
  | 'fanout_projection_started'
  | 'fanout_projection_completed'
  | 'fanout_projection_failed'
  | 'fanout_replay_queued';

export interface ChatDeliveryEventEnvelope<TPayload = ChatDeliveryEventPayload> {
  specVersion: typeof CHAT_DELIVERY_EVENT_SPEC_VERSION;
  producer: 'node-backend';
  eventId: string;
  topic: ChatDeliveryEventTopic;
  emittedAt: string;
  partitionKey: string;
  payload: TPayload;
}

export interface ChatDeliveryMessageWrittenPayload {
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  recipientIds: string[];
  recipientCount: number;
  topology: FanoutTopology;
  dispatchPlanned: boolean;
  isLargeGroup: boolean;
}

export interface ChatDeliveryFanoutRequestedPayload {
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  recipientIds: string[];
  recipientCount: number;
  topology: FanoutTopology;
  outboxId?: string;
  dispatchMode: MessageFanoutDispatchResult['mode'];
  jobIds: string[];
  projection?: MessageFanoutProjectionResult;
  skippedReason?: string;
}

export interface ChatDeliveryProjectionPayload {
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  recipientIds: string[];
  recipientCount: number;
  topology: FanoutTopology;
  outboxId?: string;
  chunkIndex: number;
  chunkCount: number;
  totalRecipientCount: number;
  jobId?: string;
  attemptCount?: number;
  replayCount?: number;
  projection?: MessageFanoutProjectionResult;
  errorMessage?: string;
  terminal?: boolean;
}

export interface ChatDeliveryReplayQueuedPayload {
  outboxId: string;
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  replaySource?: 'manual_replay' | 'primary_fallback';
  replayedChunkCount: number;
  replayCount: number;
  queuedJobIds: string[];
  chunks: Array<{
    chunkIndex: number;
    recipientCount: number;
    chunkCount: number;
    totalRecipientCount: number;
  }>;
}

export type ChatDeliveryEventPayload =
  | ChatDeliveryMessageWrittenPayload
  | ChatDeliveryFanoutRequestedPayload
  | ChatDeliveryProjectionPayload
  | ChatDeliveryReplayQueuedPayload;

export interface ChatDeliveryEventBusConsumerGroupSummary {
  name: string;
  consumers: number;
  pending: number;
  lag?: number;
  lastDeliveredId?: string;
}

export interface ChatDeliveryEventBusSummary {
  transport: 'redis_stream';
  streamKey: string;
  specVersion: typeof CHAT_DELIVERY_EVENT_SPEC_VERSION;
  streamLength: number;
  countsByTopic: Partial<Record<ChatDeliveryEventTopic, number>>;
  recentEvents: ChatDeliveryEventEnvelope[];
  consumerGroups: ChatDeliveryEventBusConsumerGroupSummary[];
  lastPublishedAt?: string;
  publishErrors: number;
}

export interface MessagePersistedEventInput {
  messageId: string;
  chatId: string;
  chatType: 'private' | 'group';
  seq: number;
  senderId: string;
  recipientIds: string[];
  topology: FanoutTopology;
  dispatchPlanned: boolean;
  isLargeGroup: boolean;
}

export interface FanoutRequestedEventInput {
  command: MessageFanoutCommand;
  dispatch: MessageFanoutDispatchResult;
  outboxId?: string;
  jobIds: string[];
}

export interface ProjectionLifecycleEventInput {
  command: MessageFanoutCommand;
  outboxId?: string;
  chunkIndex: number;
  chunkCount: number;
  totalRecipientCount: number;
  jobId?: string;
  attemptCount?: number;
  replayCount?: number;
  projection?: MessageFanoutProjectionResult;
  errorMessage?: string;
  terminal?: boolean;
}
