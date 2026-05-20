import type { Message } from '../../../types/chat';
import type { ChatPatch, SocketMessageSendPayload } from '../../../core/chat/types';
import { authUtils } from '../../../services/apiClient';
import { buildGroupChatId, buildPrivateChatId } from '../../../utils/chat';

// ---------------------------------------------------------------------------
// Socket send fallback
// ---------------------------------------------------------------------------

const SOCKET_SEND_HTTP_FALLBACK_ERRORS = new Set([
  'SOCKET_DISABLED',
  'SOCKET_NOT_CONNECTED',
  'SOCKET_NOT_AVAILABLE',
  'ACK_TIMEOUT',
  'ACK_INVALID',
]);

export const shouldFallbackToHttpSend = (reason?: string): boolean => {
  if (!reason) return false;
  return SOCKET_SEND_HTTP_FALLBACK_ERRORS.has(String(reason).trim().toUpperCase());
};

// ---------------------------------------------------------------------------
// Chat ID resolution
// ---------------------------------------------------------------------------

export const resolveChatId = (targetId: string, isGroup: boolean): string | null => {
  if (isGroup) return buildGroupChatId(targetId);
  const me = authUtils.getCurrentUser()?.id;
  if (!me) return null;
  return buildPrivateChatId(me, targetId);
};

// ---------------------------------------------------------------------------
// Socket -> HTTP payload conversion
// ---------------------------------------------------------------------------

export const toHttpSendPayload = (payload: SocketMessageSendPayload) => ({
  clientTempId: payload.clientTempId,
  chatType: payload.chatType,
  receiverId: payload.receiverId,
  groupId: payload.groupId,
  content: payload.content,
  type: payload.type || 'text',
  fileUrl: payload.fileUrl,
  fileName: payload.fileName,
  fileSize: payload.fileSize,
  mimeType: payload.mimeType,
  thumbnailUrl: payload.thumbnailUrl,
});

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------

export const extractSentMessageRaw = (res: unknown): Record<string, unknown> | null => {
  if (!res || typeof res !== 'object') return null;
  const obj = res as Record<string, unknown>;
  if (obj.data && typeof obj.data === 'object') return obj.data as Record<string, unknown>;
  if (obj.message && typeof obj.message === 'object') return obj.message as Record<string, unknown>;
  return null;
};

// ---------------------------------------------------------------------------
// Message comparison (for sorted projection)
// ---------------------------------------------------------------------------

export const compareProjectionMessages = (a: Message, b: Message): number => {
  const aSeq = typeof a.seq === 'number' ? a.seq : Number.POSITIVE_INFINITY;
  const bSeq = typeof b.seq === 'number' ? b.seq : Number.POSITIVE_INFINITY;
  if (Number.isFinite(aSeq) && Number.isFinite(bSeq) && aSeq !== bSeq) {
    return aSeq - bSeq;
  }

  if (Number.isFinite(aSeq) !== Number.isFinite(bSeq)) {
    return Number.isFinite(aSeq) ? -1 : 1;
  }

  const aTs = Date.parse(a.timestamp || '');
  const bTs = Date.parse(b.timestamp || '');
  if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
    return aTs - bTs;
  }

  return a.id.localeCompare(b.id);
};

// ---------------------------------------------------------------------------
// Patch op estimation (for budget-aware draining)
// ---------------------------------------------------------------------------

export const estimatePatchOps = (patch: ChatPatch): number => {
  if (patch.kind === 'meta') {
    return (
      (patch.lastMessages?.length || 0) +
      (patch.unreadDeltas?.length || 0) +
      (patch.onlineUpdates?.length || 0) +
      (patch.aiMessages?.length || 0) +
      (patch.chatUpserts?.length || 0) +
      (patch.chatRemovals?.length || 0)
    );
  }
  if (patch.kind === 'reset' || patch.kind === 'append' || patch.kind === 'prepend') {
    return patch.messages.length;
  }
  if (patch.kind === 'update') return patch.updates.length;
  if (patch.kind === 'delete') return patch.ids.length;
  return 1;
};

// ---------------------------------------------------------------------------
// Optimistic message builder
// ---------------------------------------------------------------------------

export const buildOptimisticPendingMessage = (payload: SocketMessageSendPayload): Message | null => {
  const currentUser = authUtils.getCurrentUser();
  if (!currentUser?.id || !payload.clientTempId) {
    return null;
  }

  const targetId = payload.chatType === 'group' ? payload.groupId : payload.receiverId;
  if (!targetId) {
    return null;
  }

  const chatId = resolveChatId(targetId, payload.chatType === 'group');
  if (!chatId) {
    return null;
  }

  const username =
    String((currentUser as any).username || (currentUser as any).alias || (currentUser as any).nickname || '')
      .trim() || '我';

  return {
    id: payload.clientTempId,
    clientTempId: payload.clientTempId,
    chatId,
    chatType: payload.chatType,
    content: payload.content,
    senderId: currentUser.id,
    senderUsername: username,
    userId: currentUser.id,
    username,
    receiverId: payload.receiverId,
    groupId: payload.groupId,
    timestamp: new Date().toISOString(),
    type: payload.type || 'text',
    isGroupChat: payload.chatType === 'group',
    status: 'pending',
    attachments: payload.attachments,
    fileUrl: payload.fileUrl,
    fileName: payload.fileName,
    fileSize: payload.fileSize,
    mimeType: payload.mimeType,
    thumbnailUrl: payload.thumbnailUrl,
  };
};
