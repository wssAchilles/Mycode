import { randomUUID } from 'node:crypto';

import type {
  NotificationDispatchRequestedPayload,
  PlatformEventEnvelope,
  PresenceFanoutRequestedPayload,
  SyncWakeRequestedPayload,
} from './contracts';
import { PLATFORM_EVENT_SPEC_VERSION } from './contracts';

function buildEnvelope<TPayload>(
  topic: PlatformEventEnvelope<TPayload>['topic'],
  partitionKey: string,
  payload: TPayload,
): PlatformEventEnvelope<TPayload> {
  return {
    specVersion: PLATFORM_EVENT_SPEC_VERSION,
    producer: 'node-backend',
    eventId: randomUUID(),
    topic,
    emittedAt: new Date().toISOString(),
    partitionKey,
    payload,
  };
}

export function buildSyncWakeRequestedEvent(
  payload: SyncWakeRequestedPayload,
): PlatformEventEnvelope<SyncWakeRequestedPayload> {
  return buildEnvelope('sync_wake_requested', payload.userId, payload);
}

export function buildPresenceFanoutRequestedEvent(
  payload: PresenceFanoutRequestedPayload,
): PlatformEventEnvelope<PresenceFanoutRequestedPayload> {
  return buildEnvelope(
    'presence_fanout_requested',
    payload.targetId || payload.userId,
    payload,
  );
}

export function buildNotificationDispatchRequestedEvent(
  payload: NotificationDispatchRequestedPayload,
): PlatformEventEnvelope<NotificationDispatchRequestedPayload> {
  return buildEnvelope('notification_dispatch_requested', payload.userId, payload);
}
