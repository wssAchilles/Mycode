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
    onMessage,
    onUserOnline,
    onUserOffline,
    onOnlineUsers,
    sendMessage,
    joinRoom,
    leaveRoom,
    markChatRead,
    onReadReceipt,
    onGroupUpdate,
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
  const ingestSocketMessage = useMessageStore((state) => state.ingestSocketMessage);
  const ingestPresenceEvent = useMessageStore((state) => state.ingestPresenceEvent);
  const ingestGroupUpdateEvent = useMessageStore((state) => state.ingestGroupUpdateEvent);
  const loadMoreMessages = useMessageStore((state) => state.loadMoreMessages);
  const setActiveContact = useMessageStore((state) => state.setActiveContact);
  const setSocketConnected = useMessageStore((state) => state.setSocketConnected);

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
  const [isConnected, setIsConnected] = useState(false);
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

  // 组件卸载清理
  useEffect(() => {
    return () => {
      console.log('🧹 ChatPage 组件卸载，清理资源...');
      disconnectSocket();
    };
  }, [disconnectSocket]);

  // 连接状态同步
  useEffect(() => {
    setIsConnected(socketConnected);
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

  // Presence (online/offline) -> forward to worker meta pipeline.
  useEffect(() => {
    const cleanupOnlineUsers = onOnlineUsers((users: any[]) => {
      if (!Array.isArray(users)) return;
      for (const u of users) {
        if (!u?.userId) continue;
        ingestPresenceEvent({ userId: String(u.userId), isOnline: true });
      }
    });

    const cleanupOnline = onUserOnline((user: any) => {
      if (!user?.userId) return;
      ingestPresenceEvent({ userId: String(user.userId), isOnline: true });
    });

    const cleanupOffline = onUserOffline((user: any) => {
      if (!user?.userId) return;
      ingestPresenceEvent({ userId: String(user.userId), isOnline: false });
    });

    return () => {
      if (cleanupOnlineUsers) cleanupOnlineUsers();
      if (cleanupOnline) cleanupOnline();
      if (cleanupOffline) cleanupOffline();
    };
  }, [onOnlineUsers, onUserOnline, onUserOffline, ingestPresenceEvent]);

  // Socket 消息处理
  useEffect(() => {
    const cleanup = onMessage((data: any) => {
      if (data.type !== 'chat' || !data.data) return;
      if (!data.data.content && !data.data.fileUrl && !data.data.attachments) return;

      // Heavy normalization/merge + meta updates are handled in ChatCoreWorker.
      ingestSocketMessage(data.data);

      // ML 安全检查
      const messageId = String(data.data.id || '');
      const senderId = String(data.data.senderId || data.data.userId || 'unknown');
      if (currentUser && senderId === currentUser.id && messageId) {
        mlService.vfCheck(messageId).then(isSafe => {
          if (!isSafe && import.meta.env.DEV) {
            console.warn(`[VF] Message ${messageId} marked unsafe/unavailable.`);
          }
        });
      }
    });

    return () => { if (cleanup) cleanup(); };
  }, [onMessage, ingestSocketMessage, currentUser]);

  // 已读回执处理
  useEffect(() => {
    const cleanup = onReadReceipt((data) => {
      useMessageStore.getState().ingestReadReceiptEvent({
        chatId: data.chatId,
        seq: data.seq,
        readCount: data.readCount,
      });
    });

    return () => { if (cleanup) cleanup(); };
  }, [onReadReceipt]);

  // 群组更新处理
  useEffect(() => {
    const cleanup = onGroupUpdate((data: any) => {
      const groupId = data?.groupId;
      if (!groupId) return;

      // Forward to worker so the sidebar can update via meta patches (no full reload).
      ingestGroupUpdateEvent(data);

      if (data.action === 'member_added') {
        const memberIds = Array.isArray(data.memberIds)
          ? data.memberIds
          : Array.isArray(data.members)
            ? data.members.map((m: any) => m?.user?.id || m?.user?.userId || m?.userId).filter(Boolean)
            : [];
        if (currentUser?.id && memberIds.includes(currentUser.id)) {
          joinRoom(groupId);
        }
      }
      if ((data.action === 'member_removed' || data.action === 'member_left') && data.targetId === currentUser?.id) {
        leaveRoom(groupId);
      }

      // 若当前群组被删除/被移除，则立即清理选中状态（worker 会同步做 removal meta）。
      if (selectedGroup?.id === groupId) {
        if (
          data.action === 'group_deleted' ||
          ((data.action === 'member_removed' || data.action === 'member_left') && data.targetId === currentUser?.id)
        ) {
          useChatStore.getState().selectGroup(null);
          setShowGroupDetailPanel(false);
        }
      }
    });

    return () => { if (cleanup) cleanup(); };
  }, [onGroupUpdate, selectedGroup, currentUser, joinRoom, leaveRoom, ingestGroupUpdateEvent]);

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

  const handleSearchMessages = async () => {
    if (!selectedContact && !selectedGroup) return;
    const keyword = searchQuery.trim();
    if (!keyword) {
      clearSearch();
      return;
    }
    try {
      const targetId = selectedGroup ? selectedGroup.id : selectedContact?.userId;
      const response = await messageAPI.searchMessages(keyword, targetId, 50);
      const results: Message[] = (response.messages || []).map((msg: any) => ({
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
      }));
      setSearchResults(results);
      setIsSearchMode(true);
      setIsContextMode(false);
    } catch (error: any) {
      console.error('搜索消息失败:', error);
      alert(error.message || '搜索消息失败');
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
      const contextList: Message[] = (response.messages || []).map((msg: any) => ({
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
      }));

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
    if (!file || (!selectedContact && !selectedGroup && !isAiChatMode) || !isConnected) return;

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
    if (messageContent && isConnected) {
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
        isConnected={isConnected}
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
              isConnected={isConnected}
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
