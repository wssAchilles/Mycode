import { randomUUID } from 'node:crypto';

const RECENT_EVENTS_LIMIT = 120;

type RealtimeOpsEventKind =
  | 'socket_connected'
  | 'socket_authenticated'
  | 'socket_disconnected'
  | 'room_joined'
  | 'room_left'
  | 'presence_subscribed'
  | 'realtime_emitted'
  | 'delivery_requested'
  | 'delivery_published'
  | 'delivery_publish_failed'
  | 'compat_dispatch_received'
  | 'compat_dispatch_emitted'
  | 'compat_fallback_emitted'
  | 'sync_wake';

interface RealtimeOpsEvent {
  id: string;
  kind: RealtimeOpsEventKind;
  at: string;
  userId?: string;
  socketId?: string;
  roomId?: string;
  target?: 'user' | 'room' | 'socket' | 'broadcast';
  eventType?: 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing';
  eventCount?: number;
  wakeSource?: 'event' | 'poll' | 'initial' | 'timeout';
  eventSource?: 'local' | 'pubsub';
  subscriptionCount?: number;
  dispatchSource?: 'local' | 'compat_dispatch' | 'fallback';
}

interface RealtimeOpsSnapshot {
  counters: Record<string, number>;
  recentEvents: RealtimeOpsEvent[];
  updatedAt: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class RealtimeOps {
  private readonly counters: Record<string, number> = {
    socketConnected: 0,
    socketAuthenticated: 0,
    socketDisconnected: 0,
    roomJoined: 0,
    roomLeft: 0,
    presenceSubscribed: 0,
    realtimeEmitted: 0,
    realtimeEmittedEvents: 0,
    deliveryRequested: 0,
    deliveryPublished: 0,
    deliveryPublishErrors: 0,
    compatDispatchReceived: 0,
    compatDispatchEmitted: 0,
    compatFallbackEmitted: 0,
    syncWakeEvent: 0,
    syncWakePoll: 0,
    syncWakeInitial: 0,
    syncWakeTimeout: 0,
  };
  private readonly recentEvents: RealtimeOpsEvent[] = [];
  private updatedAt: string | null = null;

  recordSocketConnected(socketId: string): void {
    this.counters.socketConnected += 1;
    this.recordEvent('socket_connected', { socketId });
  }

  recordSocketAuthenticated(socketId: string, userId: string): void {
    this.counters.socketAuthenticated += 1;
    this.recordEvent('socket_authenticated', { socketId, userId });
  }

  recordSocketDisconnected(socketId: string, userId?: string): void {
    this.counters.socketDisconnected += 1;
    this.recordEvent('socket_disconnected', { socketId, userId });
  }

  recordRoomJoined(socketId: string, userId: string | undefined, roomId: string): void {
    this.counters.roomJoined += 1;
    this.recordEvent('room_joined', { socketId, userId, roomId });
  }

  recordRoomLeft(socketId: string, userId: string | undefined, roomId: string): void {
    this.counters.roomLeft += 1;
    this.recordEvent('room_left', { socketId, userId, roomId });
  }

  recordPresenceSubscription(userId: string | undefined, subscriptionCount: number): void {
    this.counters.presenceSubscribed += 1;
    this.recordEvent('presence_subscribed', { userId, subscriptionCount });
  }

  recordRealtimeEmit(
    target: 'user' | 'room' | 'socket' | 'broadcast',
    eventType: 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing',
    eventCount: number,
    dispatchSource: 'local' | 'compat_dispatch' | 'fallback' = 'local',
  ): void {
    this.counters.realtimeEmitted += 1;
    this.counters.realtimeEmittedEvents += Math.max(0, Math.floor(eventCount));
    this.recordEvent('realtime_emitted', { target, eventType, eventCount, dispatchSource });
  }

  recordDeliveryRequested(
    target: 'user' | 'room' | 'socket' | 'broadcast',
    eventType: 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing',
  ): void {
    this.counters.deliveryRequested += 1;
    this.recordEvent('delivery_requested', { target, eventType, dispatchSource: 'local' });
  }

  recordDeliveryPublished(
    target: 'user' | 'room' | 'socket' | 'broadcast',
    eventType: 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing',
  ): void {
    this.counters.deliveryPublished += 1;
    this.recordEvent('delivery_published', { target, eventType, dispatchSource: 'local' });
  }

  recordDeliveryPublishFailed(
    target: 'user' | 'room' | 'socket' | 'broadcast',
    eventType: 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing',
  ): void {
    this.counters.deliveryPublishErrors += 1;
    this.recordEvent('delivery_publish_failed', { target, eventType, dispatchSource: 'fallback' });
  }

  recordCompatDispatchReceived(
    eventType: 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing',
    eventCount: number,
  ): void {
    this.counters.compatDispatchReceived += 1;
    this.recordEvent('compat_dispatch_received', {
      target: 'socket',
      eventType,
      eventCount,
      dispatchSource: 'compat_dispatch',
    });
  }

  recordCompatDispatchEmitted(
    eventType: 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing',
    eventCount: number,
  ): void {
    this.counters.compatDispatchEmitted += 1;
    this.recordEvent('compat_dispatch_emitted', {
      target: 'socket',
      eventType,
      eventCount,
      dispatchSource: 'compat_dispatch',
    });
  }

  recordCompatFallbackEmit(
    target: 'user' | 'room' | 'socket' | 'broadcast',
    eventType: 'message' | 'presence' | 'readReceipt' | 'groupUpdate' | 'typing',
  ): void {
    this.counters.compatFallbackEmitted += 1;
    this.recordEvent('compat_fallback_emitted', {
      target,
      eventType,
      eventCount: 1,
      dispatchSource: 'fallback',
    });
  }

  recordSyncWake(
    userId: string,
    wakeSource: 'event' | 'poll' | 'initial' | 'timeout',
    eventSource?: 'local' | 'pubsub',
  ): void {
    const key = `syncWake${wakeSource.charAt(0).toUpperCase()}${wakeSource.slice(1)}` as keyof typeof this.counters;
    if (typeof this.counters[key] === 'number') {
      this.counters[key] += 1;
    }
    this.recordEvent('sync_wake', { userId, wakeSource, eventSource });
  }

  snapshot(): RealtimeOpsSnapshot {
    return {
      counters: { ...this.counters },
      recentEvents: [...this.recentEvents],
      updatedAt: this.updatedAt,
    };
  }

  resetForTests(): void {
    for (const key of Object.keys(this.counters)) {
      this.counters[key] = 0;
    }
    this.recentEvents.length = 0;
    this.updatedAt = null;
  }

  private recordEvent(
    kind: RealtimeOpsEventKind,
    payload: Omit<RealtimeOpsEvent, 'id' | 'kind' | 'at'>,
  ): void {
    const event = {
      id: randomUUID(),
      kind,
      at: nowIso(),
      ...payload,
    } satisfies RealtimeOpsEvent;

    this.updatedAt = event.at;
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > RECENT_EVENTS_LIMIT) {
      this.recentEvents.length = RECENT_EVENTS_LIMIT;
    }
  }
}

export const realtimeOps = new RealtimeOps();
