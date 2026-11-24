/**
 * Worker 多领域实时/同步事件处理辅助模块
 * 职责：归一化并分发联系人变更、消息编辑/撤回、社交通知与多端已读状态事件
 */

import type { Message } from '../../../types/chat';
import type { ChatCoreStore } from '../../chat/store/chatCoreStore';
import type { ChatPatch, LoadSeq } from '../../chat/types';
import type { WorkerMessageSearchService } from '../../chat/search/messageSearchIndex';
import type { SearchBridge } from './searchBridge';
import type {
  ContactRealtimeAction,
  ContactRealtimePayload,
  MessageMutationRealtimePayload,
  SocialNotificationAction,
  SocialNotificationRealtimePayload,
  SyncStateRealtimePayload,
} from '../../../features/realtime/contracts';

const VALID_CONTACT_ACTIONS = new Set<ContactRealtimeAction>([
  'request_received',
  'request_sent',
  'request_accepted',
  'request_rejected',
  'contact_removed',
  'contact_blocked',
  'alias_updated',
]);

const VALID_SOCIAL_ACTIONS = new Set<SocialNotificationAction>([
  'like',
  'comment',
  'repost',
  'follow',
]);

export interface DomainEventWorkerContext {
  getCurrentUserId: () => string | null;
  store: ChatCoreStore;
  searchService: WorkerMessageSearchService;
  searchBridge: SearchBridge;
  withApiBase: (url?: string | null) => string | undefined;
  chatListIdFromChatId: (chatId: string, isGroup: boolean) => string | null;
  saveMessages: (messages: Message[]) => Promise<void>;
  deleteMessages: (ids: string[]) => Promise<void>;
  emitPatch: (patch: ChatPatch) => void;
  emitDelete: (chatId: string, loadSeq: LoadSeq, ids: string[]) => void;
  queueLastMessageMeta: (listId: string, message: Message) => void;
  queueContactEventMeta: (event: ContactRealtimePayload) => void;
  queueSocialNotificationMeta: (event: SocialNotificationRealtimePayload) => void;
  queueSelfReadSyncMeta: (event: SyncStateRealtimePayload) => void;
}

/**
 * 归一化联系人实时事件载荷并补全头像基础地址
 */
export function normalizeContactRealtimePayload(
  raw: unknown,
  withApiBase: (url?: string | null) => string | undefined,
): ContactRealtimePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const action = typeof record.action === 'string' ? (record.action as ContactRealtimeAction) : null;
  if (!action || !VALID_CONTACT_ACTIONS.has(action)) return null;

  const eventId =
    typeof record.eventId === 'string' && record.eventId.trim()
      ? record.eventId.trim()
      : `${action}:${String(record.requestId || record.contactId || record.userId || Date.now())}`;
  const emittedAt =
    typeof record.emittedAt === 'string' && record.emittedAt
      ? record.emittedAt
      : new Date().toISOString();

  const normalizeAvatar = (avatarUrl: unknown): string | null | undefined => {
    if (typeof avatarUrl !== 'string') return avatarUrl === null ? null : undefined;
    return withApiBase(avatarUrl) ?? avatarUrl;
  };

  const payload: ContactRealtimePayload = {
    eventId,
    emittedAt,
    action,
    actorId: typeof record.actorId === 'string' ? record.actorId : '',
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    userId: typeof record.userId === 'string' ? record.userId : undefined,
    contactId: typeof record.contactId === 'string' ? record.contactId : undefined,
    alias: typeof record.alias === 'string' || record.alias === null ? record.alias : undefined,
  };

  if (record.request && typeof record.request === 'object') {
    const req = record.request as ContactRealtimePayload['request'];
    if (req?.id && req?.userId) {
      payload.request = {
        ...req,
        id: String(req.id),
        userId: String(req.userId),
        username: String(req.username || '未知用户'),
        avatarUrl: normalizeAvatar(req.avatarUrl),
      };
    }
  }

  if (record.sentRequest && typeof record.sentRequest === 'object') {
    const sent = record.sentRequest as ContactRealtimePayload['sentRequest'];
    if (sent?.id && sent?.contactId) {
      payload.sentRequest = {
        ...sent,
        id: String(sent.id),
        contactId: String(sent.contactId),
        username: String(sent.username || '未知用户'),
        avatarUrl: normalizeAvatar(sent.avatarUrl),
      };
    }
  }

  if (record.contact && typeof record.contact === 'object') {
    const contact = record.contact as ContactRealtimePayload['contact'];
    if (contact?.id && contact?.userId) {
      payload.contact = {
        ...contact,
        id: String(contact.id),
        userId: String(contact.userId),
        contactId: String(contact.contactId || contact.userId),
        username: String(contact.username || '未知用户'),
        avatarUrl: normalizeAvatar(contact.avatarUrl),
      };
    }
  }

  return payload;
}

