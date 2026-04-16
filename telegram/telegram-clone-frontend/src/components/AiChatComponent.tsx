import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChatArea } from './layout';
import '../features/chat/components/ChatHeader.css';
import './AiChatComponent.css';
import { motion, AnimatePresence } from 'framer-motion';
import { AiSuggestionChips } from './ai/AiSuggestionChips';
import { TypingIndicator } from './chat/TypingIndicator';
import MessageBubble from './common/MessageBubble';
import AiConversationList from './AiConversationList';
import type { Message } from '../types/chat';
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
}

const AiChatComponent: React.FC<AiChatComponentProps> = (props) => {
  const {
    currentUser,
    messages = [],
    onSendMessage,
    isConnected: propIsConnected = false,
    onBackToContacts
  } = props;

  const isConnected = propIsConnected;
  const [newMessage, setNewMessage] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= 900 : false
  );
  const [showConversationListMobile, setShowConversationListMobile] = useState(false);
  const lastBackTriggerRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showConversationList = isCompactViewport ? showConversationListMobile : true;

  // AI Chat Store 状态
  const {
    currentMessages: storeMessages,
    activeConversationId,
    createNewConversation,
    selectConversation,
    loadConversations,
    addLocalMessage
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

  // 窄屏适配：AI 模式下默认单栏展示聊天区，避免列表与聊天区并排挤压。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const compact = window.innerWidth <= 900;
      setIsCompactViewport(compact);
      if (!compact) {
        setShowConversationListMobile(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const appendLocalConversationMessage = useCallback((params: {
    role: 'user' | 'assistant';
    content: string;
    type?: 'text' | 'image';
    timestamp?: string;
  }) => {
    const normalizedContent = params.content.trim();
    if (!normalizedContent) return;
    addLocalMessage({
      id: `local-${params.role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: params.role,
      content: normalizedContent,
      timestamp: params.timestamp || new Date().toISOString(),
      type: params.type || 'text'
    });
  }, [addLocalMessage]);

  const sendAiThroughAvailableChannel = useCallback((aiMessage: string, imageData?: {
    mimeType: string;
    base64Data: string;
    fileName?: string;
    fileSize?: number;
  }) => {
    if (!onSendMessage) {
      console.warn('AI message bridge is unavailable');
      return;
    }
    onSendMessage(aiMessage, imageData);
  }, [onSendMessage]);

  // 发送AI消息
  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    const trimmedMessage = newMessage.trim();
    const aiMessage = trimmedMessage.startsWith('/ai ') ? trimmedMessage : `/ai ${trimmedMessage}`;
    const displayContent = aiMessage.startsWith('/ai ') ? aiMessage.substring(4) : aiMessage;
    appendLocalConversationMessage({ role: 'user', content: displayContent });
    // 优先父组件发送通道，异常时回退到 AI Socket 通道
    sendAiThroughAvailableChannel(aiMessage);
    setNewMessage('');
  };

  const handleSuggestionClick = (text: string) => {
    const aiMessage = `/ai ${text}`;
    appendLocalConversationMessage({ role: 'user', content: text });
    sendAiThroughAvailableChannel(aiMessage);
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
    if (!file) return;

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
              appendLocalConversationMessage({ role: 'user', content: message, type: 'image' });
              sendAiThroughAvailableChannel(aiMessage, imageData);
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

  const handleBackToContacts = (event: React.SyntheticEvent) => {
    if (!onBackToContacts) return;
    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (now - lastBackTriggerRef.current < 200) return;
    lastBackTriggerRef.current = now;
    onBackToContacts();
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
            type="button"
            onPointerDown={handleBackToContacts}
            onClick={handleBackToContacts}
            className="tg-icon-button"
            style={{ width: 32, height: 32, marginRight: 8, color: 'var(--tg-text-secondary)' }}
            aria-label="返回聊天列表"
            title="返回聊天列表"
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
          <div className="chat-header__name">AI 助手</div>
          <div className="chat-header__status chat-header__status--online">
            {isConnected ? 'Online' : 'Offline'} • 个性化问答
          </div>
        </div>
      </div>

      <div className="chat-header__actions">
        {isCompactViewport && (
          <button
            type="button"
            onClick={() => setShowConversationListMobile((prev) => !prev)}
            style={{
              background: 'rgba(51, 144, 236, 0.08)',
              border: '1px solid rgba(51, 144, 236, 0.25)',
              color: 'var(--tg-blue)',
              borderRadius: '16px',
              padding: '6px 10px',
              fontSize: '13px',
              cursor: 'pointer',
              marginRight: '8px'
            }}
            title={showConversationListMobile ? '关闭历史列表' : '打开历史列表'}
          >
            {showConversationListMobile ? '关闭历史' : '历史列表'}
          </button>
        )}
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
          id="ai-chat-input"
          name="ai-chat-input"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={isUploading ? '正在处理图片...' : '向 AI 提问或上传图片...'}
          disabled={isUploading}
          autoComplete="off"
          aria-label="向 AI 提问或上传图片"
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

  // 实时消息桥接：当父级消息流出现新的 AI/用户消息且当前会话处于活动状态时，
  // 将“最近消息”同步到 aiChatStore，避免 UI 只显示历史消息不刷新。
  const lastSyncedRuntimeMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConversationId || aiMessages.length === 0) return;
    const latest = aiMessages[aiMessages.length - 1];
    if (!latest || !latest.id || lastSyncedRuntimeMessageIdRef.current === latest.id) return;

    const latestTimestamp = new Date(latest.timestamp).getTime();
    if (Number.isNaN(latestTimestamp)) return;

    // 只桥接近期实时消息，避免切换历史会话时混入旧会话消息。
    if (Date.now() - latestTimestamp > 2 * 60 * 1000) return;

    const role: 'user' | 'assistant' = latest.senderId === currentUser?.id ? 'user' : 'assistant';
    const normalizedContent = role === 'user' && latest.content.startsWith('/ai ')
      ? latest.content.substring(4)
      : latest.content;
    const duplicated = storeMessages.some((item) => (
      item.role === role &&
      item.content === normalizedContent &&
      Math.abs(new Date(item.timestamp).getTime() - latestTimestamp) <= 2000
    ));
    if (!duplicated) {
      appendLocalConversationMessage({
        role,
        content: normalizedContent,
        type: latest.type === 'image' ? 'image' : 'text',
        timestamp: latest.timestamp
      });
    }

    lastSyncedRuntimeMessageIdRef.current = latest.id;
  }, [activeConversationId, aiMessages, currentUser?.id, storeMessages, appendLocalConversationMessage]);

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
    if (isCompactViewport) {
      setShowConversationListMobile(false);
    }
  };
  const showChatPane = !isCompactViewport || !showConversationListMobile;

  return (
    <div className="ai-chat-wrapper">
      {/* 左侧会话列表 */}
      {showConversationList && (
        <div className="ai-conversation-sidebar">
          <AiConversationList
            onSelectConversation={handleConversationSelect}
            onNewConversation={() => createNewConversation()}
            onCloseList={isCompactViewport ? () => setShowConversationListMobile(false) : undefined}
          />
        </div>
      )}

      {/* 右侧聊天区域 */}
      {showChatPane && (
      <div className="ai-chat-main">
        <ChatArea
          header={headerContent}
          footer={footerContent}
          className="ai-chat-area"
        >
          {displayMessages.length === 0 ? (
            <div className="ai-chat-empty-state">
              <div className="ai-chat-empty-icon">
                🤖
              </div>
              <h3 className="ai-chat-empty-title">与 AI 助手对话</h3>
              <div className="ai-chat-empty-desc">
                我可以结合你的动态、通知和新闻摘要来回答问题。<br />也支持通用问答和图片理解，无需添加 "/ai" 前缀。
              </div>
              <AiSuggestionChips onSelect={(suggestion) => setNewMessage(suggestion.text)} />
            </div>
          ) : (
            <div ref={messagesContainerRef} className="ai-chat-messages-container">
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
                      style={{ display: 'flex', justifyContent: isOwnMessage ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '8px' }}
                      className={`ai-chat-message-row ${isOwnMessage ? 'msg-user' : 'msg-ai'}`}
                    >
                      {isAiMessage && (
                        <div className="ai-chat-message-avatar">
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
                          <img
                            className="ai-chat-message-image"
                            src={(msg as any).fileUrl}
                            alt={(msg as any).fileName || 'image'}
                          />
                        ) : (
                          <span>
                            {displayContent}
                            {hasFile && (
                              <a
                                className="ai-chat-file-link"
                                href={(msg as any).fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
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
                <div className="ai-chat-suggestions-wrap">
                  <AiSuggestionChips
                    suggestions={suggestions}
                    loading={loadingSuggestions}
                    onSelect={(suggestion) => handleSuggestionClick(suggestion.text)}
                  />
                </div>
              )}

              {isTyping && (
                <div className="ai-chat-typing-wrap">
                  <TypingIndicator isAI={true} />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ChatArea>
      </div>
      )}
    </div>
  );
};

export default AiChatComponent;
