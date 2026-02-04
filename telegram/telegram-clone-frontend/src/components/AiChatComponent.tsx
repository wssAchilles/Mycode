import React, { useState, useEffect, useRef } from 'react';
import { ChatArea } from './layout';
import '../features/chat/components/ChatHeader.css';
import './AiChatComponent.css';
import { motion, AnimatePresence } from 'framer-motion';
import { AiSuggestionChips } from './ai/AiSuggestionChips';
import { TypingIndicator } from './chat/TypingIndicator';
import MessageBubble from './common/MessageBubble';
import AiConversationList from './AiConversationList';
import type { Message } from '../types/chat';
import aiSocketService from '../services/aiSocketService';
import { mlService } from '../services/mlService';
import { useAiChatStore } from '../features/chat/store/aiChatStore';
import { useMessageStore } from '../features/chat/store/messageStore';
import { aiChatAPI } from '../services/aiChatAPI';
import { buildPrivateChatId } from '../utils/chat';

interface AiChatComponentProps {
  currentUser: any;
  messages?: Message[];
  onSendMessage?: (message: string, imageData?: any) => void;
  isConnected?: boolean;
  onBackToContacts?: () => void;
  onReceiveMessage?: (message: any) => void;
}

const AiChatComponent: React.FC<AiChatComponentProps> = (props) => {
  const {
    currentUser,
    messages = [],
    onSendMessage,
    isConnected: propIsConnected = false,
    onBackToContacts,
    onReceiveMessage
  } = props;

  // HTTP 通道始终可用，socket 为可选
  const isConnected = true;
  const [socketConnected, setSocketConnected] = useState(propIsConnected);
  const [newMessage, setNewMessage] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showConversationList] = useState(true);

  // AI Chat Store 状态
  const {
    currentMessages: storeMessages,
    createNewConversation,
    selectConversation,
    loadConversations
  } = useAiChatStore();
  const clearMessages = useMessageStore((state) => state.clearMessages);

  // 自动滚动到底部（仅在容器内滚动，避免影响父容器）
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // 检测AI是否在回复中，并获取智能建议
  useEffect(() => {
    if (!currentUser || !currentUser.id) return;

    const lastMessage = messages[messages.length - 1];

    // 如果最后一条是AI发的，或者是别人的消息（非当前用户），则获取建议
    if (lastMessage && lastMessage.senderId !== currentUser.id) {
      // Fetch smart replies
      setLoadingSuggestions(true);
      // import mlService inside or at top level. Assuming imported.
      // We will fix imports in next step if needed.
      mlService.getSmartReplies(lastMessage.content)
        .then((items: string[]) => {
          setSuggestions(items.map((text: string, idx: number) => ({ id: `s-${idx}`, text })));
        })
        .catch((err: any) => console.error(err))
        .finally(() => setLoadingSuggestions(false));
    }

    if (lastMessage && lastMessage.senderId === currentUser.id && lastMessage.content && lastMessage.content.startsWith('/ai ')) {
      setIsTyping(true);
      const timeout = setTimeout(() => setIsTyping(false), 30000);
      return () => clearTimeout(timeout);
    } else if (lastMessage && lastMessage.senderUsername === 'Gemini AI') {
      setIsTyping(false);
    }
  }, [messages, currentUser]);

  // 连接AI Socket.IO服务器
  useEffect(() => {
    aiSocketService.connect();

    const handleConnectionChange = (connected: boolean) => {
      console.log(`🔌 AI Socket.IO 连接状态变更: ${connected ? '已连接' : '已断开'}`);
      setSocketConnected(connected);
    };

    const handleAiResponse = (response: any) => {
      console.log('📩 收到AI响应:', response);
      setIsTyping(false);
      if (onReceiveMessage) {
        onReceiveMessage(response);
      }
    };

    aiSocketService.addConnectionListener(handleConnectionChange);
    aiSocketService.addMessageListener(handleAiResponse);

    return () => {
      aiSocketService.removeConnectionListener(handleConnectionChange);
      aiSocketService.removeMessageListener(handleAiResponse);
    };
  }, []);

  // 发送AI消息
  const handleSendMessage = () => {
    if (!newMessage.trim() || !onSendMessage) return;
    const aiMessage = newMessage.startsWith('/ai ') ? newMessage : `/ai ${newMessage}`;
    // 只通过父组件回调发送，父组件会处理 socket 并添加消息到 store
    onSendMessage(aiMessage);
    setNewMessage('');
  };

  const handleSuggestionClick = (text: string) => {
    const aiMessage = `/ai ${text}`;
    // 只通过父组件回调发送
    onSendMessage && onSendMessage(aiMessage);
    setSuggestions([]); // Clear suggestions after click
  };

  // 新建AI聊天
  const handleStartNewChat = async () => {
    if (isStartingNewChat) return;
    setIsStartingNewChat(true);
    try {
      const messagesForArchive = displayMessages
        .filter((msg) => msg.content && msg.content.trim())
        .map((msg) => ({
          role: msg.senderUsername === 'Gemini AI' ? 'assistant' as const : 'user' as const,
          content: msg.content.startsWith('/ai ') ? msg.content.slice(4) : msg.content,
          timestamp: msg.timestamp,
          type: msg.type === 'image' ? 'image' as const : 'text' as const,
          imageData: (msg as any).fileUrl && (msg as any).mimeType?.startsWith('image/')
            ? {
              mimeType: (msg as any).mimeType,
              fileName: (msg as any).fileName || 'image',
              fileSize: (msg as any).fileSize || 0
            }
            : undefined
        }));

      if (messagesForArchive.length > 0) {
        await aiChatAPI.archiveConversation(messagesForArchive);
        await loadConversations();
      }

      clearMessages();
      createNewConversation();
      console.log('✅ 新建AI聊天成功');
    } catch (error: any) {
      console.error('❌ 新建AI聊天失败:', error);
    } finally {
      setIsStartingNewChat(false);
    }
  };

  // 文件上传处理
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onSendMessage) return;

    setIsUploading(true);
    try {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const base64Data = (e.target?.result as string)?.split(',')[1];
            if (base64Data) {
              const imageData = {
                mimeType: file.type,
                base64Data: base64Data,
                fileName: file.name,
                fileSize: file.size
              };
              const message = newMessage.trim() || '请分析这张图片';
              const aiMessage = message.startsWith('/ai ') ? message : `/ai ${message}`;
              // 只通过父组件回调发送
              onSendMessage(aiMessage, imageData);
              setNewMessage('');
            }
          } catch (error) {
            console.error('❌ AI图片处理失败:', error);
            alert('图片处理失败，请重试');
          } finally {
            setIsUploading(false);
          }
        };
        reader.readAsDataURL(file);
      } else {
        alert('当前仅支持图片文件');
        setIsUploading(false);
      }
    } catch (error) {
      console.error('❌ 文件上传失败:', error);
      setIsUploading(false);
    } finally {
      event.target.value = '';
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const aiMessages = messages.filter(msg =>
    (msg.senderId === currentUser?.id && msg.content.startsWith('/ai ')) ||
    msg.senderUsername === 'Gemini AI'
  );

  // 构建头部内容
  const headerContent = (
    <>
      <div className="chat-header__info">
        {onBackToContacts && (
          <button
            onClick={onBackToContacts}
            className="tg-icon-button"
            style={{ width: 32, height: 32, marginRight: 8, color: 'var(--tg-text-secondary)' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
        )}
        <div className="chat-header__avatar chat-header__avatar--ai">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2"></rect>
            <circle cx="12" cy="5" r="2"></circle>
            <path d="M12 7v4"></path>
            <line x1="8" y1="16" x2="8" y2="16"></line>
            <line x1="16" y1="16" x2="16" y2="16"></line>
          </svg>
        </div>
        <div className="chat-header__details">
          <div className="chat-header__name">Gemini AI 助手</div>
          <div className="chat-header__status chat-header__status--online">
            {(socketConnected || isConnected) ? 'Online' : 'Offline'} • Google Gemini
          </div>
        </div>
      </div>

      <div className="chat-header__actions">
        <button
          onClick={handleStartNewChat}
          disabled={isStartingNewChat}
          style={{
            background: 'rgba(51, 144, 236, 0.1)',
            border: '1px solid rgba(51, 144, 236, 0.3)',
            color: 'var(--tg-blue)',
            borderRadius: '16px',
            padding: '6px 12px',
            fontSize: '13px',
            cursor: isStartingNewChat ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: isStartingNewChat ? 0.7 : 1,
            fontWeight: 500
          }}
        >
          {isStartingNewChat ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          )}
          新建聊天
        </button>
      </div>
    </>
  );

  // 构建底部输入内容
  const footerContent = (
    <div className="message-input-container">
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="tg-icon-button"
        title="上传图片"
      >
        {isUploading ? '⌛' : '🖼️'}
      </button>

      <div className="message-input-wrapper">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={isUploading ? '正在处理图片...' : '向 AI 提问或上传图片...'}
          disabled={isUploading}
          autoFocus
        />
      </div>

      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" style={{ display: 'none' }} />

      <button
        onClick={handleSendMessage}
        disabled={!newMessage.trim() || isUploading}
        className={`tg-icon-button send-button`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
      </button>
    </div>
  );

  // 使用 store 消息或传入的消息
  const displayMessages = storeMessages.length > 0 ? storeMessages.map(m => ({
    id: m.id,
    chatId: buildPrivateChatId(currentUser?.id || 'me', 'ai'),
    chatType: 'private' as const,
    content: m.content,
    senderId: m.role === 'user' ? (currentUser?.id || 'me') : 'ai',
    senderUsername: m.role === 'user' ? (currentUser?.username || '我') : 'Gemini AI',
    timestamp: m.timestamp,
    type: m.type,
    status: 'sent' as const,
    isGroupChat: false
  })) : aiMessages;

  // 处理会话选择
  const handleConversationSelect = (conversationId: string) => {
    selectConversation(conversationId);
  };

  return (
    <div className="ai-chat-wrapper" style={{ display: 'flex', height: '100%', width: '100%' }}>
      {/* 左侧会话列表 */}
      {showConversationList && (
        <div className="ai-conversation-sidebar" style={{ width: '280px', flexShrink: 0 }}>
          <AiConversationList
            onSelectConversation={handleConversationSelect}
            onNewConversation={() => createNewConversation()}
          />
        </div>
      )}

      {/* 右侧聊天区域 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <ChatArea
          header={headerContent}
          footer={footerContent}
          className="ai-chat-area"
        >
          {displayMessages.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', textAlign: 'center' }}>
              <div style={{
                width: 80, height: 80,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 40,
                boxShadow: '0 10px 30px rgba(118, 75, 162, 0.4)',
                marginBottom: 16
              }}>
                🤖
              </div>
              <h3 style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: 'var(--color-text-primary)' }}>与 AI 助手对话</h3>
              <div style={{ maxWidth: '320px', fontSize: '15px', color: 'var(--color-text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                直接输入您的问题，探索 AI 的无限可能。<br />无需添加 "/ai" 前缀。
              </div>
              <AiSuggestionChips onSelect={(suggestion) => setNewMessage(suggestion.text)} />
            </div>
          ) : (
            <div ref={messagesContainerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
              <AnimatePresence initial={false}>
                {displayMessages.map((msg, index) => {
                  const isOwnMessage = msg.senderId === currentUser?.id || msg.senderId === 'me';
                  const isAiMessage = msg.senderUsername === 'Gemini AI';
                  const hasImage = (msg as any).fileUrl && ((msg as any).mimeType?.startsWith('image/') || (msg as any).fileUrl.startsWith('data:image'));
                  const hasFile = (msg as any).fileUrl && !hasImage;

                  const displayContent = isOwnMessage && msg.content.startsWith('/ai ')
                    ? msg.content.substring(4)
                    : msg.content;

                  return (
                    <motion.div
                      key={msg.id || index}
                      initial={{ opacity: 0, scale: 0.9, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                      style={{ display: 'flex', justifyContent: isOwnMessage ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '8px', marginBottom: '10px' }}
                      className={isOwnMessage ? 'msg-user' : 'msg-ai'}
                    >
                      {isAiMessage && (
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0, boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
                          🤖
                        </div>
                      )}

                      <MessageBubble
                        isOut={isOwnMessage}
                        isMedia={!!hasImage}
                        time={formatTime(msg.timestamp)}
                        withTail={true}
                        className={isOwnMessage ? 'msg-user' : 'msg-ai'}
                      >
                        {hasImage ? (
                          <img src={(msg as any).fileUrl} alt={(msg as any).fileName || 'image'} />
                        ) : (
                          <span>
                            {displayContent}
                            {hasFile && (
                              <a href={(msg as any).fileUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 12px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', color: 'inherit', textDecoration: 'none' }}>
                                <span>📎</span> {(msg as any).fileName || '文件'}
                              </a>
                            )}
                          </span>
                        )}
                      </MessageBubble>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* 智能回复建议 */}
              {suggestions.length > 0 && !isTyping && (
                <div style={{ padding: '0 16px 16px 16px' }}>
                  <AiSuggestionChips
                    suggestions={suggestions}
                    loading={loadingSuggestions}
                    onSelect={(suggestion) => handleSuggestionClick(suggestion.text)}
                  />
                </div>
              )}

              {isTyping && (
                <div style={{ padding: '8px 16px' }}>
                  <TypingIndicator isAI={true} />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ChatArea>
      </div>
    </div>
  );
};

export default AiChatComponent;
