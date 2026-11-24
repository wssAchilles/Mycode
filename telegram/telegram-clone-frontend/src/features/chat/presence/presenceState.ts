import type { ChatSyncPhase } from '../../../core/chat/types';

export type SelfPresenceStatus = 'online' | 'connecting' | 'offline';

export interface SelfPresenceView {
  status: SelfPresenceStatus;
  label: string;
  isOnline: boolean;
}

export type PresenceSource = 'realtime' | 'snapshot';

export interface PresenceRecord {
  isOnline: boolean;
  lastSeen?: string;
  updatedAt: number;
  source: PresenceSource;
}

export interface DeriveSelfPresenceParams {
  hasUser: boolean;
  isBrowserOnline: boolean;
  socketConnected: boolean;
  syncPhase: ChatSyncPhase | string;
}

/**
 * 综合用户会话、浏览器网络、Socket 连接与同步阶段推导当前用户的真实在线展示状态。
 */
export function deriveSelfPresence({
  hasUser,
  isBrowserOnline,
  socketConnected,
  syncPhase,
}: DeriveSelfPresenceParams): SelfPresenceView {
  if (!hasUser || !isBrowserOnline) {
    return {
      status: 'offline',
      label: '离线',
      isOnline: false,
    };
  }

  if (socketConnected && syncPhase === 'live') {
    return {
      status: 'online',
      label: '在线',
      isOnline: true,
    };
  }

  if (syncPhase === 'auth_error') {
    return {
      status: 'connecting',
      label: '重连中...',
      isOnline: false,
    };
  }

  return {
    status: 'connecting',
    label: '连接中...',
    isOnline: false,
  };
}

export interface IncomingPresenceSample {
  isOnline: boolean;
  lastSeen?: string;
  source: PresenceSource;
}

/**
 * 合并实时 Socket 推送与 HTTP 列表快照，避免滞后的列表刷新覆盖刚刚收到的实时在线态。
 */
export function resolveMergedPresence(
  existing: PresenceRecord | undefined,
  incoming: IncomingPresenceSample,
  nowMs = Date.now(),
  realtimeGraceMs = 8_000,
): PresenceRecord {
  if (incoming.source === 'realtime') {
    return {
      isOnline: !!incoming.isOnline,
      lastSeen: incoming.lastSeen ?? existing?.lastSeen,
      updatedAt: nowMs,
      source: 'realtime',
    };
  }

  // 在保护窗口内优先保留实时 Socket 推送的在线状态，防止 HTTP 快照回滚
  if (existing?.source === 'realtime' && nowMs - existing.updatedAt < realtimeGraceMs) {
    return existing;
  }

  return {
    isOnline: !!incoming.isOnline,
    lastSeen: incoming.lastSeen ?? existing?.lastSeen,
    updatedAt: nowMs,
    source: 'snapshot',
  };
}

export interface CollectPresenceTargetUserIdsParams {
  contacts?: ReadonlyArray<{ userId?: string | null }>;
  chats?: ReadonlyArray<{ id?: string | null; isGroup?: boolean }>;
  selectedContact?: { userId?: string | null } | null;
  selectedGroup?: {
    members?: ReadonlyArray<{ userId?: string | null }> | null;
  } | null;
  currentUserId?: string | null;
}

/**
 * 汇总需要订阅在线状态的全部目标用户 ID（联系人、私聊会话及当前打开群组的成员），并去重过滤自身与 AI。
 */
export function collectPresenceTargetUserIds({
  contacts = [],
  chats = [],
  selectedContact,
  selectedGroup,
  currentUserId,
}: CollectPresenceTargetUserIdsParams): string[] {
  const selfId = typeof currentUserId === 'string' ? currentUserId.trim() : '';
  const targetIds = new Set<string>();

  const addCandidate = (rawId?: string | null) => {
    const clean = typeof rawId === 'string' ? rawId.trim() : '';
    if (!clean || clean === 'ai' || (selfId && clean === selfId)) {
      return;
    }
    targetIds.add(clean);
  };

  for (const contact of contacts) {
    addCandidate(contact?.userId);
  }

  for (const chat of chats) {
    if (!chat?.isGroup) {
      addCandidate(chat?.id);
    }
  }

  addCandidate(selectedContact?.userId);

  if (Array.isArray(selectedGroup?.members)) {
    for (const member of selectedGroup.members) {
      addCandidate(member?.userId);
    }
  }

  return Array.from(targetIds).sort();
}
