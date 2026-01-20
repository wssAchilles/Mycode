import React, { useState, useEffect, useRef } from 'react';
import { AiSuggestionChips } from './ai/AiSuggestionChips';
import { TypingIndicator } from './chat/TypingIndicator';
import type { Message } from '../types/chat';
import { aiChatAPI } from '../services/aiChatAPI';
import aiSocketService from '../services/aiSocketService';

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
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 检测AI是否在回复中
  useEffect(() => {
    if (!currentUser || !currentUser.id) return;

    const lastMessage = messages[messages.length - 1];
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
    onSendMessage(aiMessage);
    const actualMessage = aiMessage.startsWith('/ai ') ? aiMessage.substring(4) : aiMessage;
    aiSocketService.sendMessage(actualMessage);
    setNewMessage('');
  };

  // 新建AI聊天
  const handleStartNewChat = async () => {
    if (isStartingNewChat) return;
    setIsStartingNewChat(true);
    try {
      await aiChatAPI.startNewAiChat();
      console.log('✅ 新建AI聊天成功');
      if (onBackToContacts) {
        onBackToContacts();
      }
    } catch (error: any) {
      console.error('❌ 新建AI聊天失败:', error);
      alert('新建聊天失败: ' + error.message);
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
              onSendMessage(aiMessage, imageData);
              const actualMessage = aiMessage.startsWith('/ai ') ? aiMessage.substring(4) : aiMessage;
              aiSocketService.sendMessage(actualMessage, imageData);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f1419' }}>
      {/* AI聊天头部 */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #242f3d', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {onBackToContacts && (
          <button onClick={onBackToContacts} style={{ background: 'transparent', border: 'none', color: '#8596a8', fontSize: '18px', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px' }}>
            ←
          </button>
        )}
        <div style={{ width: '40px', height: '40px', background: '#242f3d', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
          🤖
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, color: '#ffffff', fontWeight: 500, fontSize: '16px' }}>Gemini AI 助手</h3>
          <p style={{ margin: 0, color: '#8596a8', fontSize: '13px' }}>{(socketConnected || isConnected) ? '在线' : '离线'} • 由 Google Gemini 驱动</p>
        </div>
        <button onClick={handleStartNewChat} disabled={isStartingNewChat} style={{ background: 'transparent', border: '1px solid #5568c0', color: '#5568c0', borderRadius: '16px', padding: '6px 10px', fontSize: '12px', cursor: isStartingNewChat ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', opacity: isStartingNewChat ? 0.6 : 1 }}>
          {isStartingNewChat ? '⚙️' : '➕'} 新建
        </button>
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {aiMessages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', color: '#ffffff', textAlign: 'center' }}>
            <div style={{ fontSize: '40px' }}>🤖</div>
            <h3 style={{ margin: 0 }}>与 AI 助手对话</h3>
            <div style={{ maxWidth: '320px', fontSize: '14px', color: '#8596a8', marginBottom: '20px' }}>
              💡 提示：直接输入您的问题即可，无需添加 "/ai" 前缀
            </div>
            <AiSuggestionChips onSelect={(suggestion) => setNewMessage(suggestion.text)} />
          </div>
        )}

        {aiMessages.map((msg, index) => {
          const isOwnMessage = msg.senderId === currentUser?.id;
          const isAiMessage = msg.senderUsername === 'Gemini AI';
          const hasImage = msg.fileUrl && (msg.mimeType?.startsWith('image/') || msg.fileUrl.startsWith('data:image'));
          const hasFile = msg.fileUrl && !hasImage;

          return (
            <div key={msg.id || index} style={{ display: 'flex', justifyContent: isOwnMessage ? 'flex-end' : 'flex-start', alignItems: 'flex-start', gap: '8px' }}>
              {isAiMessage && (
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#242f3d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>
                  🤖
                </div>
              )}
              <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: isOwnMessage ? 'flex-end' : 'flex-start' }}>
                <div style={{ color: '#8596a8', fontSize: '11px', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {isAiMessage ? 'Gemini AI' : currentUser?.username || '我'}
                  <span>•</span>
                  <span>{formatTime(msg.timestamp)}</span>
                </div>
                <div style={{ background: isOwnMessage ? '#5568c0' : '#242f3d', color: '#ffffff', padding: '12px 16px', borderRadius: '14px', fontSize: '14px', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap', maxWidth: '360px' }}>
                  <div style={{ marginBottom: hasImage || hasFile ? 8 : 0 }}>
                    {isOwnMessage ? (msg.content.startsWith('/ai ') ? msg.content.substring(4) : msg.content) : msg.content}
                  </div>
                  {hasImage && <img src={msg.fileUrl} alt={msg.fileName || 'image'} style={{ maxWidth: '100%', borderRadius: '10px', marginTop: 4, display: 'block' }} />}
                  {hasFile && <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginTop: 4, borderRadius: '10px', background: 'rgba(255,255,255,0.08)', color: '#ffffff', textDecoration: 'none' }}>📎 {msg.fileName || '文件'}</a>}
                </div>
              </div>
              {isOwnMessage && (
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#242f3d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0, color: '#ffffff' }}>
                  {currentUser?.username?.[0]?.toUpperCase() || '👤'}
                </div>
              )}
            </div>
          );
        })}

        {isTyping && (
          <div style={{ padding: '8px 16px' }}>
            <TypingIndicator isAI={true} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: '16px 20px', borderTop: '1px solid #242f3d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#242f3d', borderRadius: '24px', padding: '8px' }}>
          <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'transparent', border: 'none', cursor: !isUploading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
            {isUploading ? '⌛' : '🖼️'}
          </button>
          <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyPress={handleKeyPress} placeholder={isUploading ? '正在处理图片...' : '向 AI 提问或上传图片...'} disabled={isUploading} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#ffffff', fontSize: '15px', padding: '12px 16px' }} />
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" style={{ display: 'none' }} />
          <button onClick={handleSendMessage} disabled={!newMessage.trim() || isUploading} style={{ width: '40px', height: '40px', borderRadius: '50%', background: newMessage.trim() ? '#5568c0' : '#2f3e4c', border: 'none', color: '#ffffff', cursor: newMessage.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', transition: 'all 0.2s', marginLeft: '4px' }}>
            🚀
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiChatComponent;
