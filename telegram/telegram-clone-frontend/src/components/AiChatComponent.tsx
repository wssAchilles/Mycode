import React, { useState, useEffect, useRef } from 'react';
import type { Message } from '../types/chat';
import { aiChatAPI } from '../services/aiChatAPI';
import aiSocketService from '../services/aiSocketService';

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
    isConnected: propIsConnected = false, // Renamed to avoid conflict with local state
    onBackToContacts 
  } = props;

  const [isConnected, setIsConnected] = useState(propIsConnected);
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
    // 添加安全检查，确保currentUser存在
    if (!currentUser || !currentUser.id) {
      console.warn('⚠️ currentUser或currentUser.id为空，跳过AI回复状态检测');
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.senderId === currentUser.id && lastMessage.content && lastMessage.content.startsWith('/ai ')) {
      setIsTyping(true);
      // 设置一个超时来清除typing状态（防止AI没有回复）
      const timeout = setTimeout(() => setIsTyping(false), 30000);
      return () => clearTimeout(timeout);
    } else if (lastMessage && lastMessage.senderUsername === 'Gemini AI') {
      setIsTyping(false);
    }
  }, [messages, currentUser]);
  
  // 连接AI Socket.IO服务器
  useEffect(() => {
    // 连接到AI Socket.IO服务器
    aiSocketService.connect();
    
    // 监听连接状态
    const handleConnectionChange = (connected: boolean) => {
      console.log(`🔌 AI Socket.IO 连接状态变更: ${connected ? '已连接' : '已断开'}`);
      setIsConnected(connected);
    };
    
    // 监听AI消息响应
    const handleAiResponse = (response: any) => {
      console.log('📩 收到AI响应:', response);
      // AI消息响应已处理完成，设置typing为false
      setIsTyping(false);
      
      // 如果需要处理额外的AI响应逻辑，可以在这里添加
    };
    
    // 注册事件监听器
    aiSocketService.addConnectionListener(handleConnectionChange);
    aiSocketService.addMessageListener(handleAiResponse);
    
    // 组件卸载时清理
    return () => {
      aiSocketService.removeConnectionListener(handleConnectionChange);
      aiSocketService.removeMessageListener(handleAiResponse);
    };
  }, []);

  // 发送AI消息
  const handleSendMessage = () => {
    if (!newMessage.trim() || !isConnected || !onSendMessage) return;

    // 确保消息以 /ai 开头
    const aiMessage = newMessage.startsWith('/ai ') ? newMessage : `/ai ${newMessage}`;
    
    // 向主聊天发送消息（显示在UI中）
    onSendMessage(aiMessage);
    
    // 向AI Socket.IO服务发送实际的AI请求（不带前缀）
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
      // 可以触发父组件刷新消息列表
      if (onBackToContacts) {
        // 暂时回到联系人列表，然后重新进入AI模式
        onBackToContacts();
        setTimeout(() => {
          // 这里可以添加重新进入AI模式的逻辑
        }, 100);
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
    if (!file || !isConnected || !onSendMessage) return;

    setIsUploading(true);

    try {
      // 将图片转换为Base64
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
              
              // 发送包含图片的AI消息
              const message = newMessage.trim() || '请分析这张图片';
              const aiMessage = message.startsWith('/ai ') ? message : `/ai ${message}`;
              
              // 向主聊天发送消息
              onSendMessage(aiMessage, imageData);
              
              // 向AI Socket.IO发送图片消息
              const actualMessage = aiMessage.startsWith('/ai ') ? aiMessage.substring(4) : aiMessage;
              aiSocketService.sendMessage(actualMessage, imageData);
              
              setNewMessage('');
              
              console.log('🤖 AI图片消息发送成功');
            }
          } catch (error) {
            console.error('❌ AI图片处理失败:', error);
            alert('图片处理失败，请重试');
          } finally {
            setIsUploading(false);
          }
        };

        reader.onerror = () => {
          console.error('❌ 图片读取失败');
          alert('图片读取失败，请重试');
          setIsUploading(false);
        };
        
        reader.readAsDataURL(file);
      } else {
        console.error('❌ 不支持的文件类型:', file.type);
        alert('当前仅支持图片文件');
        setIsUploading(false);
      }
    } catch (error) {
      console.error('❌ 文件上传失败:', error);
      alert('文件上传失败，请重试');
      setIsUploading(false);
    } finally {
      // 清空文件输入
      event.target.value = '';
    }
  };

  // 键盘事件处理
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 格式化时间
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // 过滤出AI相关的消息
  const aiMessages = messages.filter(msg => 
    (msg.senderId === currentUser?.id && msg.content.startsWith('/ai ')) ||
    msg.senderUsername === 'Gemini AI'
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0f1419'
    }}>
      {/* AI聊天头部 */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid #242f3d',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        {/* 返回按钮 */}
        {onBackToContacts && (
          <button
            onClick={onBackToContacts}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8596a8',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px'
            }}
            title="返回"
          >
            ←
          </button>
        )}
        
        {/* AI头像 */}
        <div style={{
          width: '40px',
          height: '40px',
          background: '#242f3d',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px'
        }}>
          🤖
        </div>
        
        {/* AI名称和状态 */}
        <div style={{
          flex: 1
        }}>
          <h3 style={{ 
            margin: 0, 
            color: '#ffffff', 
            fontWeight: 500, 
            fontSize: '16px' 
          }}>
            Gemini AI 助手
          </h3>
          <p style={{ margin: 0, color: '#8596a8', fontSize: '13px' }}>
            {isConnected ? '在线' : '离线'} • 由 Google Gemini 驱动
          </p>
        </div>
        
        {/* 新建聊天按钮 */}
        <button
          onClick={handleStartNewChat}
          disabled={isStartingNewChat}
          style={{
            background: 'transparent',
            border: '1px solid #5568c0',
            color: '#5568c0',
            borderRadius: '16px',
            padding: '6px 10px',
            fontSize: '12px',
            cursor: isStartingNewChat ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            opacity: isStartingNewChat ? 0.6 : 1,
            transition: 'all 0.2s'
          }}
          title="新建聊天"
        >
          {isStartingNewChat ? '⚙️' : '➕'} 新建
        </button>
      </div>

      {/* 消息列表 */}
      <div style={{
        flex: 1,
        padding: '16px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {/* 欢迎消息 */}
        {aiMessages.length === 0 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: '16px',
            color: '#ffffff',
            textAlign: 'center'
          }}>
            <div style={{
              fontSize: '40px'
            }}>
              🤖
            </div>
            <h3 style={{ margin: 0 }}>与 AI 助手对话</h3>
            <div style={{
              maxWidth: '320px',
              fontSize: '14px',
              color: '#8596a8'
            }}>
              💡 提示：直接输入您的问题即可，无需添加 "/ai" 前缀
            </div>
          </div>
        )}

        {/* AI消息列表 */}
        {aiMessages.map((msg, index) => {
          const isOwnMessage = msg.senderId === currentUser?.id;
          const isAiMessage = msg.senderUsername === 'Gemini AI';
          
          return (
            <div
              key={msg.id || index}
              style={{
                display: 'flex',
                justifyContent: isOwnMessage ? 'flex-end' : 'flex-start',
                alignItems: 'flex-start',
                gap: '8px'
              }}
            >
              {/* AI头像 */}
              {isAiMessage && (
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#242f3d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  flexShrink: 0
                }}>
                  🤖
                </div>
              )}

              <div style={{
                maxWidth: '70%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: isOwnMessage ? 'flex-end' : 'flex-start'
              }}>
                {/* 消息时间和状态 */}
                <div style={{ 
                  color: '#8596a8', 
                  fontSize: '11px',
                  marginBottom: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  {isAiMessage ? 'Gemini AI' : currentUser?.username || '我'}
                  <span>•</span>
                  <span>{formatTime(msg.timestamp)}</span>
                </div>
                
                {/* 消息内容 */}
                <div style={{
                  background: isOwnMessage ? '#5568c0' : '#242f3d',
                  color: '#ffffff',
                  padding: '12px 16px',
                  borderRadius: '14px',
                  fontSize: '14px',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}>
                  {/* 如果是用户消息，去掉 /ai 前缀 */}
                  {isOwnMessage 
                    ? msg.content.startsWith('/ai ') 
                      ? msg.content.substring(4) 
                      : msg.content
                    : msg.content
                  }
                </div>
              </div>
              
              {/* 用户头像 */}
              {isOwnMessage && (
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#242f3d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  flexShrink: 0,
                  color: '#ffffff'
                }}>
                  {currentUser?.username?.[0]?.toUpperCase() || '👤'}
                </div>
              )}
            </div>
          );
        })}
        
        {/* AI正在输入提示 */}
        {isTyping && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#8596a8',
            fontSize: '13px',
            padding: '8px 16px'
          }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: '#242f3d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px'
            }}>
              🤖
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#5568c0',
                animation: 'pulse 1.5s infinite'
              }} />
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#5568c0',
                animation: 'pulse 1.5s infinite 0.2s'
              }} />
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#5568c0',
                animation: 'pulse 1.5s infinite 0.4s'
              }} />
              <div style={{
                marginLeft: '8px'
              }}>
              AI 正在思考...
            </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div style={{
        padding: '16px 20px',
        borderTop: '1px solid #242f3d'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: '#242f3d',
          borderRadius: '24px',
          padding: '8px'
        }}>
          {/* 图片上传按钮 */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected || isUploading}
            title="上传图片让AI分析"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'transparent',
              border: 'none',
              cursor: isConnected && !isUploading ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              transition: 'all 0.2s',
              opacity: isConnected ? 1 : 0.5
            }}
          >
            {isUploading ? '⌛' : '🖼️'}
          </button>
          
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={isUploading ? '正在处理图片...' : '向 AI 提问或上传图片...'}
            disabled={!isConnected || isUploading}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#ffffff',
              fontSize: '15px',
              padding: '12px 16px',
              minHeight: '20px'
            }}
          />
          
          <button
            onClick={handleSendMessage}
            disabled={!isConnected || !newMessage.trim() || isUploading}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: isConnected && newMessage.trim() && !isUploading ? '#5568c0' : '#242f3d',
              border: 'none',
              cursor: isConnected && newMessage.trim() && !isUploading ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              transition: 'all 0.2s'
            }}
          >
            🚀
          </button>
          
          {/* 隐藏的文件输入 */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            accept="image/*"
          />
        </div>
        
        {/* 上传进度显示 */}
        {isUploading && (
          <div style={{
            marginTop: '8px',
            padding: '8px 16px',
            background: '#0f1419',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#8596a8',
            textAlign: 'center'
          }}>
            📤 正在处理图片...
          </div>
        )}

        {/* 连接状态提示 */}
        {!isConnected && (
          <div style={{
            marginTop: '8px',
            padding: '8px 16px',
            background: '#2d1b1b',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#ff6b6b',
            textAlign: 'center'
          }}>
            ⚠️ 连接已断开，请检查网络连接
          </div>
        )}
      </div>

      {/* CSS动画 */}
      <style>
        {`
          @keyframes pulse {
            0%, 60%, 100% {
              opacity: 0.3;
              transform: scale(0.8);
            }
            30% {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}
      </style>
    </div>
  );
};

export default AiChatComponent;