/**
 * 归一化社交通知实时事件载荷
 */
export function normalizeSocialNotificationPayload(
  raw: unknown,
  withApiBase: (url?: string | null) => string | undefined,
): SocialNotificationRealtimePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const action = typeof record.action === 'string' ? (record.action as SocialNotificationAction) : null;
  if (!action || !VALID_SOCIAL_ACTIONS.has(action)) return null;

  const actorRaw = record.actor as Record<string, unknown> | undefined;
  const actorId = typeof actorRaw?.id === 'string' ? actorRaw.id : '';
  const recipientId = typeof record.recipientId === 'string' ? record.recipientId : '';
  if (!actorId || !recipientId) return null;

  const rawAvatar = typeof actorRaw?.avatarUrl === 'string' ? actorRaw.avatarUrl : undefined;
  return {
    eventId:
      typeof record.eventId === 'string' && record.eventId.trim()
        ? record.eventId.trim()
        : `${action}:${actorId}:${String(record.postId || record.commentId || Date.now())}`,
    emittedAt:
      typeof record.emittedAt === 'string' && record.emittedAt
        ? record.emittedAt
        : new Date().toISOString(),
    action,
    recipientId,
    actor: {
      id: actorId,
      username: typeof actorRaw?.username === 'string' && actorRaw.username ? actorRaw.username : '未知用户',
      avatarUrl: rawAvatar ? (withApiBase(rawAvatar) ?? rawAvatar) : null,
    },
    postId: typeof record.postId === 'string' ? record.postId : undefined,
    commentId: typeof record.commentId === 'string' ? record.commentId : undefined,
    previewText: typeof record.previewText === 'string' ? record.previewText : undefined,
  };
}

/**
 * 归一化并处理消息编辑/撤回变更事件（同步更新 Worker 内存、搜索索引、本地持久化与主线程视图）
 */
