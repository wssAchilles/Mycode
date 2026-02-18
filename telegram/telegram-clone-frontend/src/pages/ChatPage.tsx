/**
 * ChatPage - 主聊天页面 (重构版)
 * 核心职责：状态管理、Socket 消息处理、子组件协调
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI, authUtils, messageAPI } from '../services/apiClient';
import { mlService } from '../services/mlService';
import { spaceAPI } from '../services/spaceApi';
import { showToast } from '../components/ui/Toast';
import { useSocket } from '../hooks/useSocket';
import type { User } from '../types/auth';
import type { Message } from '../types/chat';
import { buildGroupChatId, buildPrivateChatId } from '../utils/chat';
import { throttleWithTickEnd } from '../core/workers/schedulers';
import type { SocketRealtimeEvent } from '../core/chat/realtime';

// Zustand Stores
import { useChatStore } from '../features/chat/store/chatStore';
import { useMessageStore } from '../features/chat/store/messageStore';

// 核心 UI 组件
import { ChatArea } from '../components/layout';
import ChatHeader from '../features/chat/components/ChatHeader';
import MessageInput from '../features/chat/components/MessageInput';
import ChatHistory from '../features/chat/components/ChatHistory';
import AiChatComponent from '../components/AiChatComponent';

// 拆分的子组件
import { ChatSidebar, ChatDetailPanel, ChatModals, GroupDetailPanel } from './chat';

import './ChatPage.css';

// API 配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';
const MOBILE_BREAKPOINT = 900;

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } }
};

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    isConnected: socketConnected,
    initializeSocket,
    disconnectSocket,
    onRealtimeBatch,
    sendMessage,
    joinRoom,
    leaveRoom,
    markChatRead,
  } = useSocket();

  // Chat Store (联系人管理)
  const selectedContact = useChatStore((state) => state.selectedContact);
  const selectedGroup = useChatStore((state) => state.selectedGroup);  // 新增
  const isGroupChatMode = useChatStore((state) => state.isGroupChatMode);  // 新增
  const selectedChatId = useChatStore((state) => state.selectedChatId);
  const pendingRequests = useChatStore((state) => state.pendingRequests);
  const loadContacts = useChatStore((state) => state.loadContacts);
  const loadPendingRequests = useChatStore((state) => state.loadPendingRequests);
  const selectContact = useChatStore((state) => state.selectContact);
  const selectGroup = useChatStore((state) => state.selectGroup);

  // Message Store (消息管理)
  const messageIdsVersion = useMessageStore((state) => state.messageIdsVersion);
  const aiMessages = useMessageStore((state) => state.aiMessages);
  const isLoadingMessages = useMessageStore((state) => state.isLoading);
  const hasMoreMessages = useMessageStore((state) => state.hasMore);
  const addMessage = useMessageStore((state) => state.addMessage);
  const ingestRealtimeEvents = useMessageStore((state) => state.ingestRealtimeEvents);
  const loadMoreMessages = useMessageStore((state) => state.loadMoreMessages);
  const setActiveContact = useMessageStore((state) => state.setActiveContact);
  const setVisibleRange = useMessageStore((state) => state.setVisibleRange);
  const setSocketConnected = useMessageStore((state) => state.setSocketConnected);
  const searchActiveChat = useMessageStore((state) => state.searchActiveChat);

  // Local State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isAiChatMode, setIsAiChatMode] = useState(false);
  const [searchParams] = useSearchParams();

  // UI State
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showGroupDetailPanel, setShowGroupDetailPanel] = useState(false);  // 新增
  const [isUploading, setIsUploading] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT : false
  );
  const [mobilePane, setMobilePane] = useState<'sidebar' | 'chat'>('sidebar');
  const lastMobileTargetRef = useRef<string | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isContextMode, setIsContextMode] = useState(false);
  const [contextMessages, setContextMessages] = useState<Message[]>([]);
  const [contextHighlightSeq, setContextHighlightSeq] = useState<number | undefined>(undefined);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dmHandledRef = useRef<string | null>(null);
  const vfCheckQueueRef = useRef<Set<string>>(new Set());
  const flushVfChecksRef = useRef<(() => void) | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const selectedGroupIdRef = useRef<string | null>(null);
  const searchRequestSeqRef = useRef(0);

  if (!flushVfChecksRef.current) {
    flushVfChecksRef.current = throttleWithTickEnd(() => {
      const ids = Array.from(vfCheckQueueRef.current.values());
      vfCheckQueueRef.current.clear();
      if (!ids.length) return;

      void Promise.allSettled(ids.map((id) => mlService.vfCheck(id)));
    });
  }

  // =====================
  // Effects
  // =====================

  // 初始化用户
  useEffect(() => {
    const initializeUser = async () => {
      try {
        const localUser = authUtils.getCurrentUser();
        if (localUser) {
          setCurrentUser(localUser);
          console.log('🎉 ChatPage 成功渲染，当前用户:', localUser.username);
          initializeSocket();
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
  }, [navigate, initializeSocket, loadContacts, loadPendingRequests]);

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

  // 同步选中联系人/群组到 messageStore
  useEffect(() => {
    if (selectedGroup) {
      setActiveContact(selectedGroup.id, true);
    } else {
      setActiveContact(selectedContact?.userId || null, false);
    }
  }, [selectedContact, selectedGroup, setActiveContact]);

  // 选择聊天后自动退出 AI 模式，修复 AI -> 用户聊天无法显示的问题
  useEffect(() => {
    if (selectedContact || selectedGroup) {
      setIsAiChatMode(false);
    }
  }, [selectedContact, selectedGroup]);

  // 群聊被删除/被移除后，确保详情面板关闭（无论来源是 socket 还是 worker sync）。
  useEffect(() => {
    if (!selectedGroup) {
      setShowGroupDetailPanel(false);
    }
  }, [selectedGroup]);

  // 群聊房间管理
  const prevGroupRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevGroupRef.current && prevGroupRef.current !== selectedGroup?.id) {
      leaveRoom(prevGroupRef.current);
    }
    if (selectedGroup?.id) {
      joinRoom(selectedGroup.id);
      prevGroupRef.current = selectedGroup.id;
    } else {
      prevGroupRef.current = null;
    }
  }, [selectedGroup, joinRoom, leaveRoom]);

  useEffect(() => {
    currentUserIdRef.current = currentUser?.id || null;
  }, [currentUser?.id]);

  useEffect(() => {
    selectedGroupIdRef.current = selectedGroup?.id || null;
  }, [selectedGroup?.id]);

  // 组件卸载清理
  useEffect(() => {
    return () => {
      console.log('🧹 ChatPage 组件卸载，清理资源...');
      disconnectSocket();
    };
  }, [disconnectSocket]);

  // 连接状态同步
  useEffect(() => {
    setSocketConnected(socketConnected);
  }, [socketConnected, setSocketConnected]);

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

  // Realtime bridge: one batched stream -> worker ingest + minimal UI side-effects.
  useEffect(() => {
    const cleanup = onRealtimeBatch((events: SocketRealtimeEvent[]) => {
      if (!Array.isArray(events) || events.length === 0) return;

      ingestRealtimeEvents(events);

      const currentUserId = currentUserIdRef.current;
      const selectedGroupId = selectedGroupIdRef.current;

      for (const event of events) {
        if (event.type === 'message') {
          const message = event.payload;
          const messageId = String(message?.id || '');
          const senderId = String(message?.senderId || message?.userId || 'unknown');
          if (currentUserId && senderId === currentUserId && messageId) {
            vfCheckQueueRef.current.add(messageId);
          }
          continue;
        }

        if (event.type !== 'groupUpdate') continue;
        const data = event.payload;
        const groupId = data?.groupId ? String(data.groupId) : '';
        if (!groupId) continue;

        if (data.action === 'member_added') {
          const memberIds = Array.isArray(data.memberIds)
            ? data.memberIds
            : Array.isArray(data.members)
              ? data.members.map((m: any) => m?.user?.id || m?.user?.userId || m?.userId).filter(Boolean)
              : [];
          if (currentUserId && memberIds.includes(currentUserId)) {
            joinRoom(groupId);
          }
        }

        if ((data.action === 'member_removed' || data.action === 'member_left') && data.targetId === currentUserId) {
          leaveRoom(groupId);
        }

        if (selectedGroupId === groupId) {
          if (
            data.action === 'group_deleted' ||
            ((data.action === 'member_removed' || data.action === 'member_left') && data.targetId === currentUserId)
          ) {
            useChatStore.getState().selectGroup(null);
            setShowGroupDetailPanel(false);
          }
        }
      }

      if (vfCheckQueueRef.current.size) {
        flushVfChecksRef.current?.();
      }
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [onRealtimeBatch, ingestRealtimeEvents, joinRoom, leaveRoom]);

  // 当前聊天自动标记已读（基于最后一条消息 seq）
  const lastReadSeqRef = useRef<number>(0);
  useEffect(() => {
    lastReadSeqRef.current = 0;
  }, [selectedGroup?.id, selectedContact?.userId]);
  useEffect(() => {
    if (!currentUser) return;
    if (!selectedGroup && !selectedContact) return;

    const activeChatId = selectedGroup
      ? buildGroupChatId(selectedGroup.id)
      : buildPrivateChatId(currentUser.id, selectedContact!.userId);

    const { messageIds, entities } = useMessageStore.getState();
    const lastId = messageIds[messageIds.length - 1];
    const lastSeq = lastId ? entities.get(lastId)?.seq : undefined;
    if (lastSeq && lastSeq > lastReadSeqRef.current) {
      markChatRead(activeChatId, lastSeq);
      lastReadSeqRef.current = lastSeq;
    }
  }, [messageIdsVersion, selectedGroup, selectedContact, currentUser, markChatRead]);

  // =====================
  // Handlers
  // =====================

  const mapApiMessage = (msg: any): Message => ({
    id: msg.id,
    chatId: msg.chatId,
    chatType: msg.chatType,
    seq: msg.seq,
    content: msg.content,
    senderId: msg.senderId,
    senderUsername: msg.senderUsername,
    userId: msg.senderId,
    username: msg.senderUsername,
    receiverId: msg.receiverId,
    groupId: msg.groupId,
    timestamp: msg.timestamp,
    type: msg.type || 'text',
    status: msg.status,
    isGroupChat: msg.chatType === 'group',
    attachments: msg.attachments,
    fileName: msg.fileName,
    fileUrl: msg.fileUrl,
    mimeType: msg.mimeType,
    thumbnailUrl: msg.thumbnailUrl,
  });

  const mergeById = (preferred: Message[], incoming: Message[], limit: number): Message[] => {
    const out: Message[] = [];
    const seen = new Set<string>();
    for (const m of preferred) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
      if (out.length >= limit) return out;
    }
    for (const m of incoming) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
      if (out.length >= limit) break;
    }
    return out;
  };

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
    let localResults: Message[] = [];

    try {
      try {
        localResults = await searchActiveChat(keyword, limit);
      } catch {
        localResults = [];
      }

      if (searchRequestSeqRef.current !== requestSeq) return;

      if (localResults.length) {
        setSearchResults(localResults);
        setIsSearchMode(true);
        setIsContextMode(false);
      }

      const targetId = selectedGroup ? selectedGroup.id : selectedContact?.userId;
      if (!targetId) return;

      // Keep server-side search for full-history coverage, but local worker results are shown first.
      const response = await messageAPI.searchMessages(keyword, targetId, limit);
      if (searchRequestSeqRef.current !== requestSeq) return;

      const remoteResults: Message[] = (response.messages || []).map(mapApiMessage);
      const merged = mergeById(localResults, remoteResults, limit);
      setSearchResults(merged);
      setIsSearchMode(true);
      setIsContextMode(false);
    } catch (error: any) {
      console.error('搜索消息失败:', error);
      if (!localResults.length) {
        alert(error.message || '搜索消息失败');
      }
    }
  };

  const clearSearch = async () => {
    setSearchQuery('');
    setIsSearchMode(false);
    setSearchResults([]);
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
    try {
      const response = await messageAPI.getMessageContext(message.chatId, message.seq, 30);
      const contextList: Message[] = (response.messages || []).map(mapApiMessage);

      setContextMessages(contextList);
      setContextHighlightSeq(message.seq);
      setIsContextMode(true);
      setIsSearchMode(false);
    } catch (error: any) {
      console.error('跳转上下文失败:', error);
      alert(error.message || '跳转上下文失败');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || (!selectedContact && !selectedGroup && !isAiChatMode) || !socketConnected) return;

    setIsUploading(true);
    try {
      if (isAiChatMode && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64Data = (e.target?.result as string)?.split(',')[1];
          if (base64Data) {
            const aiMessageData = {
              content: newMessage || '请分析这张图片',
              imageData: {
                mimeType: file.type,
                base64Data: base64Data,
                fileName: file.name,
                fileSize: file.size
              }
            };
            sendMessage(JSON.stringify(aiMessageData), 'ai');
            setNewMessage('');
          }
        };
        reader.readAsDataURL(file);
        setIsUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authUtils.getAccessToken()}` },
        body: formData
      });
      const result = await response.json();

      if (result.success) {
        const fileMessage = {
          receiverId: selectedContact?.userId,
          groupId: selectedGroup?.id,
          content: result.data.fileName,
          type: result.data.fileType,
          fileUrl: result.data.fileUrl,
          fileName: result.data.fileName,
          fileSize: result.data.fileSize,
          mimeType: result.data.mimeType,
          thumbnailUrl: result.data.thumbnailUrl
        };
        if (selectedGroup) {
          sendMessage(JSON.stringify(fileMessage), undefined, selectedGroup.id);
        } else if (selectedContact) {
          sendMessage(JSON.stringify(fileMessage), selectedContact.userId);
        }
      } else {
        throw new Error(result.message || '文件上传失败');
      }
    } catch (error) {
      console.error('上传失败:', error);
      alert('文件上传失败');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const handleSendMessage = (content?: string) => {
    const messageContent = content || newMessage.trim();
    if (messageContent && socketConnected) {
      if (isAiChatMode) {
        sendMessage(`/ai ${messageContent}`, 'ai');
      } else if (selectedGroup) {
        sendMessage(messageContent, undefined, selectedGroup.id);
      } else if (selectedContact) {
        sendMessage(messageContent, selectedContact.userId);
      }
      setNewMessage('');
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
          isConnected={socketConnected}
        isAiChatMode={isAiChatMode}
        pendingRequests={pendingRequests}
        onSelectAiChat={handleSelectAiChat}
        onOpenGroupModal={() => setIsGroupModalOpen(true)}
        onOpenAddContactModal={() => setShowAddContactModal(true)}
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
            onSendMessage={(msg: string, imgData?: any) => {
              const userMock: Message = {
                id: `temp-${Date.now()}`,
                chatId: buildPrivateChatId(currentUser?.id || 'me', 'ai'),
                chatType: 'private',
                content: msg,
                senderId: currentUser?.id || 'me',
                senderUsername: currentUser?.username || '我',
                userId: currentUser?.id || 'me',
                username: currentUser?.username || '我',
                timestamp: new Date().toISOString(),
                type: imgData ? 'image' : 'text',
                status: 'sent',
                isGroupChat: false,
                ...(imgData ? { fileUrl: `data:${imgData.mimeType};base64,${imgData.base64Data}`, fileName: imgData.fileName } : {})
              };
              addMessage(userMock);

              if (imgData) {
                sendMessage(JSON.stringify({ content: msg, imageData: imgData }), 'ai');
              } else {
                sendMessage(msg.startsWith('/ai ') ? msg : `/ai ${msg}`, 'ai');
              }
            }}
              isConnected={socketConnected}
            onBackToContacts={() => {
              setIsAiChatMode(false);
              if (isMobileLayout) {
                setMobilePane('sidebar');
              }
            }}
            onReceiveMessage={(res: any) => {
              const aiMock: Message = {
                id: `ai-${Date.now()}`,
                chatId: buildPrivateChatId(currentUser?.id || 'me', 'ai'),
                chatType: 'private',
                content: res.message,
                senderId: 'ai',
                senderUsername: 'Gemini AI',
                userId: 'ai',
                username: 'Gemini AI',
                timestamp: new Date().toISOString(),
                type: 'text',
                status: 'delivered',
                isGroupChat: false
              };
              addMessage(aiMock);
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
              onSendMessage={handleSendMessage}
              onFileUpload={(file) => {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                if (fileInputRef.current) {
                  fileInputRef.current.files = dataTransfer.files;
                  fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }}
              isConnected={socketConnected}
              isUploading={isUploading}
            />
          }
          showEmptyState={!selectedContact && !selectedChatId}
        >
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
            {...(isSearchMode || isContextMode
              ? { messages: displayedMessages || [] }
              : {
                  messageIds: useMessageStore.getState().messageIds,
                  messageIdsVersion,
                })}
            isLoading={isLoadingMessages}
            hasMore={isSearchMode || isContextMode ? false : hasMoreMessages}
            onLoadMore={isSearchMode || isContextMode ? undefined : loadMoreMessages}
            onVisibleRangeChange={isSearchMode || isContextMode ? undefined : setVisibleRange}
            highlightTerm={searchQuery.trim() ? searchQuery.trim() : undefined}
            highlightSeq={contextHighlightSeq}
            onMessageSelect={isSearchMode ? handleSelectSearchResult : undefined}
            disableAutoScroll={isSearchMode || isContextMode}
          />
        </ChatArea>
      )}

      {/* 3. Detail Panel */}
      {!isMobileLayout && showDetailPanel && !isGroupChatMode && (
        <ChatDetailPanel
          isOpen
          onClose={() => setShowDetailPanel(false)}
          selectedContact={selectedContact}
        />
      )}

      {/* 3.5 Group Detail Panel */}
      {!isMobileLayout && showGroupDetailPanel && isGroupChatMode && (
        <GroupDetailPanel
          isOpen
          onClose={() => setShowGroupDetailPanel(false)}
          group={selectedGroup}
        />
      )}

      {/* 4. Modals */}
      <ChatModals
        showAddContactModal={showAddContactModal}
        isGroupModalOpen={isGroupModalOpen}
        onCloseAddContact={() => setShowAddContactModal(false)}
        onCloseGroupModal={() => setIsGroupModalOpen(false)}
        onContactAdded={() => {
          loadContacts();
          setShowAddContactModal(false);
        }}
        onGroupCreated={() => { }}
      />
    </motion.div>
  );
};

export default ChatPage;
