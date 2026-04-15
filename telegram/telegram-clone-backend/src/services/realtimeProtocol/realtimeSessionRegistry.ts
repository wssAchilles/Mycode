import { randomUUID } from 'node:crypto';

import type { RealtimeSessionSnapshot } from './contracts';

const RECENT_EVENTS_LIMIT = 100;

type SessionEventKind =
  | 'socket_connected'
  | 'socket_authenticated'
  | 'socket_disconnected'
  | 'room_joined'
  | 'room_left';

interface SocketSessionRecord {
  socketId: string;
  userId: string | null;
  username: string | null;
  authenticated: boolean;
  rooms: Set<string>;
  connectedAt: string;
  updatedAt: string;
}

interface RealtimeSessionEvent {
  id: string;
  kind: SessionEventKind;
  at: string;
  socketId: string;
  userId?: string;
  username?: string | null;
  roomId?: string;
}

interface RealtimeRegistrySnapshot {
  totals: {
    connectedSockets: number;
    authenticatedSockets: number;
    onlineUsers: number;
    roomSubscriptions: number;
  };
  users: RealtimeSessionSnapshot[];
  recentEvents: RealtimeSessionEvent[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export class RealtimeSessionRegistry {
  private readonly sessions = new Map<string, SocketSessionRecord>();
  private readonly recentEvents: RealtimeSessionEvent[] = [];

  registerSocketConnection(socketId: string): void {
    if (!socketId) return;
    const timestamp = nowIso();
    this.sessions.set(socketId, {
      socketId,
      userId: null,
      username: null,
      authenticated: false,
      rooms: new Set<string>(),
      connectedAt: timestamp,
      updatedAt: timestamp,
    });
    this.recordEvent('socket_connected', { socketId });
  }

  markSocketAuthenticated(params: {
    socketId: string;
    userId: string;
    username?: string | null;
    rooms?: string[];
  }): void {
    const session = this.ensureSession(params.socketId);
    session.userId = params.userId;
    session.username = params.username ?? null;
    session.authenticated = true;
    session.updatedAt = nowIso();
    if (Array.isArray(params.rooms)) {
      session.rooms = new Set(params.rooms.filter(Boolean));
    }
    this.recordEvent('socket_authenticated', {
      socketId: params.socketId,
      userId: params.userId,
      username: session.username,
    });
  }

  addRoomSubscription(socketId: string, roomId: string): void {
    if (!socketId || !roomId) return;
    const session = this.ensureSession(socketId);
    if (session.rooms.has(roomId)) return;
    session.rooms.add(roomId);
    session.updatedAt = nowIso();
    this.recordEvent('room_joined', {
      socketId,
      userId: session.userId || undefined,
      username: session.username,
      roomId,
    });
  }

  removeRoomSubscription(socketId: string, roomId: string): void {
    if (!socketId || !roomId) return;
    const session = this.sessions.get(socketId);
    if (!session) return;
    if (!session.rooms.delete(roomId)) return;
    session.updatedAt = nowIso();
    this.recordEvent('room_left', {
      socketId,
      userId: session.userId || undefined,
      username: session.username,
      roomId,
    });
  }

  removeSocket(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;
    this.sessions.delete(socketId);
    this.recordEvent('socket_disconnected', {
      socketId,
      userId: session.userId || undefined,
      username: session.username,
    });
  }

  getUserSnapshot(userId: string): RealtimeSessionSnapshot {
    const sessions = this.collectUserSessions(userId);
    const socketIds = sessions.map((session) => session.socketId);
    const rooms = new Set<string>();
    let username: string | null = null;

    for (const session of sessions) {
      if (!username && session.username) {
        username = session.username;
      }
      for (const room of session.rooms.values()) {
        rooms.add(room);
      }
    }

    return {
      userId,
      username,
      online: sessions.length > 0,
      connectedSockets: sessions.length,
      authenticatedSockets: sessions.filter((session) => session.authenticated).length,
      roomSubscriptions: rooms.size,
      socketIds: sortStrings(socketIds),
      rooms: sortStrings(rooms),
    };
  }

  snapshot(): RealtimeRegistrySnapshot {
    const users = this.collectUserIds().map((userId) => this.getUserSnapshot(userId));
    const totals = users.reduce(
      (acc, user) => {
        acc.onlineUsers += 1;
        acc.connectedSockets += user.connectedSockets;
        acc.authenticatedSockets += user.authenticatedSockets;
        acc.roomSubscriptions += user.roomSubscriptions;
        return acc;
      },
      {
        connectedSockets: 0,
        authenticatedSockets: 0,
        onlineUsers: 0,
        roomSubscriptions: 0,
      },
    );

    return {
      totals,
      users,
      recentEvents: [...this.recentEvents],
    };
  }

  resetForTests(): void {
    this.sessions.clear();
    this.recentEvents.length = 0;
  }

  private collectUserIds(): string[] {
    const userIds = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.userId) {
        userIds.add(session.userId);
      }
    }
    return sortStrings(userIds);
  }

  private collectUserSessions(userId: string): SocketSessionRecord[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.userId === userId)
      .sort((a, b) => a.socketId.localeCompare(b.socketId));
  }

  private ensureSession(socketId: string): SocketSessionRecord {
    const existing = this.sessions.get(socketId);
    if (existing) {
      return existing;
    }

    const timestamp = nowIso();
    const session: SocketSessionRecord = {
      socketId,
      userId: null,
      username: null,
      authenticated: false,
      rooms: new Set<string>(),
      connectedAt: timestamp,
      updatedAt: timestamp,
    };
    this.sessions.set(socketId, session);
    return session;
  }

  private recordEvent(
    kind: SessionEventKind,
    payload: Omit<RealtimeSessionEvent, 'id' | 'kind' | 'at'>,
  ): void {
    this.recentEvents.unshift({
      id: randomUUID(),
      kind,
      at: nowIso(),
      ...payload,
    });
    if (this.recentEvents.length > RECENT_EVENTS_LIMIT) {
      this.recentEvents.length = RECENT_EVENTS_LIMIT;
    }
  }
}

export const realtimeSessionRegistry = new RealtimeSessionRegistry();
