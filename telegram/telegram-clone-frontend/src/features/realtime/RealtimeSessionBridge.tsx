/**
 * 根级常驻实时会话桥接组件
 * 负责在全应用路由切换（聊天、Space、个人设置等）期间保持唯一 WebSocket 实时链路在线，
 * 确保联系人申请、消息撤回编辑、社交通知与多端已读在任意页面秒级可达。
 */

import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { authUtils } from '../../services/apiClient';
import {
  AUTH_SESSION_CLEARED_EVENT,
  AUTH_TOKENS_UPDATED_EVENT,
} from '../../utils/authStorage';
import { useMessageStore } from '../chat/store/messageStore';

export const RealtimeSessionBridge: React.FC = () => {
  const location = useLocation();
  const connectedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const syncRealtimeSession = () => {
      const authenticated = authUtils.isAuthenticated();
      const userId = authUtils.getCurrentUser()?.id || null;

      if (!authenticated || !userId) {
        if (connectedUserIdRef.current !== null) {
          connectedUserIdRef.current = null;
          useMessageStore.getState().disconnectRealtime();
        }
        return;
      }

      if (connectedUserIdRef.current && connectedUserIdRef.current !== userId) {
        connectedUserIdRef.current = userId;
        useMessageStore.getState().disconnectRealtime();
        useMessageStore.getState().connectRealtime();
        return;
      }

      if (!connectedUserIdRef.current) {
        connectedUserIdRef.current = userId;
        useMessageStore.getState().connectRealtime();
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

  return null;
};

export default RealtimeSessionBridge;
