/**
 * ChatPage - 主聊天页面 (重构版)
 * 核心职责：状态管理、Socket 消息处理、子组件协调
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { authUtils, messageAPI } from '../services/apiClient';
import { mlService } from '../services/mlService';
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
  const updateContactLastMessage = useChatStore((state) => state.updateContactLastMessage);
  const updateContactOnlineStatus = useChatStore((state) => state.updateContactOnlineStatus);
  const incrementUnread = useChatStore((state) => state.incrementUnread);

  // Message Store (消息管理)
  const messages = useMessageStore((state) => state.messages);
  const isLoadingMessages = useMessageStore((state) => state.isLoading);
  const hasMoreMessages = useMessageStore((state) => state.hasMore);
  const addMessage = useMessageStore((state) => state.addMessage);
  const loadMoreMessages = useMessageStore((state) => state.loadMoreMessages);
  const setActiveContact = useMessageStore((state) => state.setActiveContact);

  // Local State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isAiChatMode, setIsAiChatMode] = useState(false);

  // UI State
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showGroupDetailPanel, setShowGroupDetailPanel] = useState(false);  // 新增
  const [isConnected, setIsConnected] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isContextMode, setIsContextMode] = useState(false);
  const [contextMessages, setContextMessages] = useState<Message[]>([]);
  const [contextHighlightSeq, setContextHighlightSeq] = useState<number | undefined>(undefined);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // 同步选中联系人/群组到 messageStore
  useEffect(() => {
    if (selectedGroup) {
      setActiveContact(selectedGroup.id, true);
    } else {
      setActiveContact(selectedContact?.userId || null, false);
    }
  }, [selectedContact, selectedGroup, setActiveContact]);

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
  }, [socketConnected]);

  // Socket 消息处理
  useEffect(() => {
    const cleanup = onMessage((data: any) => {
      if (data.type === 'chat' && data.data) {
        if (!data.data.content && !data.data.fileUrl && !data.data.attachments) return;

        const inferredGroup = data.data.chatType
          ? data.data.chatType === 'group'
          : !!(data.data.groupId || (data.data.chatId && data.data.chatId.startsWith('g:')) || data.data.isGroupChat);
        const message: Message = {
          id: data.data.id || Date.now().toString(),
          chatId: data.data.chatId,
          chatType: data.data.chatType,
          groupId: data.data.groupId,
          seq: data.data.seq,
          content: data.data.content,
          senderId: data.data.senderId || data.data.userId || 'unknown',
          senderUsername: data.data.senderUsername || data.data.username || '未知用户',
          userId: data.data.userId || data.data.senderId || 'unknown',
          username: data.data.username || data.data.senderUsername || '未知用户',
          receiverId: data.data.receiverId,
          timestamp: data.data.timestamp || new Date().toISOString(),
          type: data.data.type || 'text',
          status: data.data.status || 'delivered',
          isGroupChat: inferredGroup,
          readCount: data.data.readCount,
          attachments: data.data.attachments || undefined,
          fileUrl: data.data.fileUrl,
          fileName: data.data.fileName,
          fileSize: data.data.fileSize,
          mimeType: data.data.mimeType,
          thumbnailUrl: data.data.thumbnailUrl,
        };

        addMessage(message);

        // ML 安全检查
        if (currentUser && message.senderId === currentUser.id) {
          mlService.vfCheck(message.id).then(isSafe => {
            if (!isSafe) {
              console.warn(`[VF] Message ${message.id} flagged as unsafe.`);
            }
          });
        }

        if (message.isGroupChat && message.groupId) {
          updateContactLastMessage(message.groupId, message);
        } else if (message.userId && message.userId !== 'unknown') {
          updateContactLastMessage(message.userId, message);
        }

        if (currentUser && message.senderId !== currentUser.id) {
          const activeChatId = useChatStore.getState().selectedChatId;
          if (message.isGroupChat && message.groupId) {
            if (activeChatId !== message.groupId) incrementUnread(message.groupId);
          } else if (message.userId && message.userId !== 'unknown') {
            if (activeChatId !== message.userId) incrementUnread(message.userId);
          }
        }
      } else if (data.type === 'userOnline') {
        updateContactOnlineStatus(data.userId, true);
      } else if (data.type === 'userOffline') {
        updateContactOnlineStatus(data.userId, false, data.lastSeen);
      }
    });

    return () => { if (cleanup) cleanup(); };
  }, [onMessage, addMessage, updateContactLastMessage, updateContactOnlineStatus, currentUser, incrementUnread]);

  // 已读回执处理
  useEffect(() => {
    const cleanup = onReadReceipt((data) => {
      if (!currentUser) return;
      useMessageStore.getState().applyReadReceipt(data.chatId, data.seq, data.readCount, currentUser.id);
    });

    return () => { if (cleanup) cleanup(); };
  }, [onReadReceipt, currentUser]);

  // 群组更新处理
  useEffect(() => {
    const cleanup = onGroupUpdate((data: any) => {
      const groupId = data?.groupId;
      if (!groupId) return;

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

      // 刷新聊天列表
      useChatStore.getState().loadChats();

      // 若当前群组被更新，则刷新详情
      if (selectedGroup?.id === groupId) {
        if (data.action === 'group_deleted' || (data.action === 'member_removed' && data.targetId === currentUser?.id)) {
          useChatStore.getState().selectGroup(null);
          setShowGroupDetailPanel(false);
        } else {
          useChatStore.getState().loadGroupDetails(groupId);
        }
      }
    });

    return () => { if (cleanup) cleanup(); };
  }, [onGroupUpdate, selectedGroup, currentUser, joinRoom, leaveRoom]);

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

    const lastMessage = messages[messages.length - 1];
    const lastSeq = lastMessage?.seq;
    if (lastSeq && lastSeq > lastReadSeqRef.current) {
      markChatRead(activeChatId, lastSeq);
      lastReadSeqRef.current = lastSeq;
    }
  }, [messages, selectedGroup, selectedContact, currentUser, markChatRead]);

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
        isGroupChat: msg.chatType ? msg.chatType === 'group' : (msg.isGroupChat ?? !!(msg.groupId || (msg.chatId && msg.chatId.startsWith('g:')))),
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
        isGroupChat: msg.chatType ? msg.chatType === 'group' : (msg.isGroupChat ?? !!(msg.groupId || (msg.chatId && msg.chatId.startsWith('g:')))),
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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` },
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
  };

  // Derived Data
  const displayedMessages = isContextMode ? contextMessages : isSearchMode ? searchResults : messages;

  // =====================
  // Render
  // =====================

  return (
    <motion.div
      className="chat-container"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 隐藏的文件输入 */}
      <input
        type="file"
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
      />

      {/* 2. Chat Area */}
      {isAiChatMode ? (
        <div className="main-ai-chat-container">
          <AiChatComponent
            currentUser={currentUser}
            messages={messages}
            onSendMessage={(msg: string, imgData?: any) => {
              const userMock: Message = {
                id: `temp-${Date.now()}`,
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
            onBackToContacts={() => setIsAiChatMode(false)}
            onReceiveMessage={(res: any) => {
              const aiMock: Message = {
                id: `ai-${Date.now()}`,
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
                  <button className="chat-context-bar__btn" onClick={() => {
                    setIsContextMode(false);
                    setContextMessages([]);
                    setContextHighlightSeq(undefined);
                    setIsSearchMode(true);
                  }}>
                    返回搜索
                  </button>
                )}
                <button className="chat-context-bar__btn ghost" onClick={clearSearch}>
                  退出
                </button>
              </div>
            </div>
          )}
          <ChatHistory
            currentUserId={currentUser?.id || ''}
            messages={displayedMessages}
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
      <ChatDetailPanel
        isOpen={showDetailPanel && !isGroupChatMode}
        onClose={() => setShowDetailPanel(false)}
        selectedContact={selectedContact}
      />

      {/* 3.5 Group Detail Panel */}
      <GroupDetailPanel
        isOpen={showGroupDetailPanel && isGroupChatMode}
        onClose={() => setShowGroupDetailPanel(false)}
        group={selectedGroup}
      />

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