export function processMessageMutationPayload(
  raw: unknown,
  ctx: DomainEventWorkerContext,
): void {
  if (!raw || typeof raw !== 'object') return;
  const record = raw as Partial<MessageMutationRealtimePayload>;
  const action = record.action;
  const chatId = typeof record.chatId === 'string' ? record.chatId.trim() : '';
  const messageId = typeof record.messageId === 'string' ? record.messageId.trim() : '';
  if (!chatId || !messageId) return;
  if (action !== 'edited' && action !== 'deleted') return;

  const isGroup = record.chatType === 'group' || chatId.startsWith('g:');
  const listId = ctx.chatListIdFromChatId(chatId, isGroup);

  if (action === 'edited') {
    const nextContent = typeof record.content === 'string' ? record.content : '';
    const editedAt =
      typeof record.editedAt === 'string' && record.editedAt
        ? record.editedAt
        : typeof record.emittedAt === 'string' && record.emittedAt
          ? record.emittedAt
          : new Date().toISOString();

    const updated = ctx.store.updateMessageContent(chatId, messageId, nextContent, editedAt);
    if (updated) {
      ctx.searchService.upsert(chatId, [updated]);
      ctx.searchBridge.invalidateSearchHaystacks(chatId, [messageId]);
      ctx.searchBridge.clearRemoteSearchCacheForChat(chatId);
      ctx.saveMessages([updated]).catch(() => undefined);

      // 若被编辑的是最新一条消息，同步刷新侧边栏摘要预览
      const chatState = ctx.store.getChat(chatId);
      const last = chatState?.messages.length ? chatState.messages[chatState.messages.length - 1] : null;
      if (listId && last && last.id === messageId) {
        ctx.queueLastMessageMeta(listId, last);
      }
    }

    if (ctx.store.activeChatId === chatId) {
      ctx.emitPatch({
        kind: 'update',
        chatId,
        loadSeq: ctx.store.activeLoadSeq,
        updates: [
          {
            id: messageId,
            content: nextContent,
            editedAt,
          },
        ],
      });
    }
    return;
  }

  // 消息撤回/删除路径
  const { removed, nextLastMessage } = ctx.store.removeMessage(chatId, messageId);
  ctx.searchService.remove(chatId, [messageId]);
  ctx.searchBridge.invalidateSearchHaystacks(chatId, [messageId]);
  ctx.searchBridge.clearRemoteSearchCacheForChat(chatId);
  ctx.deleteMessages([messageId]).catch(() => undefined);

  if (listId) {
    if (nextLastMessage) {
      ctx.queueLastMessageMeta(listId, nextLastMessage);
    } else if (removed) {
      // 当会话本地缓存被删空时刷新摘要为占位文本，避免侧边栏滞留已撤回内容
      ctx.queueLastMessageMeta(listId, {
        id: `deleted-placeholder:${messageId}`,
        chatId,
        chatType: isGroup ? 'group' : 'private',
        seq: typeof record.seq === 'number' ? record.seq : undefined,
        content: '消息已撤回',
        senderId: record.actorId || ctx.getCurrentUserId() || 'system',
        senderUsername: '',
        userId: record.actorId || ctx.getCurrentUserId() || 'system',
        username: '',
        groupId: isGroup ? listId : undefined,
        timestamp: typeof record.emittedAt === 'string' ? record.emittedAt : new Date().toISOString(),
        type: 'system',
        isGroupChat: isGroup,
      });
    }
  }

  if (ctx.store.activeChatId === chatId) {
    ctx.emitDelete(chatId, ctx.store.activeLoadSeq, [messageId]);
  }
}

/**
 * 分发来自 realtimeBatch 或离线 UpdateLog 的联系人事件
 */
export function processContactRealtimePayload(
  raw: unknown,
  ctx: DomainEventWorkerContext,
): void {
  const normalized = normalizeContactRealtimePayload(raw, ctx.withApiBase);
  if (!normalized) return;
  ctx.queueContactEventMeta(normalized);
}

/**
 * 分发来自 realtimeBatch 或离线 UpdateLog 的社交通知事件
 */
export function processSocialNotificationPayload(
  raw: unknown,
  ctx: DomainEventWorkerContext,
): void {
  const normalized = normalizeSocialNotificationPayload(raw, ctx.withApiBase);
  if (!normalized) return;
  ctx.queueSocialNotificationMeta(normalized);
}

/**
 * 分发多端状态同步事件（如其余标签页推进会话已读）
 */
export function processSyncStatePayload(
  raw: unknown,
  ctx: DomainEventWorkerContext,
): void {
  if (!raw || typeof raw !== 'object') return;
  const record = raw as Partial<SyncStateRealtimePayload>;
  if (record.action !== 'chat_read') return;
  const chatId = typeof record.chatId === 'string' ? record.chatId.trim() : '';
  const userId = typeof record.userId === 'string' ? record.userId.trim() : '';
  const seq = typeof record.seq === 'number' && Number.isFinite(record.seq) ? Math.floor(record.seq) : 0;
  if (!chatId || !userId || seq <= 0) return;

  ctx.queueSelfReadSyncMeta({
    eventId: typeof record.eventId === 'string' && record.eventId ? record.eventId : `chat_read:${chatId}:${seq}`,
    emittedAt: typeof record.emittedAt === 'string' && record.emittedAt ? record.emittedAt : new Date().toISOString(),
    action: 'chat_read',
    userId,
    chatId,
    seq,
  });
}
