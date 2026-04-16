import { randomUUID } from 'node:crypto';

export const REALTIME_EVENT_SPEC_VERSION = 'realtime.event.v1';
export const REALTIME_EVENT_STREAM_KEY = 'realtime:ingress:v1';
export const REALTIME_EVENT_PRESENCE_STREAM_KEY = 'realtime:presence:v1';
export const REALTIME_EVENT_DELIVERY_STREAM_KEY = 'realtime:delivery:v1';
export const REALTIME_EVENT_DLQ_STREAM_KEY = 'realtime:dlq:v1';
export const REALTIME_EVENT_STREAM_MAX_LEN = 5000;
export const REALTIME_EVENT_RECENT_LIMIT = 120;
export const REALTIME_EVENT_SOURCE_SOCKET_IO_COMPAT = 'node_socket_io_compat';

export type RealtimeEventTopic =
  | 'session_opened'
  | 'session_closed'
  | 'session_heartbeat'
  | 'presence_updated'
  | 'typing_updated'
  | 'message_command_requested'
  | 'read_ack_requested';

export type RealtimeEventAuthFailureClass =
  | 'auth_failed'
  | 'expired'
  | 'forbidden'
  | 'degraded_accept'
  | 'unknown';

export interface RealtimeSessionLifecyclePayload {
  transport: 'socket_io_compat';
  activity?: string;
  roomId?: string | null;
  status?: 'online' | 'offline' | 'away' | 'unknown';
  authFailureClass?: RealtimeEventAuthFailureClass;
  closeReason?: string;
  connectedAt?: string;
  closedAt?: string;
}

export interface RealtimePresenceUpdatedPayload {
  transport: 'socket_io_compat';
  status: 'online' | 'offline' | 'away' | 'unknown';
  reason: string;
}

export interface RealtimeTypingUpdatedPayload {
  transport: 'socket_io_compat';
  isTyping: boolean;
  receiverId?: string | null;
  groupId?: string | null;
}

export interface RealtimeMessageCommandRequestedPayload {
  transport: 'socket_io_compat';
  chatType: 'private' | 'group' | 'unknown';
  receiverId?: string | null;
  groupId?: string | null;
  messageType: string;
  contentLength: number;
  hasAttachments: boolean;
}

export interface RealtimeReadAckRequestedPayload {
  transport: 'socket_io_compat';
  seq: number;
}

export type RealtimeEventPayload =
  | RealtimeSessionLifecyclePayload
  | RealtimePresenceUpdatedPayload
  | RealtimeTypingUpdatedPayload
  | RealtimeMessageCommandRequestedPayload
  | RealtimeReadAckRequestedPayload;

export interface RealtimeEventEnvelopeV1<TPayload = RealtimeEventPayload> {
  specVersion: typeof REALTIME_EVENT_SPEC_VERSION;
  eventId: string;
  topic: RealtimeEventTopic;
  emittedAt: string;
  partitionKey: string;
  traceId: string;
  source: typeof REALTIME_EVENT_SOURCE_SOCKET_IO_COMPAT | string;
  sessionId: string;
  userId: string | null;
  chatId: string | null;
  payload: TPayload;
}

export interface RealtimeEventBusConsumerGroupSummary {
  name: string;
  consumers: number;
  pending: number;
  lag?: number;
  lastDeliveredId?: string;
}

export interface RealtimeEventBusSummary {
  transport: 'redis_stream';
  streamKey: string;
  specVersion: typeof REALTIME_EVENT_SPEC_VERSION;
  streamLength: number;
  countsByTopic: Partial<Record<RealtimeEventTopic, number>>;
  recentEvents: RealtimeEventEnvelopeV1[];
  consumerGroups: RealtimeEventBusConsumerGroupSummary[];
  lastPublishedAt?: string;
  publishErrors: number;
}

export interface CreateRealtimeEventInput<TPayload = RealtimeEventPayload> {
  topic: RealtimeEventTopic;
  sessionId: string;
  userId?: string | null;
  chatId?: string | null;
  partitionKey?: string | null;
  traceId?: string | null;
  payload: TPayload;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function resolveRealtimePartitionKey(params: {
  sessionId: string;
  userId?: string | null;
  chatId?: string | null;
}): string {
  return (
    normalizeOptionalString(params.chatId) ||
    normalizeOptionalString(params.userId) ||
    normalizeOptionalString(params.sessionId) ||
    'unknown-session'
  );
}

export function createRealtimeEventEnvelope<TPayload = RealtimeEventPayload>(
  input: CreateRealtimeEventInput<TPayload>,
): RealtimeEventEnvelopeV1<TPayload> {
  return {
    specVersion: REALTIME_EVENT_SPEC_VERSION,
    eventId: randomUUID(),
    topic: input.topic,
    emittedAt: new Date().toISOString(),
    partitionKey:
      normalizeOptionalString(input.partitionKey) ||
      resolveRealtimePartitionKey({
        sessionId: input.sessionId,
        userId: input.userId,
        chatId: input.chatId,
      }),
    traceId: normalizeOptionalString(input.traceId) || randomUUID(),
    source: REALTIME_EVENT_SOURCE_SOCKET_IO_COMPAT,
    sessionId: input.sessionId,
    userId: normalizeOptionalString(input.userId),
    chatId: normalizeOptionalString(input.chatId),
    payload: input.payload,
  };
}
