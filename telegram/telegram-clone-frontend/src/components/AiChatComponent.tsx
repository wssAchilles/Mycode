import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, Paperclip, RotateCw, Square, X } from 'lucide-react';
import { ChatArea } from './layout';
import '../features/chat/components/ChatHeader.css';
import './AiChatComponent.css';
import { motion, AnimatePresence } from 'framer-motion';
import { AiSuggestionChips } from './ai/AiSuggestionChips';
import { AiTypingIndicator } from './ai/AiTypingIndicator';
import MessageBubble from './common/MessageBubble';
import AiConversationList from './AiConversationList';
import type { Message } from '../types/chat';
import { mlService } from '../services/mlService';
import { useAiChatStore } from '../features/chat/store/aiChatStore';
import { useMessageStore } from '../features/chat/store/messageStore';
import { aiChatAPI } from '../services/aiChatAPI';
import { buildPrivateChatId } from '../utils/chat';
import { formatMessageTimestamp } from '../utils/dateTime';
import { showToast } from './ui/Toast';

interface AiChatComponentProps {
  currentUser: { id: string; username?: string } | null;
  messages?: Message[];
  isConnected?: boolean;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  onBackToContacts?: () => void;
}

// 解析消息中的行内代码片段
const renderInlineCodeText = (text: string, keyPrefix: string): React.ReactNode[] => {
  const parts = text.split(/(`[^`\n]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={`${keyPrefix}-ic-${idx}`} className="ai-chat-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyPrefix}-tx-${idx}`}>{part}</React.Fragment>;
  });
};

