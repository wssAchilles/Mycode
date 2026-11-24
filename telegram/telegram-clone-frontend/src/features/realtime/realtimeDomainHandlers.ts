/**
 * 全域实时领域事件主线程投影处理器
 * 负责将 Worker 派发的联系人、多端已读、群刷新与社交通知批事件安全投影到各 Zustand Store 与界面总线
 */

import { showToast } from '../../components/ui/Toast';
import { authUtils } from '../../services/apiClient';
import { useSpaceStore } from '../../stores/useSpaceStore';
import { useChatStore } from '../chat/store/chatStore';
import {
  APP_CONTACT_REALTIME_EVENT,
  APP_SOCIAL_NOTIFICATION_EVENT,
  type ContactRealtimePayload,
  type SocialNotificationRealtimePayload,
  type SyncStateRealtimePayload,
} from './contracts';

export interface RealtimeDomainMetaPayload {
  contactEvents?: ContactRealtimePayload[];
  selfReadSyncs?: SyncStateRealtimePayload[];
  socialNotifications?: SocialNotificationRealtimePayload[];
  groupRefreshIds?: string[];
}

/**
 * 将标准化 chatId（p:a:b 或 g:groupId）还原为侧边栏列表使用的 listId
 */
export function resolveChatListIdForSync(chatId: string, currentUserId?: string | null): string | null {
  const clean = String(chatId || '').trim();
  if (!clean) return null;
  if (clean.startsWith('g:')) {
    return clean.slice(2) || null;
  }
  if (clean.startsWith('p:')) {
    const parts = clean.slice(2).split(':').filter(Boolean);
    if (parts.length !== 2) return null;
    if (currentUserId) {
      const other = parts.find((id) => id !== currentUserId);
      return other || null;
    }
    return parts[0] || null;
  }
  return clean;
}

/**
 * 多标签页/多端同步：收到本账号其他端推进会话已读水位时，立即将本地红点清零
 */
export function applySelfReadSyncEvents(
  syncs: SyncStateRealtimePayload[] | undefined,
  currentUserId?: string | null,
): void {
  if (!Array.isArray(syncs) || syncs.length === 0) return;

  const store = useChatStore.getState();
  const seenListIds = new Set<string>();

  for (const sync of syncs) {
    if (!sync || sync.action !== 'chat_read') continue;
    const listId = resolveChatListIdForSync(sync.chatId, currentUserId ?? sync.userId);
    if (!listId || seenListIds.has(listId)) continue;
    seenListIds.add(listId);

    const hasUnreadChat = store.chats.some((c) => c.id === listId && (c.unreadCount || 0) > 0);
    const hasUnreadContact = store.contacts.some((c) => c.userId === listId && (c.unreadCount || 0) > 0);
    if (hasUnreadChat || hasUnreadContact) {
      store.resetUnread(listId);
    }
  }
}

function dispatchBrowserEvent<T>(name: string, detail: T): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<T>(name, { detail }));
  } catch {
    // 忽略测试/非 DOM 环境中的异常
  }
}

function formatSocialNotificationToast(notification: SocialNotificationRealtimePayload): string {
  const actor = notification.actor?.username || '有人';
  switch (notification.action) {
    case 'like':
      return `${actor} 赞了你的动态`;
    case 'comment':
      return `${actor} 评论了你的动态`;
    case 'repost':
      return `${actor} 转发了你的动态`;
    case 'follow':
      return `${actor} 关注了你`;
    default:
      return `${actor} 与你产生了新互动`;
  }
}

/**
 * 在主线程统一消费 meta patch 中的多领域增量事件
 */
export function applyRealtimeDomainMeta(meta: RealtimeDomainMetaPayload): void {
  const currentUserId = authUtils.getCurrentUser()?.id || null;
  const chatStore = useChatStore.getState();

  if (Array.isArray(meta.contactEvents) && meta.contactEvents.length > 0) {
    for (const event of meta.contactEvents) {
      if (!event?.action) continue;
      switch (event.action) {
        case 'request_received':
          chatStore.applyContactRequestReceived(event);
          break;
        case 'request_accepted':
          chatStore.applyContactRequestAccepted(event);
          break;
        case 'request_rejected':
          chatStore.applyContactRequestRejected(event);
          break;
        case 'contact_removed':
        case 'contact_blocked':
          chatStore.applyContactRemoved(event, currentUserId);
          break;
        case 'alias_updated':
          chatStore.applyContactAliasUpdated(event);
          break;
        case 'request_sent':
        default:
          break;
      }
      dispatchBrowserEvent(APP_CONTACT_REALTIME_EVENT, event);
    }
  }

  if (Array.isArray(meta.selfReadSyncs) && meta.selfReadSyncs.length > 0) {
    applySelfReadSyncEvents(meta.selfReadSyncs, currentUserId);
  }

  if (Array.isArray(meta.groupRefreshIds) && meta.groupRefreshIds.length > 0) {
    const selectedGroupId = chatStore.selectedGroup?.id;
    if (selectedGroupId && meta.groupRefreshIds.includes(selectedGroupId)) {
      void chatStore.loadGroupDetails(selectedGroupId);
    }
  }

  if (Array.isArray(meta.socialNotifications) && meta.socialNotifications.length > 0) {
    const spaceStore = useSpaceStore.getState();
    for (const notification of meta.socialNotifications) {
      if (!notification?.action) continue;
      spaceStore.receiveRealtimeNotification(notification);
      dispatchBrowserEvent(APP_SOCIAL_NOTIFICATION_EVENT, notification);
      if (typeof window !== 'undefined') {
        showToast(formatSocialNotificationToast(notification), 'info');
      }
    }
  }
}
