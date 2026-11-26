/**
 * ChatPage - 主聊天页面 (重构版)
 * 核心职责：状态管理、Socket 消息处理、子组件协调
 */

import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { authAPI, authUtils, messageAPI } from '../services/apiClient';
import { spaceAPI } from '../services/spaceApi';
import { showToast } from '../components/ui/Toast';
import type { User } from '../types/auth';
import type { Message } from '../types/chat';
import { buildGroupChatId, buildPrivateChatId } from '../utils/chat';
import { mediaWorkerClient } from '../core/bridge/mediaWorkerClient';
import type { UploadedFileResult } from '../core/workers/media.worker';
import { API_BASE_URL } from '../utils/apiUrl';

// Zustand Stores
import { useChatStore } from '../features/chat/store/chatStore';
import { useMessageStore } from '../features/chat/store/messageStore';
import { useChatUiPrefsStore } from '../features/chat/state/chatUiPrefsStore';
import {
  collectPresenceTargetUserIds,
  deriveSelfPresence,
} from '../features/chat/presence/presenceState';

// 核心 UI 组件
import { ChatArea } from '../components/layout';
import ChatHeader from '../features/chat/components/ChatHeader';
import MessageInput from '../features/chat/components/MessageInput';
import ChatHistory from '../features/chat/components/ChatHistory';
import { ChatImageLightbox } from '../features/chat/components/media/ChatImageLightbox';
import AiChatComponent from '../components/AiChatComponent';

// 拆分的子组件
import { ChatSidebar, ChatDetailPanel, ChatModals } from './chat';

const GroupDetailPanel = lazy(() => import('./chat/GroupDetailPanel'));

import './ChatPage.css';

const MOBILE_BREAKPOINT = 768;
const BOOT_PREFETCH_CHAT_COUNT = 6;
const BOOT_PREFETCH_PRIORITY_COUNT = 2;

interface IdleCallbackWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

function scheduleIdleTask(cb: () => void): number | null {
  if (typeof globalThis.window === 'undefined') return null;
  const win = globalThis.window as unknown as IdleCallbackWindow;
  if (typeof win.requestIdleCallback === 'function') {
    return win.requestIdleCallback(cb, { timeout: 800 }) as number;
  }
  return globalThis.setTimeout(cb, 320) as unknown as number;
}