const AiChatComponent: React.FC<AiChatComponentProps> = (props) => {
  const {
    currentUser,
    messages = [],
    isConnected: propIsConnected = false,
    initialPrompt,
    onInitialPromptConsumed,
    onBackToContacts
  } = props;

  const isConnected = propIsConnected;
  const [newMessage, setNewMessage] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ id: string; text: string }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [lastFailedPayload, setLastFailedPayload] = useState<{
    message: string;
    imageData?: {
      mimeType: string;
      base64Data: string;
      fileName?: string;
      fileSize?: number;
    };
  } | null>(null);
  const [stagedImage, setStagedImage] = useState<{
    file: File;
    previewUrl: string;
    mimeType: string;
    base64Data: string;
  } | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= 900 : false
  );
  const [showConversationListMobile, setShowConversationListMobile] = useState(false);
  const lastBackTriggerRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef('');
  const showConversationList = isCompactViewport ? showConversationListMobile : true;

  // AI 对话状态仓库
  const {
    currentMessages: storeMessages,
    activeConversationId,
    createNewConversation,
    selectConversation,
    loadConversations,
    addLocalMessage,
    updateConversationFromResponse
  } = useAiChatStore();
  const clearMessages = useMessageStore((state) => state.clearMessages);

  // 自动滚动到底部（仅在消息滚动容器内滚动，避免影响外层布局）
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, storeMessages.length, streamingText]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  // 检测 AI 回复状态并拉取智能快捷建议
  useEffect(() => {
    if (!currentUser || !currentUser.id) return;

    const lastMessage = messages[messages.length - 1];

    // 当最后一条消息来自 AI 或非当前用户时，获取智能回复建议
    if (lastMessage && lastMessage.senderId !== currentUser.id) {
      setLoadingSuggestions(true);
      mlService.getSmartReplies(lastMessage.content)
        .then((items: string[]) => {
          setSuggestions(items.map((text: string, idx: number) => ({ id: `s-${idx}`, text })));
        })
        .catch((err: unknown) => console.error(err instanceof Error ? err.message : err))
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

  // 窄屏适配：AI 模式下默认单栏展示聊天区，避免侧栏与聊天区并排挤压
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

  const sendAiThroughAvailableChannel = useCallback(async (
    aiMessage: string,
    imageData?: {
      mimeType: string;
      base64Data: string;
      fileName?: string;
      fileSize?: number;
    },
    forceNewConversation = false,
  ) => {
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    streamingTextRef.current = '';
    setStreamingText('');

    const visibleHistory = forceNewConversation
      ? []
      : storeMessages
          .filter((item) => item.content && item.content.trim())
          .slice(-10)
          .map((item) => ({
            role: item.role,
            content: item.content.trim(),
          }));

    const targetConversationId = forceNewConversation ? null : activeConversationId;

    const response = await aiChatAPI.streamChatMessage(
      {
        message: aiMessage.startsWith('/ai ') ? aiMessage.slice(4) : aiMessage,
        conversationId: targetConversationId,
        conversationHistory: visibleHistory,
        imageData: imageData
          ? {
              mimeType: imageData.mimeType,
              base64Data: imageData.base64Data,
            }
          : undefined,
      },
      {
        signal: controller.signal,
        onDelta: (delta) => {
          streamingTextRef.current += delta;
          setStreamingText(streamingTextRef.current);
        },
      },
    );

    if (streamAbortRef.current === controller) {
      streamAbortRef.current = null;
    }
    streamingTextRef.current = '';
    setStreamingText('');

    appendLocalConversationMessage({
      role: 'assistant',
      content: response.message,
      timestamp: response.timestamp,
    });

    if (response.conversationId) {
      updateConversationFromResponse(response.conversationId);
    } else if (!targetConversationId) {
      void loadConversations();
    }

    if (Array.isArray(response.agent?.suggestions) && response.agent.suggestions.length > 0) {
      setSuggestions(response.agent.suggestions.map((text, idx) => ({ id: `a-${idx}`, text })));
    } else {
      setSuggestions([]);
    }
  }, [
    activeConversationId,
    appendLocalConversationMessage,
    loadConversations,
    storeMessages,
    updateConversationFromResponse,
  ]);

  // 自动调整多行输入框高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight || 22, 132);
    el.style.height = `${Math.max(22, next)}px`;
  }, [newMessage]);

  useEffect(() => {
    return () => {
      if (stagedImage?.previewUrl) {
        URL.revokeObjectURL(stagedImage.previewUrl);
      }
    };
  }, [stagedImage]);

  const clearStagedImage = useCallback(() => {
    setStagedImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  const stageImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('当前仅支持图片文件', 'info');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string | undefined;
      const base64Data = dataUrl?.split(',')[1];
      if (!base64Data) {
        showToast('图片解析失败，请重试', 'error');
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setStagedImage((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          file,
          previewUrl,
          mimeType: file.type,
          base64Data,
        };
      });
      textareaRef.current?.focus();
    };
    reader.readAsDataURL(file);
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottom(distanceFromBottom > 200);
  }, []);

  const scrollToMessagesBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowScrollBottom(false);
  }, []);

  // 发送 AI 消息（支持文本、暂存截图与新建上下文）
  const dispatchAiPrompt = useCallback(
    async (
      rawText: string,
      imageData?: {
        mimeType: string;
        base64Data: string;
        fileName?: string;
        fileSize?: number;
      },
      appendUserBubble = true,
      forceNewConversation = false,
    ) => {
      setErrorBanner(null);
      setLastFailedPayload(null);
      const trimmedMessage = rawText.trim();
      const displayContent = trimmedMessage.startsWith('/ai ')
        ? trimmedMessage.substring(4)
        : trimmedMessage;
      const aiMessage = `/ai ${displayContent}`;
      if (appendUserBubble) {
        appendLocalConversationMessage({
          role: 'user',
          content: displayContent,
          type: imageData ? 'image' : 'text',
        });
      }
      setIsTyping(true);
      try {
        await sendAiThroughAvailableChannel(aiMessage, imageData, forceNewConversation);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          const partial = streamingTextRef.current.trim();
          if (partial) {
            appendLocalConversationMessage({
              role: 'assistant',
              content: `${partial}\n\n*（已停止生成）*`,
              type: 'text',
            });
          }
          streamingTextRef.current = '';
          setStreamingText('');
          showToast('已停止 AI 回复生成', 'info');
          return;
        }
        streamingTextRef.current = '';
        setStreamingText('');
        const message = error instanceof Error ? error.message : 'AI 助手暂时不可用，请稍后再试';
        console.error('❌ AI 回复失败:', message);
        setErrorBanner(message);
        setLastFailedPayload({ message: displayContent, imageData });
        showToast(message, 'error');
      } finally {
        setIsTyping(false);
      }
    },
    [appendLocalConversationMessage, sendAiThroughAvailableChannel],
  );

  // 停止当前流式回复生成
  const handleStopGeneration = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  // 来自聊天气泡「问 AI」或头部「总结对话」的外部提示词直达触发
  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt || isTyping) return;
    onInitialPromptConsumed?.();
    if (storeMessages.length > 0 || activeConversationId) {
      createNewConversation();
      void dispatchAiPrompt(prompt, undefined, true, true);
    } else {
      void dispatchAiPrompt(prompt, undefined, true, false);
    }
  }, [
    activeConversationId,
    createNewConversation,
    dispatchAiPrompt,
    initialPrompt,
    isTyping,
    onInitialPromptConsumed,
    storeMessages.length,
  ]);

  // 发送 AI 消息
  const handleSendMessage = () => {
    if (isTyping || isUploading) return;
    const trimmed = newMessage.trim();
    if (!trimmed && !stagedImage) return;

    const currentStaged = stagedImage;
    const promptText = trimmed || '请分析这张图片';
    const imagePayload = currentStaged
      ? {
          mimeType: currentStaged.mimeType,
          base64Data: currentStaged.base64Data,
          fileName: currentStaged.file.name,
          fileSize: currentStaged.file.size,
        }
      : undefined;

    setNewMessage('');
    clearStagedImage();
    void dispatchAiPrompt(promptText, imagePayload, true);
  };

  const handleRetryLastFailed = () => {
    if (!lastFailedPayload || isTyping) return;
    const payload = lastFailedPayload;
    void dispatchAiPrompt(payload.message, payload.imageData, false);
  };

  const handleSuggestionClick = (text: string) => {
    // 点击后清空当前建议列表
    setSuggestions([]);
    void dispatchAiPrompt(text, undefined, true);
  };

  // 新建 AI 聊天并归档当前会话
  const handleStartNewChat = async () => {
    if (isStartingNewChat) return;
    setIsStartingNewChat(true);
    setErrorBanner(null);
    try {
      const messagesForArchive = displayMessages
        .filter((msg) => msg.content && msg.content.trim())
        .map((msg) => {
          const msgWithFile = msg as Message & { fileUrl?: string; mimeType?: string; fileName?: string; fileSize?: number };
          return {
            role: msg.senderUsername === 'Gemini AI' ? 'assistant' as const : 'user' as const,
            content: msg.content.startsWith('/ai ') ? msg.content.slice(4) : msg.content,
            timestamp: msg.timestamp,
            type: msg.type === 'image' ? 'image' as const : 'text' as const,
            imageData: msgWithFile.fileUrl && msgWithFile.mimeType?.startsWith('image/')
              ? {
                mimeType: msgWithFile.mimeType,
                fileName: msgWithFile.fileName || 'image',
                fileSize: msgWithFile.fileSize || 0
              }
              : undefined
          };
        });

      if (messagesForArchive.length > 0) {
        await aiChatAPI.archiveConversation(messagesForArchive);
        await loadConversations();
      }

      clearMessages();
      createNewConversation();
    } catch (error: unknown) {
      console.error('❌ 新建AI聊天失败:', error instanceof Error ? error.message : error);
    } finally {
      setIsStartingNewChat(false);
    }
  };

  // 图片文件上传处理（暂存至待发送预览条，可搭配提问发送）
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      stageImageFile(file);
    }
    event.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          stageImageFile(file);
          return;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDragActive) setIsDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setIsDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      e.preventDefault();
      stageImageFile(file);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (timestamp: string) => {
    return formatMessageTimestamp(timestamp);
  };

  const handleCopyText = async (text: string, msgKey: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedMessageId(msgKey);
      window.setTimeout(() => {
        setCopiedMessageId((prev) => (prev === msgKey ? null : prev));
      }, 1800);
    } catch {
      // 剪贴板受限时静默处理
    }
  };

  // 使用完整的 ReactMarkdown + remarkGfm 渲染结构化回复与带复制栏代码块
  const renderMessageContent = (raw: string, msgKey: string, isAiMessage: boolean) => {
    if (!isAiMessage) {
      return raw.includes('`') ? renderInlineCodeText(raw, msgKey) : raw;
    }
    let codeBlockCounter = 0;
    return (
      <div className="ai-chat-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: ({ children }) => <>{children}</>,
            code: ({ className, children, ...props }) => {
              const rawCode = String(children).replace(/\n$/, '');
              const langMatch = /language-(\w+)/.exec(className || '');
              const isBlock = Boolean(langMatch) || rawCode.includes('\n');
              if (!isBlock) {
                return (
                  <code className="ai-chat-inline-code" {...props}>
                    {children}
                  </code>
                );
              }
              const blockId = `${msgKey}-cb-${codeBlockCounter}`;
              codeBlockCounter += 1;
              return (
                <div className="ai-chat-code-wrap">
                  <div className="ai-chat-code-header">
                    <span>{langMatch?.[1] || 'code'}</span>
                    <button
                      type="button"
                      className="ai-chat-copy-btn"
                      onClick={() => void handleCopyText(rawCode, blockId)}
                    >
                      {copiedMessageId === blockId ? '已复制' : '复制代码'}
                    </button>
                  </div>
                  <pre className="ai-chat-code-block">
                    <code className={className} {...props}>{rawCode}</code>
                  </pre>
                </div>
              );
            },
          }}
        >
          {raw}
        </ReactMarkdown>
      </div>
    );
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

  const aiBotSvg = (size: number) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="10" rx="2"></rect>
      <circle cx="12" cy="5" r="2"></circle>
      <path d="M12 7v4"></path>
      <line x1="8" y1="16" x2="8.01" y2="16"></line>
      <line x1="16" y1="16" x2="16.01" y2="16"></line>
    </svg>
  );

  // 构建顶部磨砂白顶栏内容
  const headerContent = (
    <>
      <div className="chat-header__info">
        {onBackToContacts && (
          <button
            type="button"
            onPointerDown={handleBackToContacts}
            onClick={handleBackToContacts}
            className="tg-icon-button ai-chat-header__back-btn"
            aria-label="返回聊天列表"
            title="返回聊天列表"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
        )}
        <div className="chat-header__avatar chat-header__avatar--ai">
          {aiBotSvg(22)}
        </div>
        <div className="chat-header__details">
          <div className="chat-header__name">AI 助手</div>
          <div className={`chat-header__status ${isConnected ? 'chat-header__status--online' : 'chat-header__status--offline'}`}>
            {isConnected ? '在线' : '离线'} · 个性化问答
          </div>
        </div>
      </div>

      <div className="chat-header__actions">
        {isCompactViewport && (
          <button
            type="button"
            className="ai-chat-header__history-btn"
            onClick={() => setShowConversationListMobile((prev) => !prev)}
            title={showConversationListMobile ? '关闭历史列表' : '打开历史列表'}
          >
            {showConversationListMobile ? '关闭历史' : '历史列表'}
          </button>
        )}
        <button
          type="button"
          className="ai-chat-header__new-btn"
          onClick={handleStartNewChat}
          disabled={isStartingNewChat}
        >
          {isStartingNewChat ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          )}
          <span>新建聊天</span>
        </button>
      </div>
    </>
  );

  // 构建底部淡色高对比输入区内容
  const footerContent = (
    <div
      className={`ai-chat-footer-stack ${isDragActive ? 'is-dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {errorBanner && (
        <div className="ai-chat-error-banner" role="alert">
          <span>{errorBanner}</span>
          <div className="ai-chat-error-banner__actions">
            {lastFailedPayload && (
              <button
                type="button"
                className="ai-chat-error-banner__retry"
                onClick={handleRetryLastFailed}
                disabled={isTyping}
              >
                <RotateCw size={12} aria-hidden="true" />
                <span>重试上一条</span>
              </button>
            )}
            <button
              type="button"
              className="ai-chat-error-banner__close"
              onClick={() => setErrorBanner(null)}
              aria-label="关闭错误提示"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {stagedImage && (
        <div className="ai-chat-staged-preview" role="status">
          <img src={stagedImage.previewUrl} alt={stagedImage.file.name || '待发送图片'} />
          <div className="ai-chat-staged-meta">
            <span className="ai-chat-staged-name">{stagedImage.file.name || '粘贴的图片'}</span>
            <span className="ai-chat-staged-hint">可输入提问说明后按 Enter 发送</span>
          </div>
          <button
            type="button"
            className="ai-chat-staged-remove"
            onClick={clearStagedImage}
            aria-label="移除待发送图片"
            title="移除图片"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="message-input-container">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || isTyping}
          className="tg-icon-button"
          title="上传或粘贴图片"
          aria-label="上传图片"
        >
          {isUploading ? (
            <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          )}
        </button>

        <div className="message-input-wrapper">
          <textarea
            ref={textareaRef}
            rows={1}
            id="ai-chat-input"
            name="ai-chat-input"
            className="ai-chat-textarea"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isUploading ? '正在处理图片...' : '向 AI 提问、粘贴截图或 Shift+Enter 换行...'}
            disabled={isUploading}
            autoComplete="off"
            aria-label="向 AI 提问或上传图片"
            autoFocus
          />
        </div>

        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" style={{ display: 'none' }} />

        {isTyping ? (
          <button
            type="button"
            onClick={handleStopGeneration}
            className="ai-chat-stop-btn"
            title="停止生成"
            aria-label="停止生成 AI 回复"
          >
            <Square size={12} fill="currentColor" aria-hidden="true" />
            <span>停止</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSendMessage}
            disabled={(!newMessage.trim() && !stagedImage) || isUploading}
            className="tg-icon-button send-button"
            title="发送消息"
            aria-label="发送消息"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  // 实时消息桥接：当父级消息流出现新的 AI/用户消息且当前会话处于活动状态时，同步到 aiChatStore
  const lastSyncedRuntimeMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConversationId || aiMessages.length === 0) return;
    const latest = aiMessages[aiMessages.length - 1];
    if (!latest || !latest.id || lastSyncedRuntimeMessageIdRef.current === latest.id) return;

    const latestTimestamp = new Date(latest.timestamp).getTime();
    if (Number.isNaN(latestTimestamp)) return;

    // 仅桥接近期实时消息，避免切换历史会话时混入旧会话消息
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

  // 优先展示 store 会话消息，兜底展示实时筛选消息
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

  // 处理会话选择并在窄屏下自动返回聊天主面板
  const handleConversationSelect = (conversationId: string) => {
    selectConversation(conversationId);
    if (isCompactViewport) {
      setShowConversationListMobile(false);
    }
  };
  const showChatPane = !isCompactViewport || !showConversationListMobile;

  return (
    <div className="ai-chat-wrapper">
      {/* 左侧历史会话列表 */}
      {showConversationList && (
        <div className="ai-conversation-sidebar">
          <AiConversationList
            onSelectConversation={handleConversationSelect}
            onNewConversation={() => createNewConversation()}
            onCloseList={isCompactViewport ? () => setShowConversationListMobile(false) : undefined}
          />
        </div>
      )}

      {/* 右侧对话区域 */}
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
                  {aiBotSvg(34)}
                </div>
                <h3 className="ai-chat-empty-title">与 AI 助手对话</h3>
                <div className="ai-chat-empty-desc">
                  我可以结合你的动态、通知和新闻摘要来回答问题。<br />也支持通用问答和图片理解，无需添加 "/ai" 前缀。
                </div>
                <AiSuggestionChips onSelect={(suggestion) => setNewMessage(suggestion.text)} />
              </div>
            ) : (
              <div ref={messagesContainerRef} className="ai-chat-messages-container" onScroll={handleMessagesScroll}>
                <AnimatePresence initial={false}>
                  {displayMessages.map((msg, index) => {
                    const isOwnMessage = msg.senderId === currentUser?.id || msg.senderId === 'me';
                    const isAiMessage = msg.senderUsername === 'Gemini AI';
                    const msgWithFile = msg as Message & { fileUrl?: string; mimeType?: string; fileName?: string };
                    const hasImage = msgWithFile.fileUrl && (msgWithFile.mimeType?.startsWith('image/') || msgWithFile.fileUrl.startsWith('data:image'));
                    const hasFile = msgWithFile.fileUrl && !hasImage;
                    const msgKey = String(msg.id || index);

                    const displayContent = isOwnMessage && msg.content.startsWith('/ai ')
                      ? msg.content.substring(4)
                      : msg.content;

                    return (
                      <motion.div
                        key={msgKey}
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                        style={{ display: 'flex', justifyContent: isOwnMessage ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '8px' }}
                        className={`ai-chat-message-row ${isOwnMessage ? 'msg-user' : 'msg-ai'}`}
                      >
                        {isAiMessage && (
                          <div className="ai-chat-message-avatar" aria-hidden="true">
                            {aiBotSvg(16)}
                          </div>
                        )}

                        <MessageBubble
                          isOut={isOwnMessage}
                          isMedia={!!hasImage}
                          time={formatTime(msg.timestamp)}
                          withTail={false}
                          className={isOwnMessage ? 'msg-user' : 'msg-ai'}
                        >
                          {hasImage ? (
                            <img
                              className="ai-chat-message-image"
                              src={msgWithFile.fileUrl}
                              alt={msgWithFile.fileName || 'image'}
                            />
                          ) : (
                            <span>
                              {renderMessageContent(displayContent, msgKey, isAiMessage)}
                              {hasFile && (
                                <a
                                  className="ai-chat-file-link"
                                  href={msgWithFile.fileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Paperclip size={14} aria-hidden="true" /> {msgWithFile.fileName || '文件'}
                                </a>
                              )}
                              {isAiMessage && displayContent && (
                                <span className="ai-chat-msg-tools">
                                  <button
                                    type="button"
                                    className="ai-chat-copy-btn"
                                    onClick={() => void handleCopyText(displayContent, msgKey)}
                                    title="复制回复"
                                    aria-label="复制回复"
                                  >
                                    {copiedMessageId === msgKey ? '已复制' : '复制'}
                                  </button>
                                </span>
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
                  streamingText ? (
                    <div
                      style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-end', gap: '8px' }}
                      className="ai-chat-message-row msg-ai"
                    >
                      <div className="ai-chat-message-avatar" aria-hidden="true">
                        {aiBotSvg(16)}
                      </div>
                      <MessageBubble
                        isOut={false}
                        isMedia={false}
                        time="生成中..."
                        withTail={false}
                        className="msg-ai"
                      >
                        <span>
                          {renderMessageContent(streamingText, 'ai-streaming-draft', true)}
                          <span className="ai-chat-streaming-cursor" aria-hidden="true" />
                        </span>
                      </MessageBubble>
                    </div>
                  ) : (
                    <div className="ai-chat-typing-wrap">
                      <AiTypingIndicator />
                    </div>
                  )
                )}
                <div ref={messagesEndRef} />
                {showScrollBottom && (
                  <button
                    type="button"
                    className="ai-chat-scroll-bottom-btn"
                    onClick={scrollToMessagesBottom}
                    aria-label="回到底部"
                    title="回到底部"
                  >
                    <ArrowDown size={16} aria-hidden="true" />
                    <span>回到底部</span>
                  </button>
                )}
              </div>
            )}
          </ChatArea>
        </div>
      )}
    </div>
  );
};

export default AiChatComponent;
