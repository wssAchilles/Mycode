import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { authAPI, authUtils, messageAPI } from '../services/apiClient';
import { mlService } from '../services/mlService';
import { useSocket } from '../hooks/useSocket';
import { AddContactModal } from '../components/AddContactModal';
import AiChatComponent from '../components/AiChatComponent';
import type { User } from '../types/auth';
import type { Message } from '../types/chat';

// Zustand Stores
import { useChatStore } from '../features/chat/store/chatStore';
import { useMessageStore } from '../features/chat/store/messageStore';

// Import new UI components
import { Sidebar, ChatArea, DetailPanel, DetailSection } from '../components/layout';
import { Avatar } from '../components/common';
import ChatListContainer from '../features/chat/ChatListContainer';
import ChatHeader from '../features/chat/components/ChatHeader';
import MessageInput from '../features/chat/components/MessageInput';
import ChatHistory from '../features/chat/components/ChatHistory';
import CreateGroupModal from '../features/chat/components/CreateGroupModal';
// import { ContactCard } from '../components/chat'; // Deprecated

import '../pages/ChatPage.css';

// API Configuration
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
    sendMessage
  } = useSocket();

  // Chat Store (联系人管理)
  const contacts = useChatStore((state) => state.contacts);
  const selectedContact = useChatStore((state) => state.selectedContact);
  const selectedChatId = useChatStore((state) => state.selectedChatId);
  const pendingRequests = useChatStore((state) => state.pendingRequests);
  const loadContacts = useChatStore((state) => state.loadContacts);
  const loadPendingRequests = useChatStore((state) => state.loadPendingRequests);
  const selectContact = useChatStore((state) => state.selectContact);
  const handleContactRequest = useChatStore((state) => state.handleContactRequest);
  const updateContactLastMessage = useChatStore((state) => state.updateContactLastMessage);
  const updateContactOnlineStatus = useChatStore((state) => state.updateContactOnlineStatus);

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
  const [isConnected, setIsConnected] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[]>([]);


  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialization
  useEffect(() => {
    const initializeUser = async () => {
      try {
        const localUser = authUtils.getCurrentUser();
        if (localUser) {
          setCurrentUser(localUser);
          console.log('🎉 ChatPage 成功渲染，当前用户:', localUser.username);
          initializeSocket();
          // 初始化 stores
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

  // 当选中联系人变化时，同步到 messageStore
  useEffect(() => {
    setActiveContact(selectedContact?.userId || null);
  }, [selectedContact, setActiveContact]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 ChatPage 组件卸载，清理资源...');
      disconnectSocket();
    };
  }, [disconnectSocket]);

  // Connection Status Sync
  useEffect(() => {
    setIsConnected(socketConnected);
  }, [socketConnected]);

  // Socket Message Handler
  useEffect(() => {
    const cleanup = onMessage((data: any) => {
      if (data.type === 'chat' && data.data) {
        if (!data.data.content) return;

        const message: Message = {
          id: data.data.id || Date.now().toString(),
          content: data.data.content,
          senderId: data.data.senderId || data.data.userId || 'unknown',
          senderUsername: data.data.senderUsername || data.data.username || '未知用户',
          userId: data.data.userId || data.data.senderId || 'unknown',
          username: data.data.username || data.data.senderUsername || '未知用户',
          timestamp: data.data.timestamp || new Date().toISOString(),
          type: data.data.type || 'text',
          status: data.data.status || 'delivered',
          isGroupChat: false,
        };

        addMessage(message);

        // 🧠 ML Verification: Check safety of sent messages
        if (currentUser && message.senderId === currentUser.id) {
          // Async check (don't block UI)
          mlService.vfCheck(message.id).then(isSafe => {
            if (!isSafe) {
              // In a real app, we might obscure the message or show a toast.
              // For now, we alert (or could insert a system message)
              console.warn(`[VF] Message ${message.id} flagged as unsafe.`);
              // Update message status locally to indicate warning? 
              // Access store to update? For now just log/warn.
              // alert(`⚠️ 安全警告: 您的消息被 Phoenix 模型标记为敏感内容`);
            }
          });
        }

        if (message.userId && message.userId !== 'unknown') {
          updateContactLastMessage(message.userId, message);
        }
      } else if (data.type === 'userOnline') {
        updateContactOnlineStatus(data.userId, true);
      } else if (data.type === 'userOffline') {
        updateContactOnlineStatus(data.userId, false, data.lastSeen);
      }
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [onMessage, addMessage, updateContactLastMessage, updateContactOnlineStatus, currentUser]);

  // Search Logic
  const handleSearchMessages = async () => {
    if (!selectedContact) return;
    const keyword = searchQuery.trim();
    if (!keyword) {
      clearSearch();
      return;
    }
    try {
      const response = await messageAPI.searchMessages(keyword, selectedContact.userId, 50);
      const results: Message[] = (response.messages || []).map((msg: any) => ({
        id: msg.id,
        content: msg.content,
        senderId: msg.senderId,
        senderUsername: msg.senderUsername,
        userId: msg.senderId,
        username: msg.senderUsername,
        receiverId: msg.receiverId,
        timestamp: msg.timestamp,
        type: msg.type || 'text',
        status: msg.status,
        isGroupChat: msg.isGroupChat || false,
      }));
      setSearchResults(results);
      setIsSearchMode(true);
    } catch (error: any) {
      console.error('搜索消息失败:', error);
      alert(error.message || '搜索消息失败');
    }
  };

  const clearSearch = async () => {
    setSearchQuery('');
    setIsSearchMode(false);
    setSearchResults([]);
    if (selectedContact) {
      await selectContact(selectedContact);
    }
  };

  // File Upload Handler
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || (!selectedContact && !isAiChatMode) || !isConnected) return;

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
            const aiMessage = JSON.stringify({
              content: aiMessageData.content,
              imageData: aiMessageData.imageData
            });
            sendMessage(aiMessage, 'ai');
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
          receiverId: selectedContact!.userId,
          content: result.data.fileName,
          type: result.data.fileType,
          fileUrl: result.data.fileUrl,
          fileName: result.data.fileName,
          fileSize: result.data.fileSize,
          mimeType: result.data.mimeType,
          thumbnailUrl: result.data.thumbnailUrl
        };
        sendMessage(JSON.stringify(fileMessage), selectedContact!.userId);
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
        const aiMessage = `/ai ${messageContent}`;
        sendMessage(aiMessage, 'ai');
      } else if (selectedContact) {
        sendMessage(messageContent, selectedContact.userId);
      }
      setNewMessage('');
    }
  };


  // Derived Data
  const displayedMessages = isSearchMode ? searchResults : messages;


  // 隐藏的文件输入（保留用于文件上传）
  const hiddenFileInput = (
    <input
      type="file"
      ref={fileInputRef}
      onChange={handleFileUpload}
      style={{ display: 'none' }}
      accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.zip"
    />
  );

  return (
    <motion.div
      className="chat-container"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Hidden file input for uploads */}
      {hiddenFileInput}
      {/* 1. Sidebar */}
      <Sidebar className="chat-sidebar" width={320}>
        {/* Header */}
        <div className="sidebar-header">
          <button
            className="back-to-space-btn"
            onClick={() => navigate('/space')}
            title="返回 Space"
            style={{
              marginRight: '12px',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="user-info" style={{ flex: 1, minWidth: 0 }}>
            <Avatar name={currentUser?.username || '?'} src={currentUser?.avatarUrl} size="md" online={isConnected} />
            <div className="user-details" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.username}</h3>
              <span className={`status ${isConnected ? 'online' : 'offline'}`}>{isConnected ? '在线' : '离线'}</span>
            </div>
          </div>
          <button className="logout-button" onClick={async () => { await authAPI.logout(); navigate('/login'); }} title="退出登录">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>

        <div className="chat-list-header" style={{ padding: '0 10px 10px 10px' }}>
          <button
            onClick={() => setIsGroupModalOpen(true)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#f4f4f5',
              color: '#3390ec',
              cursor: 'pointer',
              fontWeight: 500,
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <span style={{ fontSize: '18px' }}>+</span> 新建群组
          </button>
        </div>

        {/* AI Entry */}
        <div onClick={() => { setIsAiChatMode(true); selectContact(null); }} className={`tg-contact-card ${isAiChatMode ? 'tg-contact-card--selected' : ''} tg-contact-card--ai`}>
          <div className="tg-contact-card__avatar">
            <div className="ai-avatar">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                <circle cx="12" cy="5" r="2"></circle>
                <path d="M12 7v4"></path>
                <line x1="8" y1="16" x2="8" y2="16"></line>
                <line x1="16" y1="16" x2="16" y2="16"></line>
              </svg>
            </div>
            <span className="tg-contact-card__ai-badge">AI</span>
          </div>
          <div className="tg-contact-card__info">
            <div className="tg-contact-card__top">
              <span className="tg-contact-card__name">Gemini AI 助手</span>
            </div>
            <div className="tg-contact-card__bottom">
              <span className="tg-contact-card__message">点击开始智能对话</span>
            </div>
          </div>
        </div>

        {/* Pending Requests */}
        {pendingRequests.map(req => (
          <div key={req.id} className="pending-request">
            <div className="pending-request__info">
              <Avatar name={req.username} size="sm" />
              <div className="pending-request__details">
                <div className="pending-request__name">{req.alias || req.username}</div>
                <div className="pending-request__label">请求添加好友</div>
              </div>
            </div>
            <div className="pending-request__actions">
              <button onClick={() => handleContactRequest(req.id, 'accept')} className="pending-request__btn pending-request__btn--accept">接受</button>
              <button onClick={() => handleContactRequest(req.id, 'reject')} className="pending-request__btn pending-request__btn--reject">拒绝</button>
            </div>
          </div>
        ))}

        {/* Contact List using New Generic ChatList */}
        <div className="contact-list" style={{ flex: 1, height: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ChatListContainer
            onChatSelected={(chatId) => {
              // 统一从 chats 列表查找（无论是联系人还是群组）
              const chat = useChatStore.getState().chats.find(c => c.id === chatId);
              if (chat) {
                setIsAiChatMode(false);
                // 1. 更新 ChatStore 选中状态
                if (chat.isGroup) {
                  useChatStore.getState().selectChat(chatId);
                  // 对于群组，我们不需要 selectContact(null)，因为 loadMessages 需要 activeContactId (这里复用为 chatId)
                  // 但为了保持兼容，我们可以暂时通过 selectContact(null) 清除联系人详情，
                  // 并通过 messageStore.setActiveContact(chatId, true) 加载群消息。
                  // 不过更好的方式是 chatStore 也支持 selectChat 并暴露 activeChat 对象。
                  // 这里的 selectContact 目前是设置 selectedContact | null。
                  // 让我们修改逻辑：
                  useChatStore.setState({ selectedContact: null, selectedChatId: chatId });
                } else {
                  // 尝试从 contacts 列表找详细信息 (用于详情页显示)
                  const contact = contacts.find(c => c.userId === chatId);
                  selectContact(contact || null);
                }

                // 2. 更新 MessageStore 加载消息
                setActiveContact(chatId, chat.isGroup);
              }
            }}
          />
        </div>

        <div className="sidebar-footer">
          <button onClick={() => setShowAddContactModal(true)} className="add-contact-btn" title="添加联系人">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <line x1="20" y1="8" x2="20" y2="14"></line>
              <line x1="23" y1="11" x2="17" y2="11"></line>
            </svg>
          </button>
        </div>
      </Sidebar>

      {/* 2. Chat Area */}
      {isAiChatMode ? (
        <div style={{ flex: 1, background: '#0f1419' }}>
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
                const aiData = { content: msg, imageData: imgData };
                sendMessage(JSON.stringify(aiData), 'ai');
              } else {
                const aiMsg = msg.startsWith('/ai ') ? msg : `/ai ${msg}`;
                sendMessage(aiMsg, 'ai');
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
              onAvatarClick={() => setShowDetailPanel(true)}
            />
          }
          footer={
            <MessageInput
              onSendMessage={handleSendMessage}
              onFileUpload={(file) => {
                // 创建一个模拟事件对象来复用现有逻辑
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
          <ChatHistory
            currentUserId={currentUser?.id || ''}
            messages={displayedMessages}
            isLoading={isLoadingMessages}
            hasMore={hasMoreMessages}
            onLoadMore={loadMoreMessages}
          />
        </ChatArea>
      )}

      {/* 3. Detail Panel */}
      <DetailPanel
        isOpen={showDetailPanel}
        onClose={() => setShowDetailPanel(false)}
        title="详细信息"
      >
        {selectedContact && (
          <>
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <Avatar src={selectedContact.avatarUrl} name={selectedContact.alias || selectedContact.username} size="lg" />
              <h2 style={{ marginTop: '12px', color: '#fff' }}>{selectedContact.alias || selectedContact.username}</h2>
              <p style={{ color: '#8596a8' }}>@{selectedContact.username}</p>
            </div>

            <DetailSection title="共享媒体" collapsible defaultCollapsed>
              <div style={{ padding: '10px', color: '#8596a8', textAlign: 'center' }}>暂无媒体文件</div>
            </DetailSection>

            <DetailSection title="设置" collapsible>
              <div style={{ padding: '10px' }}>
                <div style={{ padding: '8px', color: '#ff6b6b', cursor: 'pointer' }}>删除联系人</div>
                <div style={{ padding: '8px', color: '#ff6b6b', cursor: 'pointer' }}>屏蔽用户</div>
              </div>
            </DetailSection>
          </>
        )}
      </DetailPanel>

      <AddContactModal
        isOpen={showAddContactModal}
        onClose={() => setShowAddContactModal(false)}
        onContactAdded={() => {
          loadContacts();
          setShowAddContactModal(false);
        }}
      />

      {/* Group Creation Modal */}
      <CreateGroupModal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
        onGroupCreated={() => {
          // loadChats is already called inside createGroup in store
          // We could forcefully reload if needed: useChatStore.getState().loadChats();
        }}
      />

    </motion.div>
  );
};

export default ChatPage;