function cancelIdleTask(handle: number | null) {
  if (handle === null || typeof globalThis.window === 'undefined') return;
  const win = globalThis.window as unknown as IdleCallbackWindow;
  if (typeof win.cancelIdleCallback === 'function') {
    win.cancelIdleCallback(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

/**
 * 通过 XMLHttpRequest 上传已预处理的媒体，提供真实字节级上传进度
 */
function uploadPreparedWithProgress(
  prepared: { blob: Blob; fileName: string },
  uploadUrl: string,
  authToken: string | null | undefined,
  onProgress: (fraction: number) => void,
  timeoutMs = 25_000,
): Promise<UploadedFileResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    xhr.timeout = timeoutMs;
    if (authToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(0.98, Math.max(0.05, event.loaded / event.total)));
      }
    };
    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}');
        resolve({
          success: Boolean(parsed?.success) && xhr.status >= 200 && xhr.status < 300,
          data: parsed?.data,
          message: parsed?.message,
          status: xhr.status,
        });
      } catch {
        reject(new Error(`上传响应解析失败 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误导致上传中断'));
    xhr.ontimeout = () => reject(new Error('文件上传超时，请重试'));

    const formData = new FormData();
    formData.append('file', prepared.blob, prepared.fileName);
    xhr.send(formData);
  });
}

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } }
};

const ChatPage: React.FC = () => {
  const navigate = useNavigate();

  // Chat Store (联系人管理)
  const selectedContact = useChatStore((state) => state.selectedContact);
  const selectedGroup = useChatStore((state) => state.selectedGroup);  // 新增
  const isGroupChatMode = useChatStore((state) => state.isGroupChatMode);  // 新增
  const selectedChatId = useChatStore((state) => state.selectedChatId);
  const chats = useChatStore((state) => state.chats);
  const contacts = useChatStore((state) => state.contacts);
  const pendingRequests = useChatStore((state) => state.pendingRequests);
  const loadChats = useChatStore((state) => state.loadChats);
  const loadContacts = useChatStore((state) => state.loadContacts);
  const loadPendingRequests = useChatStore((state) => state.loadPendingRequests);
  const selectContact = useChatStore((state) => state.selectContact);
  const selectGroup = useChatStore((state) => state.selectGroup);
  const resetUnread = useChatStore((state) => state.resetUnread);

  // Message Store (消息管理)
  const messageIdsVersion = useMessageStore((state) => state.messageIdsVersion);
  const aiMessages = useMessageStore((state) => state.aiMessages);
  const activeMessageChatId = useMessageStore((state) => state.activeChatId);
  const isLoadingMessages = useMessageStore((state) => state.isLoading);
  const messageError = useMessageStore((state) => state.error);
  const hasMoreMessages = useMessageStore((state) => state.hasMore);
  const loadMoreMessages = useMessageStore((state) => state.loadMoreMessages);
  const setActiveContact = useMessageStore((state) => state.setActiveContact);
  const setVisibleRange = useMessageStore((state) => state.setVisibleRange);
  const connectRealtime = useMessageStore((state) => state.connectRealtime);
  const subscribePresence = useMessageStore((state) => state.subscribePresence);
  const socketConnected = useMessageStore((state) => state.socketConnected);
  const syncPhase = useMessageStore((state) => state.syncPhase);
  const sendRealtimeMessage = useMessageStore((state) => state.sendRealtimeMessage);
  const sendTypingIndicator = useMessageStore((state) => state.sendTypingIndicator);
  const joinRealtimeRoom = useMessageStore((state) => state.joinRealtimeRoom);
  const leaveRealtimeRoom = useMessageStore((state) => state.leaveRealtimeRoom);
  const markRealtimeRead = useMessageStore((state) => state.markChatRead);
  const searchActiveChat = useMessageStore((state) => state.searchActiveChat);
  const loadMessageContext = useMessageStore((state) => state.loadMessageContext);
  const prefetchChats = useMessageStore((state) => state.prefetchChats);
  // Local State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const canSendMessages = !!currentUser;
  const [isBrowserOnline, setIsBrowserOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const selfPresence = useMemo(
    () => deriveSelfPresence({
      hasUser: canSendMessages,
      isBrowserOnline,
      socketConnected,
      syncPhase,
    }),
    [canSendMessages, isBrowserOnline, socketConnected, syncPhase],
  );
  const lastPresenceResyncAtRef = useRef(0);
  const lastPendingRequestsSyncAtRef = useRef(0);
  const [newMessage, setNewMessage] = useState('');
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [addContactInitialTab, setAddContactInitialTab] = useState<'search' | 'requests' | 'sent'>('search');
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isAiChatMode, setIsAiChatMode] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // UI State
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showGroupDetailPanel, setShowGroupDetailPanel] = useState(false);  // 新增
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showReconnectedNotice, setShowReconnectedNotice] = useState(false);
  const wasDisconnectedRef = useRef(false);
  const [unreadAnchorSeq, setUnreadAnchorSeq] = useState<number | null>(null);
  const pendingUnreadCountRef = useRef(0);
  const [isMobileLayout, setIsMobileLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT : false
  );
  const [mobilePane, setMobilePane] = useState<'sidebar' | 'chat'>('sidebar');
  // 挂载时若未携带显式私聊参数，记录全局 Store 残留的既有会话 ID，避免窄屏回到 /chat 时被强行切入旧会话详情
  const lastMobileTargetRef = useRef<string | null>(
    searchParams.get('dm')
      ? null
      : (selectedGroup?.id || selectedContact?.userId || selectedChatId || null)
  );

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchCursor, setSearchCursor] = useState(0);
  const [isContextMode, setIsContextMode] = useState(false);
  const [contextMessages, setContextMessages] = useState<Message[]>([]);
  const [contextHighlightSeq, setContextHighlightSeq] = useState<number | undefined>(undefined);

  // 消息上下文状态（引用回复 / 编辑 / 撤回确认 / 详情大图灯箱）
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingMessage, setReplyingMessage] = useState<Message | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<Message | null>(null);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);
  const [detailLightboxMedia, setDetailLightboxMedia] = useState<{ src: string; fileName?: string } | null>(null);

  const lastTypingEmitAtRef = useRef(0);
  const typingActiveRef = useRef(false);
  const typingTargetRef = useRef<{ receiverId?: string; groupId?: string } | null>(null);

  const selectedContactId = selectedContact?.userId ?? null;
  const selectedGroupId = selectedGroup?.id ?? null;

  useEffect(() => {
    // 切换会话前如仍处于正在输入状态，先向旧目标补发停止输入
    if (typingActiveRef.current && typingTargetRef.current) {
      sendTypingIndicator({ ...typingTargetRef.current, isTyping: false });
      typingActiveRef.current = false;
    }
    typingTargetRef.current = selectedGroupId
      ? { groupId: selectedGroupId }
      : selectedContactId && !isAiChatMode
        ? { receiverId: selectedContactId }
        : null;
    setEditingMessage(null);
    setReplyingMessage(null);
    setPendingDeleteMessage(null);
    setDetailLightboxMedia(null);
  }, [selectedChatId, isAiChatMode, selectedGroupId, selectedContactId, sendTypingIndicator]);

  // 全局 Escape 分级关闭快捷键（不干扰已被灯箱捕获的事件）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;

      if (detailLightboxMedia) {
        setDetailLightboxMedia(null);
        return;
      }
      if (pendingDeleteMessage) {
        if (!isDeletingMessage) setPendingDeleteMessage(null);
        return;
      }
      if (showAddContactModal) {
        setShowAddContactModal(false);
        return;
      }
      if (isGroupModalOpen) {
        setIsGroupModalOpen(false);
        return;
      }
      if (showDetailPanel || showGroupDetailPanel) {
        setShowDetailPanel(false);
        setShowGroupDetailPanel(false);
        return;
      }
      if (isSearchMode || isContextMode) {
        void clearSearch();
        return;
      }
      if (editingMessage || replyingMessage) {
        setEditingMessage(null);
        setReplyingMessage(null);
        return;
      }

      const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
      const isNonEmptyInput =
        activeEl
        && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')
        && activeEl.value.trim().length > 0;
      if (isNonEmptyInput) return;

      if (isAiChatMode) {
        setIsAiChatMode(false);
      } else if (selectedContact || selectedGroup) {
        selectContact(null);
        selectGroup(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    detailLightboxMedia,
    pendingDeleteMessage,
    isDeletingMessage,
    showAddContactModal,
    isGroupModalOpen,
    showDetailPanel,
    showGroupDetailPanel,
    isSearchMode,
    isContextMode,
    editingMessage,
    replyingMessage,
    isAiChatMode,
    selectedContact,
    selectedGroup,
    selectContact,
    selectGroup,
  ]);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dmHandledRef = useRef<string | null>(null);
  const searchRequestSeqRef = useRef(0);
  const bootPrefetchFingerprintRef = useRef('');

  // =====================
  // Effects
  // =====================

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 监测断线恢复状态：短时展示绿色恢复横幅后自动收起
  useEffect(() => {
    if (!canSendMessages) return;
    if (!isBrowserOnline || selfPresence.status === 'connecting' || selfPresence.status === 'offline') {
      wasDisconnectedRef.current = true;
      setShowReconnectedNotice(false);
      return;
    }
    if (wasDisconnectedRef.current && selfPresence.status === 'online') {
      wasDisconnectedRef.current = false;
      setShowReconnectedNotice(true);
      const timer = window.setTimeout(() => {
        setShowReconnectedNotice(false);
      }, 1800);
      return () => window.clearTimeout(timer);
    }
  }, [canSendMessages, isBrowserOnline, selfPresence.status]);

  // 初始化用户
  useEffect(() => {
    const initializeUser = async () => {
      try {
        const localUser = authUtils.getCurrentUser();
        if (localUser) {
          setCurrentUser(localUser);
          useChatUiPrefsStore.getState().hydrateForUser(localUser.id);
          console.log('🎉 ChatPage 成功渲染，当前用户:', localUser.username);
          connectRealtime();
          loadContacts();
          loadPendingRequests();

          // Best-effort: refresh `me` from server so avatar changes always show up in Chat UI,
          // even when the local snapshot is stale or stored as a relative path.
          try {
            const fresh = await authAPI.getCurrentUser();
            setCurrentUser(fresh);
          } catch {
            // ignore: keep local snapshot
          }
        } else {
          console.warn('未找到用户信息，重定向到登录页');
          navigate('/login', { replace: true });
        }
      } catch (error) {
        console.error('获取用户信息失败:', error);
        navigate('/login', { replace: true });
      }
    };
    initializeUser();
  }, [navigate, connectRealtime, loadContacts, loadPendingRequests]);

  const presenceTargetIds = useMemo(
    () => collectPresenceTargetUserIds({
      contacts,
      chats,
      selectedContact,
      selectedGroup,
      currentUserId: currentUser?.id,
    }),
    [contacts, chats, selectedContact, selectedGroup, currentUser?.id],
  );
  const presenceTargetIdsStr = useMemo(
    () => presenceTargetIds.join(','),
    [presenceTargetIds],
  );

  const isLiveRealtime = socketConnected && syncPhase === 'live';

  // 目标列表变更或实时链路进入活跃态时主动对齐一次在线状态快照
  useEffect(() => {
    if (!currentUser?.id || !presenceTargetIdsStr) return;
    const userIds = presenceTargetIdsStr.split(',');
    lastPresenceResyncAtRef.current = Date.now();
    subscribePresence(userIds);
  }, [presenceTargetIdsStr, currentUser?.id, isLiveRealtime, subscribePresence]);

  // 页面切回前台或网络恢复时节流重订阅，防止切屏休眠期间丢失在线态变更
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!currentUser?.id || !presenceTargetIdsStr) return;

    const PRESENCE_RESYNC_DEBOUNCE_MS = 1_500;
    const triggerPresenceResync = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastPresenceResyncAtRef.current < PRESENCE_RESYNC_DEBOUNCE_MS) return;
      lastPresenceResyncAtRef.current = now;
      subscribePresence(presenceTargetIdsStr.split(','));
    };

    document.addEventListener('visibilitychange', triggerPresenceResync);
    window.addEventListener('online', triggerPresenceResync);
    return () => {
      document.removeEventListener('visibilitychange', triggerPresenceResync);
      window.removeEventListener('online', triggerPresenceResync);
    };
  }, [presenceTargetIdsStr, currentUser?.id, subscribePresence]);

  // 好友申请前台同步与断连兜底轮询：长连接在线时依赖实时推送秒级刷新，仅在断连或切回前台时兜底同步
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!currentUser?.id) return;

    const PENDING_RESYNC_DEBOUNCE_MS = 5_000;
    const PENDING_POLL_INTERVAL_MS = 30_000;

    const syncPendingRequests = (force = false) => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (!force && now - lastPendingRequestsSyncAtRef.current < PENDING_RESYNC_DEBOUNCE_MS) {
        return;
      }
      lastPendingRequestsSyncAtRef.current = now;
      void loadPendingRequests({ silent: true });
    };

    const handleVisibilityOrOnline = () => {
      syncPendingRequests(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityOrOnline);
    window.addEventListener('online', handleVisibilityOrOnline);
    const intervalId = !isLiveRealtime
      ? window.setInterval(() => {
          syncPendingRequests(true);
        }, PENDING_POLL_INTERVAL_MS)
      : null;

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      window.removeEventListener('online', handleVisibilityOrOnline);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [currentUser?.id, isLiveRealtime, loadPendingRequests]);

  // 私信入口：从 Space 个人主页跳转
  useEffect(() => {
    const dmUserId = searchParams.get('dm');
    if (!dmUserId || !currentUser) return;
    if (dmHandledRef.current === dmUserId) return;
    dmHandledRef.current = dmUserId;

    if (currentUser.id === dmUserId) return;

    const openDm = async () => {
      const existing = useChatStore.getState().contacts.find((c) => c.userId === dmUserId);
      if (existing) {
        selectContact(existing);
        return;
      }

      try {
        const profile = await spaceAPI.getUserProfile(dmUserId);
        selectContact({
          id: profile.id,
          userId: profile.id,
          username: profile.username,
          avatarUrl: profile.avatarUrl || undefined,
          status: 'accepted',
          isOnline: !!profile.isOnline,
          lastSeen: profile.lastSeen || undefined,
          unreadCount: 0,
        });
      } catch (error) {
        console.error('打开私信失败:', error);
        showToast('无法打开私信，请稍后再试', 'error');
      }
    };

    openDm();
  }, [currentUser, searchParams, selectContact]);

  // 快捷键 / 命令面板携带 ?ai=1 时直达 AI 助手模式
  useEffect(() => {
    if (!currentUser) return;
    if (searchParams.get('ai') !== '1') return;
    setIsAiChatMode(true);
    selectContact(null);
    selectGroup(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('ai');
      return next;
    }, { replace: true });
  }, [currentUser, searchParams, selectContact, selectGroup, setSearchParams]);

  // 同步选中联系人/群组到 messageStore（仅依赖稳定主键，避免后台元数据同步触发重加载）
  useEffect(() => {
    if (selectedGroupId) {
      setActiveContact(selectedGroupId, true);
    } else {
      setActiveContact(selectedContactId, false);
    }
  }, [selectedContactId, selectedGroupId, setActiveContact]);

  // 冷路径预热：会话列表加载后，优先预取头部若干会话到 Worker。
  useEffect(() => {
    if (!currentUser?.id) return;
    if (!Array.isArray(chats) || chats.length === 0) return;

    const head = chats.slice(0, BOOT_PREFETCH_CHAT_COUNT);
    if (!head.length) return;

    const fingerprint = head.map((chat) => `${chat.id}:${chat.isGroup ? 'g' : 'p'}`).join('|');
    if (!fingerprint || bootPrefetchFingerprintRef.current === fingerprint) return;
    bootPrefetchFingerprintRef.current = fingerprint;

    const priority = head.slice(0, BOOT_PREFETCH_PRIORITY_COUNT);
    const rest = head.slice(priority.length);

    prefetchChats(
      priority.map((chat) => ({
        targetId: chat.id,
        isGroup: !!chat.isGroup,
      })),
    );

    let idleHandle: number | null = null;
    if (rest.length) {
      idleHandle = scheduleIdleTask(() => {
        prefetchChats(
          rest.map((chat) => ({
            targetId: chat.id,
            isGroup: !!chat.isGroup,
          })),
        );
      });
    }

    return () => {
      cancelIdleTask(idleHandle);
    };
  }, [chats, currentUser?.id, prefetchChats]);

  // 选择聊天后自动退出 AI 模式，修复 AI -> 用户聊天无法显示的问题
  useEffect(() => {
    if (selectedContactId || selectedGroupId) {
      setIsAiChatMode(false);
    }
  }, [selectedContactId, selectedGroupId]);

  // 群聊被删除/被移除后，确保详情面板关闭（无论来源是 socket 还是 worker sync）。
  useEffect(() => {
    if (!selectedGroup) {
      setShowGroupDetailPanel(false);
    }
  }, [selectedGroup]);

  // 群聊房间管理：保持侧栏里的所有群都订阅中，这样未打开的群也能实时增长未读数。
  const joinedGroupRoomsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const nextGroupIds = new Set(
      chats
        .filter((chat) => chat.isGroup)
        .map((chat) => chat.id)
        .filter(Boolean),
    );
    const joinedGroupIds = joinedGroupRoomsRef.current;

    for (const groupId of joinedGroupIds) {
      if (!nextGroupIds.has(groupId)) {
        leaveRealtimeRoom(groupId);
      }
    }

    for (const groupId of nextGroupIds) {
      if (!joinedGroupIds.has(groupId)) {
        joinRealtimeRoom(groupId);
      }
    }

    joinedGroupRoomsRef.current = nextGroupIds;
  }, [chats, joinRealtimeRoom, leaveRealtimeRoom]);

  // 组件卸载仅释放当前视图本地房间引用；全局 WebSocket 长连接由 RealtimeSessionBridge 常驻维护，切到 Space 期间不断连
  useEffect(() => {
    return () => {
      joinedGroupRoomsRef.current = new Set();
    };
  }, []);

  // 视口同步：移动端使用单栏（sidebar/chat 切换）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobileLayout(mobile);
      if (!mobile) {
        setMobilePane('chat');
        setShowDetailPanel(false);
        setShowGroupDetailPanel(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      lastMobileTargetRef.current = null;
      return;
    }

    const currentTarget =
      isAiChatMode
        ? 'ai'
        : selectedGroup?.id || selectedContact?.userId || selectedChatId || null;

    if (!currentTarget) {
      lastMobileTargetRef.current = null;
      setMobilePane('sidebar');
      return;
    }

    // Only auto-open chat when target changes.
    // This prevents mobile back from being overridden by unrelated state refreshes.
    if (lastMobileTargetRef.current !== currentTarget) {
      setMobilePane('chat');
      lastMobileTargetRef.current = currentTarget;
    }
  }, [isMobileLayout, selectedContact?.userId, selectedGroup?.id, selectedChatId, isAiChatMode]);

  // 当前聊天自动标记已读（基于最后一条消息 seq），并在清零前捕获未读分界线锚点
  const lastReadSeqRef = useRef<number>(0);
  useEffect(() => {
    lastReadSeqRef.current = 0;
    const summaryId = selectedGroup?.id || selectedContact?.userId;
    const summaryUnread = summaryId
      ? (useChatStore.getState().chats.find((chat) => chat.id === summaryId)?.unreadCount ?? 0)
      : 0;
    pendingUnreadCountRef.current = summaryUnread > 0 ? summaryUnread : 0;
    setUnreadAnchorSeq(null);
  }, [selectedGroup?.id, selectedContact?.userId]);
  useEffect(() => {
    if (!currentUser) return;
    if (!selectedGroup && !selectedContact) return;

    const activeChatId = selectedGroup
      ? buildGroupChatId(selectedGroup.id)
      : buildPrivateChatId(currentUser.id, selectedContact!.userId);

    const { messageIds, entities } = useMessageStore.getState();

    // 在标记已读前锁定本轮未读分界线，避免进入会话后分界条立即消失
    if (pendingUnreadCountRef.current > 0 && messageIds.length > 0) {
      let remaining = pendingUnreadCountRef.current;
      let firstUnreadSeq: number | null = null;
      for (let i = messageIds.length - 1; i >= 0; i -= 1) {
        const msg = entities.get(messageIds[i]);
        if (!msg || typeof msg.seq !== 'number') continue;
        const isIncoming = msg.userId !== currentUser.id && msg.senderId !== currentUser.id;
        if (isIncoming) {
          firstUnreadSeq = msg.seq;
          remaining -= 1;
          if (remaining <= 0) break;
        }
      }
      if (typeof firstUnreadSeq === 'number') {
        setUnreadAnchorSeq(Math.max(0, firstUnreadSeq - 1));
      }
      pendingUnreadCountRef.current = 0;
    }

    const lastId = messageIds[messageIds.length - 1];
    const lastSeq = lastId ? entities.get(lastId)?.seq : undefined;
    const summaryId = selectedGroup ? selectedGroup.id : selectedContact!.userId;
    const summarySeq = useChatStore.getState().chats.find((chat) => chat.id === summaryId)?.lastMessageSeq;
    const targetSeq = Math.max(
      typeof lastSeq === 'number' ? lastSeq : 0,
      typeof summarySeq === 'number' ? summarySeq : 0,
    );
    if (targetSeq > lastReadSeqRef.current) {
      markRealtimeRead(activeChatId, targetSeq);
      resetUnread(selectedGroup ? selectedGroup.id : selectedContact!.userId);
      lastReadSeqRef.current = targetSeq;
    }
  }, [messageIdsVersion, selectedGroup, selectedContact, currentUser, markRealtimeRead, resetUnread]);

  // =====================
  // Handlers
  // =====================

  const handleSearchMessages = async () => {
    if (!selectedContact && !selectedGroup) return;
    const keyword = searchQuery.trim();
    if (!keyword) {
      clearSearch();
      return;
    }

    const requestSeq = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestSeq;
    const limit = 50;

    try {
      const results = await searchActiveChat(keyword, limit);
      if (searchRequestSeqRef.current !== requestSeq) return;
      setSearchResults(results);
      setSearchCursor(0);
      setIsSearchMode(true);
      setIsContextMode(false);
    } catch (error: unknown) {
      console.error('搜索消息失败:', error);
      showToast(error instanceof Error ? error.message : '搜索消息失败', 'error');
    }
  };

  const clearSearch = async () => {
    setSearchQuery('');
    setIsSearchMode(false);
    setSearchResults([]);
    setSearchCursor(0);
    setIsContextMode(false);
    setContextMessages([]);
    setContextHighlightSeq(undefined);
    if (selectedContact) {
      await selectContact(selectedContact);
    } else if (selectedGroup) {
      useChatStore.getState().selectGroup(selectedGroup);
    }
  };

  const handleSelectSearchResult = async (message: Message) => {
    if (!message.chatId || !message.seq) return;
    const idx = searchResults.findIndex((item) => item.id === message.id);
    if (idx >= 0) {
      setSearchCursor(idx);
    }
    try {
      const contextList = await loadMessageContext(message.seq, 30);

      setContextMessages(contextList);
      setContextHighlightSeq(message.seq);
      setIsContextMode(true);
      setIsSearchMode(false);
    } catch (error: unknown) {
      console.error('跳转上下文失败:', error);
      showToast(error instanceof Error ? error.message : '跳转上下文失败', 'error');
    }
  };

  const handleStepSearchResult = (delta: number) => {
    if (searchResults.length === 0) return;
    const nextIdx = (searchCursor + delta + searchResults.length) % searchResults.length;
    setSearchCursor(nextIdx);
    const target = searchResults[nextIdx];
    if (target) {
      void handleSelectSearchResult(target);
    }
  };

  const emitRealtimeMessage = async (
    payload: Parameters<typeof sendRealtimeMessage>[0],
    fallbackError = '消息发送失败',
  ): Promise<boolean> => {
    const ack = await sendRealtimeMessage(payload);
    if (ack.success) return true;
    showToast(ack.error || fallbackError, 'error');
    return false;
  };

  const uploadAndSendFiles = async (files: File[], caption?: string) => {
    if (!files || files.length === 0 || (!selectedContact && !selectedGroup && !isAiChatMode) || !canSendMessages) {
      return;
    }

    setIsUploading(true);
    setUploadProgress(4);
    try {
      const total = files.length;
      let anySent = false;
      const activeReplyToId = replyingMessage?.id;
      const cleanCaption = caption?.trim();

      for (let i = 0; i < total; i += 1) {
        const file = files[i];
        const sliceBase = i / total;
        const sliceSpan = 1 / total;

        if (isAiChatMode && file.type.startsWith('image/')) {
          setUploadProgress(Math.round((sliceBase + 0.5 * sliceSpan) * 100));
          const prepared = await mediaWorkerClient.prepareAiImage(file, {
            maxEdge: 1536,
            quality: 0.84,
          });
          const aiMessageData = {
            content: cleanCaption || newMessage || '请分析这张图片',
            imageData: {
              mimeType: prepared.mimeType,
              base64Data: prepared.base64Data,
              fileName: file.name,
              fileSize: file.size,
              width: prepared.width,
              height: prepared.height,
            },
          };
          const ok = await emitRealtimeMessage(
            {
              content: JSON.stringify(aiMessageData),
              chatType: 'private',
              receiverId: 'ai',
              type: 'image',
            },
            'AI 图片消息发送失败',
          );
          if (ok) {
            anySent = true;
            setNewMessage('');
          }
          setUploadProgress(Math.round(((i + 1) / total) * 100));
          continue;
        }

        const prepared = await mediaWorkerClient.prepareUploadFile(file, {
          maxEdge: 2048,
          quality: 0.86,
          minBytesForTranscode: 320 * 1024,
        });
        setUploadProgress(Math.round((sliceBase + 0.25 * sliceSpan) * 100));

        const result = await uploadPreparedWithProgress(
          prepared,
          `${API_BASE_URL}/api/upload`,
          authUtils.getAccessToken(),
          (fraction) => {
            const combined = sliceBase + (0.25 + 0.72 * fraction) * sliceSpan;
            setUploadProgress(Math.min(99, Math.max(5, Math.round(combined * 100))));
          },
        );

        if (!result.success || !result.data) {
          throw new Error(result.message || '文件上传失败');
        }

        const uploaded = result.data;
        const uploadedName = uploaded.fileName || file.name || 'upload.bin';
        const uploadedType: Message['type'] = (uploaded.fileType as Message['type'] | undefined) || 'file';
        const uploadedUrl = uploaded.fileUrl || undefined;
        let sentOk = false;

        if (selectedGroup) {
          sentOk = await emitRealtimeMessage({
            chatType: 'group',
            groupId: selectedGroup.id,
            content: uploadedName,
            type: uploadedType,
            fileUrl: uploadedUrl,
            fileName: uploadedName,
            fileSize: uploaded.fileSize,
            mimeType: uploaded.mimeType,
            thumbnailUrl: uploaded.thumbnailUrl,
            ...(i === 0 && activeReplyToId ? { replyTo: activeReplyToId } : {}),
          }, '群聊文件消息发送失败');
        } else if (selectedContact) {
          sentOk = await emitRealtimeMessage({
            chatType: 'private',
            receiverId: selectedContact.userId,
            content: uploadedName,
            type: uploadedType,
            fileUrl: uploadedUrl,
            fileName: uploadedName,
            fileSize: uploaded.fileSize,
            mimeType: uploaded.mimeType,
            thumbnailUrl: uploaded.thumbnailUrl,
            ...(i === 0 && activeReplyToId ? { replyTo: activeReplyToId } : {}),
          }, '私聊文件消息发送失败');
        }

        if (sentOk) {
          anySent = true;
          if (i === 0 && activeReplyToId) {
            setReplyingMessage(null);
          }
        }
        setUploadProgress(Math.round(((i + 1) / total) * 100));
      }

      if (anySent && cleanCaption && !isAiChatMode) {
        await handleSendMessage(cleanCaption);
      }
    } catch (error) {
      console.error('上传失败:', error);
      showToast(error instanceof Error ? error.message : '文件上传失败，请稍后重试', 'error');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const uploadAndSendFile = async (file: File, caption?: string) => {
    await uploadAndSendFiles([file], caption);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadAndSendFile(file);
    event.target.value = '';
  };

  const handleSendMessage = (content?: string) => {
    const messageContent = content || newMessage.trim();
    if (!messageContent) return;
    if (!currentUser) {
      showToast('认证失效，请重新登录', 'error');
      return;
    }

    const activeReplyToId = isAiChatMode ? undefined : replyingMessage?.id;
    const shouldClearDraft = !content;
    if (shouldClearDraft) {
      // 点击发送即刻清空输入框，避免干等服务端 ACK 造成输入卡顿体感
      setNewMessage('');
    }
    if (activeReplyToId) {
      setReplyingMessage(null);
    }

    void (async () => {
      let ok = false;
      if (isAiChatMode) {
        ok = await emitRealtimeMessage({
          content: `/ai ${messageContent}`,
          chatType: 'private',
          receiverId: 'ai',
          type: 'text',
        }, 'AI 消息发送失败');
      } else if (selectedGroup) {
        ok = await emitRealtimeMessage({
          content: messageContent,
          chatType: 'group',
          groupId: selectedGroup.id,
          type: 'text',
          ...(activeReplyToId ? { replyTo: activeReplyToId } : {}),
        }, '群聊消息发送失败');
      } else if (selectedContact) {
        ok = await emitRealtimeMessage({
          content: messageContent,
          chatType: 'private',
          receiverId: selectedContact.userId,
          type: 'text',
          ...(activeReplyToId ? { replyTo: activeReplyToId } : {}),
        }, '私聊消息发送失败');
      }

      if (!ok && shouldClearDraft) {
        // 发送失败且用户尚未输入新内容时自动恢复草稿，便于直接重试
        setNewMessage((current) => (current ? current : messageContent));
      }
    })();
  };

  const handleReplyMessage = (message: Message) => {
    setEditingMessage(null);
    setReplyingMessage(message);
  };

  const handleEditMessage = (message: Message) => {
    setReplyingMessage(null);
    setEditingMessage(message);
  };

  const handleEditLastOwnMessage = () => {
    if (!currentUser || isAiChatMode) return;
    const { messageIds, entities } = useMessageStore.getState();
    for (let i = messageIds.length - 1; i >= 0; i -= 1) {
      const msg = entities.get(messageIds[i]);
      if (!msg) continue;
      const isOut = msg.userId === currentUser.id || msg.senderId === currentUser.id;
      if (isOut && msg.type === 'text' && msg.status !== 'failed' && msg.status !== 'pending') {
        handleEditMessage(msg);
        return;
      }
    }
  };

  const handleSaveEdit = async (messageId: string, newContent: string): Promise<boolean> => {
    try {
      await messageAPI.editMessage(messageId, newContent);
      // 先就地同步主线程实体内容，实时网关随后广播权威版本
      useMessageStore.setState((state) => {
        const existing = state.entities.get(messageId);
        if (!existing) return state;
        const nextEntities = new Map(state.entities);
        nextEntities.set(messageId, {
          ...existing,
          content: newContent,
          editedAt: new Date().toISOString(),
        });
        return { entities: nextEntities };
      });
      setEditingMessage(null);
      return true;
    } catch (error) {
      console.error('编辑消息失败:', error);
      showToast(error instanceof Error ? error.message : '编辑消息失败', 'error');
      return false;
    }
  };

  const handleConfirmDeleteMessage = async () => {
    if (!pendingDeleteMessage || isDeletingMessage) return;
    const targetId = pendingDeleteMessage.id;
    setIsDeletingMessage(true);
    try {
      await messageAPI.deleteMessage(targetId);
      setPendingDeleteMessage(null);
      if (editingMessage?.id === targetId) setEditingMessage(null);
      if (replyingMessage?.id === targetId) setReplyingMessage(null);
      showToast('消息已撤回', 'info');
    } catch (error) {
      console.error('撤回消息失败:', error);
      showToast(error instanceof Error ? error.message : '撤回消息失败', 'error');
    } finally {
      setIsDeletingMessage(false);
    }
  };

  const handleRetryMessage = (message: Message) => {
    if (!currentUser || isAiChatMode) return;
    const attachment = message.attachments?.[0];
    const fileUrl = message.fileUrl || attachment?.fileUrl;
    const commonExtras = {
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(fileUrl ? { fileUrl } : {}),
      ...(message.fileName || attachment?.fileName ? { fileName: message.fileName || attachment?.fileName } : {}),
      ...(message.fileSize ?? attachment?.fileSize ? { fileSize: message.fileSize ?? attachment?.fileSize } : {}),
      ...(message.mimeType || attachment?.mimeType ? { mimeType: message.mimeType || attachment?.mimeType } : {}),
      ...(message.thumbnailUrl || attachment?.thumbnailUrl
        ? { thumbnailUrl: message.thumbnailUrl || attachment?.thumbnailUrl }
        : {}),
    };

    void (async () => {
      if (selectedGroup) {
        await emitRealtimeMessage({
          chatType: 'group',
          groupId: selectedGroup.id,
          content: message.content || message.fileName || '',
          type: message.type,
          ...commonExtras,
        }, '重新发送群聊消息失败');
      } else if (selectedContact) {
        await emitRealtimeMessage({
          chatType: 'private',
          receiverId: selectedContact.userId,
          content: message.content || message.fileName || '',
          type: message.type,
          ...commonExtras,
        }, '重新发送私聊消息失败');
      }
    })();
  };

  const handleTypingChange = (isTyping: boolean) => {
    if (isAiChatMode || !canSendMessages) return;
    const target = selectedGroup
      ? { groupId: selectedGroup.id }
      : selectedContact
        ? { receiverId: selectedContact.userId }
        : null;
    if (!target) return;

    if (!isTyping) {
      if (typingActiveRef.current) {
        typingActiveRef.current = false;
        lastTypingEmitAtRef.current = 0;
        sendTypingIndicator({ ...target, isTyping: false });
      }
      return;
    }

    const now = Date.now();
    if (!typingActiveRef.current || now - lastTypingEmitAtRef.current >= 2200) {
      typingActiveRef.current = true;
      lastTypingEmitAtRef.current = now;
      sendTypingIndicator({ ...target, isTyping: true });
    }
  };

  const handleSelectAiChat = () => {
    setIsAiChatMode(true);
    selectContact(null);
    selectGroup(null);
  };

  const handleMobileBackToSidebar = () => {
    setShowDetailPanel(false);
    setShowGroupDetailPanel(false);
    setMobilePane('sidebar');
  };

  // Derived Data
  const displayedMessages = isContextMode ? contextMessages : isSearchMode ? searchResults : null;
  const sharedMediaMessages = useMemo(() => {
    const needPrivateMedia = !isGroupChatMode && showDetailPanel && Boolean(selectedContact);
    const needGroupMedia = isGroupChatMode && showGroupDetailPanel && Boolean(selectedGroup);
    if (!needPrivateMedia && !needGroupMedia) return [];
    const { messageIds, entities } = useMessageStore.getState();
    const list: Message[] = [];
    for (const id of messageIds) {
      const msg = entities.get(id);
      if (msg) list.push(msg);
    }
    return list;
  }, [isGroupChatMode, showDetailPanel, showGroupDetailPanel, selectedContact, selectedGroup, messageIdsVersion]);

  const detailGalleryItems = useMemo(() => {
    if (!detailLightboxMedia) return [];
    const items: Array<{ id?: string; src: string; fileName?: string }> = [];
    for (const msg of sharedMediaMessages) {
      if (msg.type !== 'image') continue;
      const rawUrl = msg.fileUrl || msg.attachments?.[0]?.fileUrl;
      if (!rawUrl) continue;
      items.push({
        id: msg.id,
        src: rawUrl,
        fileName: msg.fileName || msg.attachments?.[0]?.fileName,
      });
    }
    return items.length > 0 ? items : [detailLightboxMedia];
  }, [detailLightboxMedia, sharedMediaMessages]);

  const detailLightboxInitialIndex = useMemo(() => {
    if (!detailLightboxMedia || detailGalleryItems.length === 0) return 0;
    const idx = detailGalleryItems.findIndex(
      (item) => item.src === detailLightboxMedia.src || detailLightboxMedia.src.endsWith(item.src),
    );
    return idx >= 0 ? idx : 0;
  }, [detailLightboxMedia, detailGalleryItems]);

  const currentGroupCanMentionAll = Boolean(
    selectedGroup
    && (selectedGroup.ownerId === currentUser?.id
      || selectedGroup.currentUserRole === 'owner'
      || selectedGroup.currentUserRole === 'admin'),
  );
  const selectedChatSummary = selectedChatId ? chats.find((chat) => chat.id === selectedChatId) : undefined;
  const selectedHistoryChatId = currentUser
    ? selectedGroup
      ? buildGroupChatId(selectedGroup.id)
      : selectedContact
        ? buildPrivateChatId(currentUser.id, selectedContact.userId)
        : null
    : null;
  const selectedChatHasHistoryHint =
    Boolean(selectedChatSummary?.lastMessage)
    || (selectedChatSummary?.unreadCount ?? 0) > 0
    || (selectedChatSummary?.lastMessageTimestamp ?? 0) > 0;
  const isResolvingSelectedHistory =
    !isSearchMode
    && !isContextMode
    && Boolean(selectedHistoryChatId)
    && (
      isLoadingMessages
      || activeMessageChatId !== selectedHistoryChatId
      || selectedChatHasHistoryHint
    );

  // =====================
  // Render
  // =====================

  return (
    <motion.div
      className={`chat-container ${isMobileLayout ? `chat-container--mobile-${mobilePane}` : ''}`}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 隐藏的文件输入 */}
      <input
        type="file"
        id="chat-page-file-upload"
        name="chat-page-file-upload"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden-file-input"
        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.zip"
        aria-label="上传文件"
        title="上传文件"
      />

      {/* 1. Sidebar */}
        <ChatSidebar
          currentUser={currentUser}
          isConnected={selfPresence.isOnline}
          connectionStatus={selfPresence.status}
          connectionLabel={selfPresence.label}
        isAiChatMode={isAiChatMode}
        pendingRequests={pendingRequests}
        onSelectAiChat={handleSelectAiChat}
        onOpenGroupModal={() => setIsGroupModalOpen(true)}
        onOpenAddContactModal={(initialTab = 'search') => {
          setAddContactInitialTab(initialTab);
          setShowAddContactModal(true);
        }}
        onChatSelected={() => {
          if (isMobileLayout) setMobilePane('chat');
        }}
      />

      {/* 2. Chat Area */}
      {isAiChatMode ? (
        <div className="main-ai-chat-container">
          <AiChatComponent
            currentUser={currentUser}
            messages={aiMessages}
            isConnected={canSendMessages}
            onBackToContacts={() => {
              setIsAiChatMode(false);
              if (isMobileLayout) {
                setMobilePane('sidebar');
              }
            }}
          />
        </div>
      ) : (
        <ChatArea
          className="main-chat-area"
          header={
            <ChatHeader
              isAiMode={isAiChatMode}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSearch={handleSearchMessages}
              onAvatarClick={() => {
                if (isGroupChatMode) {
                  setShowGroupDetailPanel(true);
                } else {
                  setShowDetailPanel(true);
                }
              }}
              showMobileBackButton={isMobileLayout}
              onMobileBack={handleMobileBackToSidebar}
            />
          }
          footer={
            <MessageInput
              chatId={selectedChatId}
              onSendMessage={handleSendMessage}
              onFileUpload={(file, caption) => {
                void uploadAndSendFile(file, caption);
              }}
              onFilesUpload={(files, caption) => {
                void uploadAndSendFiles(files, caption);
              }}
              isConnected={canSendMessages}
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              editingMessage={editingMessage}
              replyingMessage={replyingMessage}
              isGroupChat={isGroupChatMode}
              groupMembers={selectedGroup?.members}
              currentUsername={currentUser?.username}
              canMentionAll={currentGroupCanMentionAll}
              onCancelContext={() => {
                setEditingMessage(null);
                setReplyingMessage(null);
              }}
              onSaveEdit={handleSaveEdit}
              onEditLastOwnMessage={handleEditLastOwnMessage}
              onTypingChange={isAiChatMode ? undefined : handleTypingChange}
            />
          }
          showEmptyState={!selectedContact && !selectedGroup}
        >
          {(!isBrowserOnline || selfPresence.status === 'connecting' || showReconnectedNotice) && (
            <div
              className={`chat-connection-banner ${
                !isBrowserOnline
                  ? 'is-offline'
                  : selfPresence.status === 'connecting'
                    ? 'is-connecting'
                    : 'is-reconnected'
              }`}
              role="status"
            >
              <div className="chat-connection-banner__left">
                {!isBrowserOnline || selfPresence.status === 'connecting' ? (
                  <WifiOff size={15} />
                ) : (
                  <Wifi size={15} />
                )}
                <span>
                  {!isBrowserOnline
                    ? '当前处于离线状态，网络恢复后将自动同步新消息'
                    : selfPresence.status === 'connecting'
                      ? '正在连接实时消息服务...'
                      : '实时连接已恢复，消息已保持同步'}
                </span>
              </div>
              {(!isBrowserOnline || selfPresence.status === 'connecting') && (
                <button
                  type="button"
                  className="chat-connection-banner__action"
                  onClick={() => connectRealtime()}
                >
                  <RefreshCw size={12} />
                  <span>重连</span>
                </button>
              )}
            </div>
          )}

          {(isSearchMode || isContextMode) && (
            <div className="chat-context-bar">
              <div className="chat-context-bar__left">
                <span className="chat-context-bar__label">
                  {isContextMode ? '上下文定位' : `搜索结果 ${searchResults.length}`}
                </span>
                <span className="chat-context-bar__hint">
                  {isContextMode ? '高亮为命中消息' : '点击结果跳转上下文'}
                </span>
              </div>
              <div className="chat-context-bar__actions">
                {searchResults.length > 0 && (
                  <div className="chat-context-bar__nav" aria-label="搜索结果切换">
                    <span>第 {searchCursor + 1} / {searchResults.length} 条</span>
                    <button
                      type="button"
                      className="chat-context-bar__nav-btn"
                      aria-label="上一条命中消息"
                      disabled={searchResults.length <= 1}
                      onClick={() => handleStepSearchResult(-1)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="chat-context-bar__nav-btn"
                      aria-label="下一条命中消息"
                      disabled={searchResults.length <= 1}
                      onClick={() => handleStepSearchResult(1)}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                )}
                {isContextMode && (
                  <button
                    type="button"
                    className="chat-context-bar__btn"
                    onClick={() => {
                    setIsContextMode(false);
                    setContextMessages([]);
                    setContextHighlightSeq(undefined);
                    setIsSearchMode(true);
                  }}
                  >
                    返回搜索
                  </button>
                )}
                <button type="button" className="chat-context-bar__btn ghost" onClick={clearSearch}>
                  退出
                </button>
              </div>
            </div>
          )}
          <ChatHistory
            key={selectedChatId ?? 'empty'}
            currentUserId={currentUser?.id || ''}
            currentUsername={currentUser?.username}
            {...(isSearchMode || isContextMode
              ? { messages: displayedMessages || [] }
              : {
                  messageIds: useMessageStore.getState().messageIds,
                  messageIdsVersion,
                })}
            isLoading={isLoadingMessages}
            hasMore={isSearchMode || isContextMode ? false : hasMoreMessages}
            onLoadMore={isSearchMode || isContextMode ? undefined : loadMoreMessages}
            onRetryLoad={() => {
              if (selectedGroupId) {
                setActiveContact(selectedGroupId, true);
              } else if (selectedContactId) {
                setActiveContact(selectedContactId, false);
              }
            }}
            onVisibleRangeChange={isSearchMode || isContextMode ? undefined : setVisibleRange}
            highlightTerm={searchQuery.trim() ? searchQuery.trim() : undefined}
            highlightSeq={contextHighlightSeq}
            unreadAnchorSeq={isSearchMode || isContextMode ? null : unreadAnchorSeq}
            onMessageSelect={isSearchMode ? handleSelectSearchResult : undefined}
            disableAutoScroll={isSearchMode || isContextMode}
            hasHistoryHint={isResolvingSelectedHistory}
            errorMessage={isSearchMode || isContextMode ? null : messageError}
            onReplyMessage={isSearchMode || isContextMode ? undefined : handleReplyMessage}
            onEditMessage={isSearchMode || isContextMode ? undefined : handleEditMessage}
            onDeleteMessage={isSearchMode || isContextMode ? undefined : (msg) => setPendingDeleteMessage(msg)}
            onRetryMessage={isSearchMode || isContextMode ? undefined : handleRetryMessage}
            onToggleReaction={
              isSearchMode || isContextMode || !currentUser?.id
                ? undefined
                : (msg, emoji) => {
                    void useMessageStore.getState().toggleMessageReaction(msg.id, emoji, currentUser.id);
                  }
            }
          />
        </ChatArea>
      )}

      {/* 3. Detail Panel */}
      {!isMobileLayout && showDetailPanel && !isGroupChatMode && (
        <ChatDetailPanel
          isOpen
          onClose={() => setShowDetailPanel(false)}
          selectedContact={selectedContact}
          sharedMediaMessages={sharedMediaMessages}
          onPreviewImage={setDetailLightboxMedia}
          onContactUpdated={() => {
            void loadContacts();
            void loadChats({ silent: true });
          }}
          onContactRemoved={(removedUserId) => {
            if (selectedContact?.userId === removedUserId) {
              selectContact(null);
            }
          }}
        />
      )}

      {/* 3.5 Group Detail Panel */}
      {showGroupDetailPanel && isGroupChatMode && (
        <Suspense fallback={null}>
          <GroupDetailPanel
            isOpen
            onClose={() => setShowGroupDetailPanel(false)}
            group={selectedGroup}
            sharedMediaMessages={sharedMediaMessages}
            onPreviewImage={setDetailLightboxMedia}
          />
        </Suspense>
      )}

      {/* 4. Modals */}
      <ChatModals
        showAddContactModal={showAddContactModal}
        addContactInitialTab={addContactInitialTab}
        isGroupModalOpen={isGroupModalOpen}
        onCloseAddContact={() => setShowAddContactModal(false)}
        onCloseGroupModal={() => setIsGroupModalOpen(false)}
        onContactAdded={() => {
          void loadContacts();
          void loadPendingRequests({ silent: true });
          void loadChats({ silent: true });
        }}
        onStartChatWithContact={(userId) => {
          setShowAddContactModal(false);
          const existing = useChatStore.getState().contacts.find((c) => c.userId === userId);
          if (existing) {
            selectContact(existing);
            if (isMobileLayout) setMobilePane('chat');
            return;
          }
          void spaceAPI.getUserProfile(userId)
            .then((profile) => {
              selectContact({
                id: profile.id,
                userId: profile.id,
                username: profile.username,
                avatarUrl: profile.avatarUrl || undefined,
                status: 'accepted',
                isOnline: !!profile.isOnline,
                lastSeen: profile.lastSeen || undefined,
                unreadCount: 0,
              });
              if (isMobileLayout) setMobilePane('chat');
            })
            .catch(() => {
              showToast('打开会话失败，请稍后重试', 'error');
            });
        }}
        onOpenAddContactFromGroup={() => {
          setIsGroupModalOpen(false);
          setAddContactInitialTab('search');
          setShowAddContactModal(true);
        }}
        onGroupCreated={() => { }}
      />

      {pendingDeleteMessage && (
        <div
          className="chat-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-delete-confirm-title"
          onClick={() => !isDeletingMessage && setPendingDeleteMessage(null)}
        >
          <div className="chat-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <h3 id="chat-delete-confirm-title" className="chat-confirm-dialog__title">
              撤回这条消息？
            </h3>
            <p className="chat-confirm-dialog__desc">
              {pendingDeleteMessage.content
                ? `「${pendingDeleteMessage.content.slice(0, 60)}${pendingDeleteMessage.content.length > 60 ? '…' : ''}」将从双方会话中移除。`
                : '该消息将从双方会话中移除，此操作无法撤销。'}
            </p>
            <div className="chat-confirm-dialog__actions">
              <button
                type="button"
                className="chat-confirm-dialog__btn"
                disabled={isDeletingMessage}
                onClick={() => setPendingDeleteMessage(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="chat-confirm-dialog__btn is-danger"
                disabled={isDeletingMessage}
                onClick={() => void handleConfirmDeleteMessage()}
              >
                {isDeletingMessage ? '撤回中...' : '确认撤回'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ChatImageLightbox
        src={detailLightboxMedia?.src ?? null}
        fileName={detailLightboxMedia?.fileName}
        items={detailLightboxMedia ? detailGalleryItems : undefined}
        initialIndex={detailLightboxInitialIndex}
        onClose={() => setDetailLightboxMedia(null)}
      />
    </motion.div>
  );
};

export default ChatPage;
