import { redis } from '../../config/redis';
import { updateService } from '../updateService';
import {
  buildRealtimeCapabilities,
  buildRealtimeRuntimeSemantics,
  buildRealtimeTransportCatalog,
  REALTIME_PROTOCOL_VERSION,
  SYNC_PROTOCOL_VERSION,
  SYNC_WATERMARK_FIELD,
  type RealtimeBootstrapPayload,
  type RealtimeHealthPayload,
  type RealtimeSessionSnapshot,
} from './contracts';
import { realtimeSessionRegistry } from './realtimeSessionRegistry';

interface SharedRedisSessionRecord {
  session_id?: string;
  sessionId?: string;
  user_id?: string | null;
  userId?: string | null;
  username?: string | null;
  authenticated?: boolean;
  rooms?: string[];
}

function sortUniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

// 当 Socket 终结在 Rust 边缘网关（或本机内存无连接）时，从共享 Redis 会话注册表聚合真实连接态，消除控制面脑裂
async function resolveEffectiveSessionSnapshot(
  userId: string,
  socketTerminator: string,
): Promise<RealtimeSessionSnapshot> {
  const localSession = realtimeSessionRegistry.getUserSnapshot(userId);
  if (socketTerminator !== 'rust' && localSession.online) {
    return localSession;
  }

  try {
    const [primarySids, compatSids] = await Promise.all([
      redis.smembers(`rt:user_sessions:${userId}`),
      redis.smembers(`rt:user:${userId}`),
    ]);
    const candidateSids = sortUniqueStrings([
      ...(Array.isArray(primarySids) ? primarySids : []),
      ...(Array.isArray(compatSids) ? compatSids : []),
    ]).filter(Boolean);

    if (candidateSids.length === 0) {
      return localSession;
    }

    const rawRecords = await redis.mget(...candidateSids.map((sid) => `rt:session:${sid}`));
    const socketIds = new Set<string>(localSession.socketIds);
    const rooms = new Set<string>(localSession.rooms);
    let authenticatedCount = localSession.authenticatedSockets;
    let username: string | null = localSession.username;
    const localSocketSet = new Set<string>(localSession.socketIds);

    rawRecords.forEach((raw, idx) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as SharedRedisSessionRecord;
        const sid = String(parsed.session_id || parsed.sessionId || candidateSids[idx] || '').trim();
        if (!sid) return;
        const ownerId = parsed.user_id ?? parsed.userId;
        if (ownerId && ownerId !== userId) return;

        const isNewSocket = !localSocketSet.has(sid);
        socketIds.add(sid);
        if (isNewSocket && parsed.authenticated !== false) {
          authenticatedCount += 1;
        }
        if (!username && typeof parsed.username === 'string' && parsed.username.trim()) {
          username = parsed.username.trim();
        }
        if (Array.isArray(parsed.rooms)) {
          for (const room of parsed.rooms) {
            if (typeof room === 'string' && room.trim()) {
              rooms.add(room.trim());
            }
          }
        }
      } catch {
        // 忽略损坏的单条会话 JSON
      }
    });

    const connectedSockets = socketIds.size;
    if (connectedSockets === 0) {
      return localSession;
    }

    const finalAuthenticated = Math.min(connectedSockets, authenticatedCount);
    return {
      userId,
      username,
      online: finalAuthenticated > 0,
      connectedSockets,
      authenticatedSockets: finalAuthenticated,
      roomSubscriptions: rooms.size,
      socketIds: sortUniqueStrings(socketIds),
      rooms: sortUniqueStrings(rooms),
    };
  } catch {
    return localSession;
  }
}

export async function buildRealtimeHealthPayload(): Promise<RealtimeHealthPayload> {
  return {
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    transport: buildRealtimeTransportCatalog(),
    runtime: buildRealtimeRuntimeSemantics(),
    capabilities: buildRealtimeCapabilities(),
  };
}

export async function buildRealtimeBootstrapPayload(userId: string): Promise<RealtimeBootstrapPayload> {
  const health = await buildRealtimeHealthPayload();
  const [serverPts, ackPts, session] = await Promise.all([
    updateService.getUpdateId(userId),
    updateService.getAckPts(userId),
    resolveEffectiveSessionSnapshot(userId, health.runtime.socketTerminator),
  ]);

  return {
    ...health,
    sync: {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      watermarkField: SYNC_WATERMARK_FIELD,
      serverPts,
      ackPts,
      lagPts: Math.max(0, serverPts - ackPts),
    },
    session,
  };
}
