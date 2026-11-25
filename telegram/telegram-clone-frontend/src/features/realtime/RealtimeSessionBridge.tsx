/**
 * 根级常驻实时会话桥接组件
 * 负责在全应用路由切换（聊天、Space、个人设置等）期间保持唯一 WebSocket 实时链路在线，
 * 同时承担跨端未读总数与浏览器标题同步、背景新消息桌面通知与提示音触发。
 */

import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authUtils } from '../../services/apiClient';
import {
  AUTH_SESSION_CLEARED_EVENT,
  AUTH_TOKENS_UPDATED_EVENT,
} from '../../utils/authStorage';
import { useMessageStore } from '../chat/store/messageStore';
import { useChatStore } from '../chat/store/chatStore';
import { useChatUiPrefsStore } from '../chat/state/chatUiPrefsStore';
import { useSpaceStore } from '../../stores';
import { notifyIncomingMessage, syncDocumentTitle } from './browserNotifier';

export const RealtimeSessionBridge: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const connectedUserIdRef = useRef<string | null>(null);
  const preloadedUserIdRef = useRef<string | null>(null);
  const prevUnreadByChatRef = useRef<Map<string, number>>(new Map());
  const unreadSeededRef = useRef(false);

  const chats = useChatStore((state) => state.chats);
  const selectedChatId = useChatStore((state) => state.selectedChatId);
  const pendingRequestsCount = useChatStore((state) => state.pendingRequests.length);
  const spaceUnreadCount = useSpaceStore((state) => state.unreadNotificationsCount);
  const mutedChatIds = useChatUiPrefsStore((state) => state.mutedChatIds);
  const desktopNotifyEnabled = useChatUiPrefsStore((state) => state.desktopNotifyEnabled);
  const soundNotifyEnabled = useChatUiPrefsStore((state) => state.soundNotifyEnabled);

  useEffect(() => {
    const syncRealtimeSession = () => {
      const authenticated = authUtils.isAuthenticated();
      const userId = authUtils.getCurrentUser()?.id || null;

      if (!authenticated || !userId) {
        if (connectedUserIdRef.current !== null) {
          connectedUserIdRef.current = null;
          preloadedUserIdRef.current = null;
          prevUnreadByChatRef.current.clear();
          unreadSeededRef.current = false;
          useMessageStore.getState().disconnectRealtime();
          syncDocumentTitle(0);
        }
        return;
      }

      useChatUiPrefsStore.getState().hydrateForUser(userId);

      if (connectedUserIdRef.current && connectedUserIdRef.current !== userId) {
        connectedUserIdRef.current = userId;
        preloadedUserIdRef.current = null;
        prevUnreadByChatRef.current.clear();
        unreadSeededRef.current = false;
        useMessageStore.getState().disconnectRealtime();
        useMessageStore.getState().connectRealtime();
      } else if (!connectedUserIdRef.current) {
        connectedUserIdRef.current = userId;
        useMessageStore.getState().connectRealtime();
      }

      // 登录后若停留在非 /chat 页面且本地列表为空，静默预热会话列表与好友申请以便展示全局未读角标
      if (preloadedUserIdRef.current !== userId) {
        preloadedUserIdRef.current = userId;
        const chatState = useChatStore.getState();
        if (chatState.chats.length === 0) {
          void chatState.loadChats().catch(() => undefined);
        }
        if (chatState.pendingRequests.length === 0) {
          void chatState.loadPendingRequests().catch(() => undefined);
        }
      }
    };

    syncRealtimeSession();

    const handleSessionCleared = () => {
      syncRealtimeSession();
    };

    const handleTokensUpdated = () => {
      syncRealtimeSession();
    };

    const handleStorage = () => {
      syncRealtimeSession();
    };

    const handleVisibilityOrOnline = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!authUtils.isAuthenticated()) return;
      const msgState = useMessageStore.getState();
      if (!msgState.socketConnected && msgState.syncPhase !== 'auth_error') {
        msgState.connectRealtime();
      }
    };

    window.addEventListener(AUTH_TOKENS_UPDATED_EVENT, handleTokensUpdated);
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, handleSessionCleared);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('online', handleVisibilityOrOnline);
    document.addEventListener('visibilitychange', handleVisibilityOrOnline);

    return () => {
      window.removeEventListener(AUTH_TOKENS_UPDATED_EVENT, handleTokensUpdated);
      window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, handleSessionCleared);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('online', handleVisibilityOrOnline);
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
    };
  }, [location.pathname]);

  // 同步全局未读总数到浏览器标题，并在满足免打扰与场景条件时推送通知/提示音
  useEffect(() => {
    if (!authUtils.isAuthenticated()) {
      syncDocumentTitle(0);
      return;
    }

    const mutedSet = new Set(mutedChatIds);
    let activeChatUnread = 0;
    for (const chat of chats) {
      if (!mutedSet.has(chat.id)) {
        activeChatUnread += chat.unreadCount || 0;
      }
    }
    syncDocumentTitle(activeChatUnread + pendingRequestsCount + spaceUnreadCount);

    const prevMap = prevUnreadByChatRef.current;
    if (!unreadSeededRef.current) {
      for (const chat of chats) {
        prevMap.set(chat.id, chat.unreadCount || 0);
      }
      if (chats.length > 0) {
        unreadSeededRef.current = true;
      }
      return;
    }

    const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const onChatRoute = location.pathname === '/chat';

    for (const chat of chats) {
      const nextUnread = chat.unreadCount || 0;
      const prevUnread = prevMap.get(chat.id) ?? 0;
      prevMap.set(chat.id, nextUnread);

      if (nextUnread <= prevUnread) continue;
      if (mutedSet.has(chat.id)) continue;

      const isActiveVisibleChat = onChatRoute && !isHidden && selectedChatId === chat.id;
      if (isActiveVisibleChat) continue;

      notifyIncomingMessage({
        chatId: chat.id,
        title: chat.title || '新消息',
        body: chat.lastMessage || '发来了一条新消息',
        muted: false,
        desktopEnabled: desktopNotifyEnabled,
        soundEnabled: soundNotifyEnabled,
        onClick: () => {
          if (location.pathname !== '/chat') {
            navigate('/chat');
          }
        },
      });
    }
  }, [
    chats,
    selectedChatId,
    pendingRequestsCount,
    spaceUnreadCount,
    mutedChatIds,
    desktopNotifyEnabled,
    soundNotifyEnabled,
    location.pathname,
    navigate,
  ]);

  return null;
};

export default RealtimeSessionBridge;
