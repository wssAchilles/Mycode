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
  | 'sync_wake';

interface RealtimeOpsEvent {
  id: string;
  kind: RealtimeOpsEventKind;
  at: string;
  userId?: string;
  socketId?: string;
  roomId?: string;
  target?: 'user' | 'room' | 'socket' | 'broadcast';
  eventType?: 'message' | 'presence' | 'readReceipt' | 'groupUpdate';
  eventCount?: number;
  wakeSource?: 'event' | 'poll' | 'initial' | 'timeout';
  eventSource?: 'local' | 'pubsub';
  subscriptionCount?: number;
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
    eventType: 'message' | 'presence' | 'readReceipt' | 'groupUpdate',
    eventCount: number,
  ): void {
    this.counters.realtimeEmitted += 1;
    this.counters.realtimeEmittedEvents += Math.max(0, Math.floor(eventCount));
    this.recordEvent('realtime_emitted', { target, eventType, eventCount });
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
