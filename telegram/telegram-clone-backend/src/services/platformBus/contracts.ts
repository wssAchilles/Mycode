export const PLATFORM_EVENT_SPEC_VERSION = 'platform.event.v1';
export const PLATFORM_EVENT_STREAM_KEY = 'platform:events:v1';
export const PLATFORM_EVENT_DLQ_STREAM_KEY = 'platform:events:dlq:v1';
export const PLATFORM_EVENT_STREAM_MAX_LEN = 5000;
export const PLATFORM_EVENT_RECENT_LIMIT = 120;

export type PlatformEventTopic =
  | 'sync_wake_requested'
  | 'presence_fanout_requested'
  | 'notification_dispatch_requested';

export interface PlatformEventEnvelope<TPayload = PlatformEventPayload> {
  specVersion: typeof PLATFORM_EVENT_SPEC_VERSION;
  producer: 'node-backend';
  eventId: string;
  topic: PlatformEventTopic;
  emittedAt: string;
  partitionKey: string;
  payload: TPayload;
}

export interface SyncWakeRequestedPayload {
  userId: string;
  updateId: number;
  wakeChannel: string;
  source: 'update_service';
}

export interface PresenceFanoutRequestedPayload {
  userId: string;
  status: 'online' | 'offline';
  lastSeen?: string | null;
  target: 'broadcast' | 'user' | 'room' | 'socket';
  targetId?: string;
  source: 'socket_service';
}

export interface NotificationDispatchRequestedPayload {
  userId: string;
  type: 'new_message' | 'contact_request' | 'mention' | 'system';
  title: string;
  body: string;
  data?: Record<string, any>;
  source: 'notification_dispatch_service';
}

export type PlatformEventPayload =
  | SyncWakeRequestedPayload
  | PresenceFanoutRequestedPayload
  | NotificationDispatchRequestedPayload;

export interface PlatformEventBusConsumerGroupSummary {
  name: string;
  consumers: number;
  pending: number;
  lag?: number;
  lastDeliveredId?: string;
}

export interface PlatformEventBusSummary {
  transport: 'redis_stream';
  streamKey: string;
  specVersion: typeof PLATFORM_EVENT_SPEC_VERSION;
  streamLength: number;
  countsByTopic: Partial<Record<PlatformEventTopic, number>>;
  recentEvents: PlatformEventEnvelope[];
  consumerGroups: PlatformEventBusConsumerGroupSummary[];
  lastPublishedAt?: string;
  publishErrors: number;
}
