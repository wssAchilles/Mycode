import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI, authUtils, messageAPI } from '../services/apiClient';
import { useSocket } from '../hooks/useSocket';
import { useChat } from '../hooks/useChat';
import { AddContactModal } from '../components/AddContactModal';
import AiChatComponent from '../components/AiChatComponent';
import type { User } from '../types/auth'; // Ensure types exist
import type { Message } from '../types/chat'; // Ensure types exist

// Import new UI components
import { Sidebar, ChatArea, DetailPanel, DetailSection } from '../components/layout';
import { ContactCard, Avatar, MessageBubble } from '../components/chat';

import '../pages/ChatPage.css';

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    isConnected: socketConnected,
    initializeSocket,
    disconnectSocket,
    onMessage,
    sendMessage
  } = useSocket();

  const {
    contacts,
    messages,
    selectedContact,
    isLoadingContacts,
    isLoadingMessages,
    loadContacts,
    selectContact,
    addMessage,
    loadMoreMessages,
    hasMoreMessages,
    updateContactLastMessage,
    updateContactOnlineStatus,
    pendingRequests,
    // isLoadingPendingRequests, // Unused
    // error, // Unused
    handleContactRequest
  } = useChat();

  // Local State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [isAiChatMode, setIsAiChatMode] = useState(false);

  // UI State
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  // const [isSearching, setIsSearching] = useState(false); // Unused

  // Emoji Picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // const emojiPickerRef = useRef<HTMLDivElement>(null); // Unused

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Initialization
  useEffect(() => {
    const initializeUser = async () => {
      try {
        const localUser = authUtils.getCurrentUser();
        if (localUser) {
          setCurrentUser(localUser);
          console.log('🎉 ChatPage 成功渲染，当前用户:', localUser.username);
          initializeSocket();
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
  }, [navigate, initializeSocket]);

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
  }, [onMessage, addMessage, updateContactLastMessage, updateContactOnlineStatus]);

  // Scroll handling
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom, isAiChatMode]); // Scroll when mode changes too

  // Search Logic
  const handleSearchMessages = async () => {
    if (!selectedContact) return;
    const keyword = searchQuery.trim();
    if (!keyword) {
      clearSearch();
      return;
    }
    // setIsSearching(true);
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
    } finally {
      // setIsSearching(false);
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
      // AI Image logic
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

      // Normal File Upload
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

  const handleSendMessage = () => {
    if (newMessage.trim() && isConnected) {
      if (isAiChatMode) {
        const aiMessage = `/ai ${newMessage.trim()}`;
        sendMessage(aiMessage, 'ai');
      } else if (selectedContact) {
        sendMessage(newMessage.trim(), selectedContact.userId);
      }
      setNewMessage('');
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // Derived Data
  const displayedMessages = isSearchMode ? searchResults : messages;

  // --- RENDER HELPERS ---

  const renderHeader = () => {
    if (isAiChatMode) {
      return (
        <div className="chat-area-header-content" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="tg-avatar tg-avatar--md" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            🤖
          </div>
          <div>
            <div style={{ color: '#fff', fontWeight: 600 }}>Gemini AI 助手</div>
            <div style={{ color: '#50a803', fontSize: '13px' }}>Always Online</div>
          </div>
        </div>
      );
    }

    if (selectedContact) {
      return (
        <div className="chat-area-header-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => setShowDetailPanel(true)}>
            <Avatar
              src={selectedContact.avatarUrl}
              name={selectedContact.alias || selectedContact.username}
              status={selectedContact.isOnline ? 'online' : 'offline'}
              size="md"
            />
            <div>
              <div style={{ color: '#fff', fontWeight: 600 }}>{selectedContact.alias || selectedContact.username}</div>
              <div style={{ color: '#8596a8', fontSize: '13px' }}>
                {selectedContact.isOnline ? '在线' : '离线'}
              </div>
            </div>
          </div>
          {/* Search Bar Inline */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ background: '#0f1419', borderRadius: '18px', padding: '6px 12px', display: 'flex', alignItems: 'center' }}>
              <span style={{ marginRight: '6px' }}>🔍</span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchMessages()}
                placeholder="搜索..."
                style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '120px' }}
              />
            </div>
          </div>
        </div>
      );
    }
    return null; // Should confirm if header is needed when no contact selected (handled by showEmptyState)
  };

  const renderFooter = () => {
    const commonEmojis = ['😀', '😁', '😂', '🤣', '😄', '😅', '😆', '😉', '😊', '😋', '😍', '🥰', '😘', '😙', '😚', '❤️', '👍', '🔥', '🎉'];

    return (
      <div className="message-input-container" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', width: '100%' }}>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          style={{ display: 'none' }}
          accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.zip"
        />

        <button className="tg-icon-button" onClick={() => fileInputRef.current?.click()} disabled={!isConnected || isUploading}>
          {isUploading ? '⌛' : '📎'}
        </button>

        <div style={{ position: 'relative' }}>
          <button className="tg-icon-button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} disabled={!isConnected}>😊</button>
          {showEmojiPicker && (
            <div style={{ position: 'absolute', bottom: '50px', left: 0, background: '#1c242d', border: '1px solid #2f3e4c', borderRadius: '12px', padding: '10px', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px', zIndex: 100 }}>
              {commonEmojis.map(e => <button key={e} onClick={() => handleEmojiSelect(e)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>{e}</button>)}
            </div>
          )}
        </div>

        <div className="message-input-wrapper" style={{ flex: 1, background: '#0f1419', borderRadius: '20px', padding: '10px 16px' }}>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            placeholder="输入消息..."
            disabled={!isConnected}
            style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', outline: 'none' }}
          />
        </div>

        <button
          className="tg-icon-button send-button"
          onClick={handleSendMessage}
          disabled={!isConnected || !newMessage.trim()}
          style={{ background: isConnected && newMessage.trim() ? '#5568c0' : '#2f3e4c', borderRadius: '50%', color: 'white', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          🚀
        </button>
      </div>
    );
  };

  return (
    <div className="chat-container">
      {/* 1. Sidebar */}
      <Sidebar className="chat-sidebar" width={320}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="user-info">
            <Avatar name={currentUser?.username || '?'} src={currentUser?.avatarUrl} size="md" status={isConnected ? 'online' : 'offline'} />
            <div className="user-details">
              <h3>{currentUser?.username}</h3>
              <span className={`status ${isConnected ? 'online' : 'offline'}`}>{isConnected ? '在线' : '离线'}</span>
            </div>
          </div>
          <button className="logout-button" onClick={async () => { await authAPI.logout(); navigate('/login'); }} title="退出登录">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>

        {/* AI Entry */}
        <div onClick={() => { setIsAiChatMode(true); selectContact(null); }} className={`tg-contact-card ${isAiChatMode ? 'tg-contact-card--selected' : ''} tg-contact-card--ai`}>
          <div className="tg-contact-card__avatar">
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🤖</div>
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
          <div key={req.id} style={{ padding: '8px', borderBottom: '1px solid #2f3e4c', background: 'rgba(239, 68, 68, 0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Avatar name={req.username} size="sm" />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: '14px' }}>{req.alias || req.username}</div>
                <div style={{ color: '#aaa', fontSize: '12px' }}>请求添加好友</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
              <button onClick={() => handleContactRequest(req.id, 'accept')} style={{ flex: 1, padding: '4px', background: '#22c55e', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>接受</button>
              <button onClick={() => handleContactRequest(req.id, 'reject')} style={{ flex: 1, padding: '4px', background: '#ef4444', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>拒绝</button>
            </div>
          </div>
        ))}

        {/* Contact List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoadingContacts ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#8596a8' }}>加载中...</div>
          ) : contacts.map(contact => (
            <ContactCard
              key={contact.id}
              id={contact.id}
              name={contact.alias || contact.username}
              avatar={contact.avatarUrl}
              lastMessage={contact.lastMessage?.content}
              lastMessageTime={contact.lastMessage ? new Date(contact.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              unreadCount={contact.unreadCount}
              status={contact.isOnline ? 'online' : 'offline'}
              isSelected={selectedContact?.id === contact.id && !isAiChatMode}
              onClick={() => {
                setIsAiChatMode(false);
                selectContact(contact);
              }}
            />
          ))}
          {contacts.length === 0 && !isLoadingContacts && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8596a8' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>👥</div>
              暂停没有任何联系人，点击上方 + 添加
            </div>
          )}
        </div>

        <div style={{ padding: '16px', borderTop: '1px solid #2f3e4c' }}>
          <button
            onClick={() => setShowAddContactModal(true)}
            style={{ width: '100%', padding: '10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
          >
            添加联系人
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
              // Mock sending message to UI
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
          header={renderHeader()}
          footer={renderFooter()}
          showEmptyState={!selectedContact}
        >
          <div
            ref={messagesContainerRef}
            className="messages-scroll-container"
            onScroll={(e) => {
              const { scrollTop } = e.currentTarget;
              if (scrollTop === 0 && hasMoreMessages && !isLoadingMessages) {
                loadMoreMessages();
              }
            }}
            style={{ height: '100%', overflowY: 'auto', padding: '0 20px' }}
          >
            {isLoadingMessages && <div style={{ textAlign: 'center', color: '#888', padding: '10px' }}>加载更多消息...</div>}

            {displayedMessages.map(msg => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={msg.userId === currentUser?.id || msg.senderId === currentUser?.id}
                showAvatar={msg.userId !== currentUser?.id && msg.senderId !== currentUser?.id}
                senderName={msg.senderUsername || msg.username}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ChatArea>
      )}

      {/* 3. Detail Panel (Right Sidebar) */}
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
    </div>
  );
};

export default ChatPage;
