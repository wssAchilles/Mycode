import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI, authUtils, contactAPI } from '../services/apiClient';
import { useSocket } from '../hooks/useSocket';
import { useChat } from '../hooks/useChat';
import { AddContactModal } from '../components/AddContactModal';
import AiChatComponent from '../components/AiChatComponent';
import type { User } from '../types/auth';
import type { Message } from '../types/chat';

// API 基础 URL 配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

// 工具函数：将相对URL转换为完整的后端URL
const getFullFileUrl = (fileUrl: string): string => {
  if (!fileUrl) return '#';

  // 如果已经是完整URL，直接返回
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl;
  }

  // 如果是相对URL，拼接后端基础URL
  const cleanUrl = fileUrl.startsWith('/') ? fileUrl : '/' + fileUrl;
  const token = localStorage.getItem('accessToken');
  const separator = cleanUrl.includes('?') ? '&' : '?';
  const tokenQuery = token ? `${separator}token=${encodeURIComponent(token)}` : '';
  return `${API_BASE_URL}${cleanUrl}${tokenQuery}`;
};

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isAiChatMode, setIsAiChatMode] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // 处理联系人请求（接受/拒绝）
  const handleContactRequest = async (requestId: string, action: 'accept' | 'reject') => {
    try {
      await contactAPI.handleRequest(requestId, action);

      // 成功后刷新待处理请求和联系人列表
      await loadPendingRequests();
      await loadContacts();

      console.log(`${action === 'accept' ? '接受' : '拒绝'}请求成功`);
    } catch (error: any) {
      console.error('处理联系人请求失败:', error);
      alert(error.message || '操作失败，请重试');
    }
  };

  // Socket.IO Hook
  const {
    initializeSocket,
    disconnectSocket,
    sendMessage,
    onMessage,
    isConnected: socketConnected,
  } = useSocket();

  // Chat Hook - 管理联系人和消息
  const {
    contacts,
    pendingRequests,
    selectedContact,
    messages,
    isLoadingMessages,
    hasMoreMessages,
    isLoadingContacts,
    isLoadingPendingRequests,
    error,
    loadContacts,
    loadPendingRequests,
    selectContact,
    loadMoreMessages,
    addMessage,
    updateContactOnlineStatus,
    updateContactLastMessage,
  } = useChat();

  // 初始化用户信息
  useEffect(() => {
    const initializeUser = async () => {
      try {
        // 检查本地存储的用户信息
        const localUser = authUtils.getCurrentUser();
        if (localUser) {
          setCurrentUser(localUser);
          console.log('🎉 ChatPage 成功渲染，当前用户:', localUser.username);
          // 初始化Socket连接
          initializeSocket();
        } else {
          console.warn('未找到用户信息，重定向到登录页');
          navigate('/login', { replace: true });
          return;
        }
      } catch (error) {
        console.error('获取用户信息失败:', error);
        navigate('/login', { replace: true });
      }
    };

    initializeUser();
  }, [navigate, initializeSocket]);

  // 监听Socket连接状态
  useEffect(() => {
    let isMounted = true;

    const checkConnection = () => {
      if (isMounted) {
        setIsConnected(socketConnected);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 3000); // 减少检查频率

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [socketConnected]);

  // 监听消息
  useEffect(() => {
    let isMounted = true;

    const handleMessage = (data: any) => {
      if (!isMounted) return;

      console.log('收到消息:', data);

      if (data.type === 'chat' && data.data) {
        // 添加安全检查，确保data.data存在必要字段
        if (!data.data.content) {
          console.warn('⚠️ 消息内容为空，跳过处理');
          return;
        }

        const message: Message = {
          id: data.data.id || Date.now().toString(),
          content: data.data.content,
          senderId: data.data.senderId || data.data.userId || 'unknown',
          senderUsername: data.data.senderUsername || data.data.username || '未知用户',
          userId: data.data.userId || data.data.senderId || 'unknown',
          username: data.data.username || data.data.senderUsername || '未知用户',
          timestamp: data.data.timestamp || new Date().toISOString(),
          type: data.data.type || 'text',
          isGroupChat: false,
        };

        // 添加消息到当前会话
        addMessage(message);

        // 安全检查userId后再更新联系人消息
        if (message.userId && message.userId !== 'unknown') {
          updateContactLastMessage(message.userId, message);
        } else {
          console.warn('⚠️ message.userId为空或unknown，跳过更新联系人消息');
        }
      }

      // 处理用户上线/下线状态
      if (data.type === 'userOnline') {
        updateContactOnlineStatus(data.userId, true);
      } else if (data.type === 'userOffline') {
        updateContactOnlineStatus(data.userId, false, data.lastSeen);
      }
    };

    const cleanup = onMessage(handleMessage);

    return () => {
      isMounted = false;
      if (cleanup) cleanup();
    };
  }, [onMessage, addMessage, updateContactLastMessage, updateContactOnlineStatus]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      console.log('🧹 ChatPage 组件卸载，清理资源...');
      disconnectSocket();
    };
  }, [disconnectSocket]);

  // 点击外部关闭表情包选择器
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('登出失败:', error);
    }
    navigate('/login');
  };

  // 文件上传处理
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || (!selectedContact && !isAiChatMode) || !isConnected) return;

    setIsUploading(true);

    try {
      // AI模式下的图片处理
      if (isAiChatMode && file.type.startsWith('image/')) {
        // 将图片转换为Base64
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const base64Data = (e.target?.result as string)?.split(',')[1]; // 去掉data:image/jpeg;base64,前缀

            if (base64Data) {
              // 构建AI消息数据
              const aiMessageData = {
                content: newMessage || '请分析这张图片',
                imageData: {
                  mimeType: file.type,
                  base64Data: base64Data,
                  fileName: file.name,
                  fileSize: file.size
                }
              };

              // 发送AI图片消息 - 使用JSON格式传递图片数据
              const aiMessage = JSON.stringify({
                content: aiMessageData.content,
                imageData: aiMessageData.imageData
              });
              console.log('🤖 发送AI图片消息:', aiMessage);

              // 使用sendMessage发送给AI
              sendMessage(aiMessage, 'ai');

              // 清空输入框
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
        return;
      }

      // 普通模式下的文件上传
      const formData = new FormData();
      formData.append('file', file);

      // 上传文件到后端
      const response = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        },
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        // 发送包含文件信息的消息
        const fileMessage = {
          receiverId: selectedContact!.userId,
          content: result.data.fileName, // 使用文件名作为消息内容
          type: result.data.fileType,
          fileUrl: result.data.fileUrl,
          fileName: result.data.fileName,
          fileSize: result.data.fileSize,
          mimeType: result.data.mimeType,
          thumbnailUrl: result.data.thumbnailUrl
        };

        // 通过Socket发送文件消息
        sendMessage(JSON.stringify(fileMessage), selectedContact!.userId);

        console.log('📁 文件上传成功:', result.data);
      } else {
        throw new Error(result.message || '文件上传失败');
      }
    } catch (error) {
      console.error('❌ 文件上传失败:', error);
      alert('文件上传失败，请重试');
    } finally {
      setIsUploading(false);
      // 清空文件输入
      event.target.value = '';
    }
  };

  // 表情包选择处理
  const handleEmojiSelect = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // 常用表情包列表
  const commonEmojis = [
    '😀', '😁', '😂', '🤣', '😄', '😅', '😆', '😉',
    '😊', '😋', '😍', '🥰', '😘', '😗', '😙', '😚',
    '🙂', '🙃', '😉', '😌', '😔', '😑', '😐', '😯',
    '🙄', '😮', '😭', '😨', '😰', '😩', '😢', '😱',
    '😥', '😪', '😴', '😎', '🤓', '🤔', '🤗', '🤭',
    '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🙏',
    '❤️', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
    '🔥', '✨', '⭐', '🎉', '🎈', '🎂', '🎁', '🎀'
  ];

  const handleSendMessage = () => {
    if (newMessage.trim() && isConnected) {
      if (isAiChatMode) {
        // AI模式：发送给AI助手
        const aiMessage = `/ai ${newMessage.trim()}`;
        console.log('🤖 发送AI消息:', aiMessage);
        sendMessage(aiMessage, 'ai');
      } else if (selectedContact) {
        // 普通模式：发送给联系人
        console.log('💬 发送消息给:', selectedContact.username, newMessage, '用户ID:', selectedContact.userId);
        sendMessage(newMessage.trim(), selectedContact.userId);
      }
      setNewMessage('');
    }
  };

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // 监听消息变化，自动滚动
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 处理滚动加载更多消息
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop } = e.currentTarget;

    // 当滚动到顶部时加载更多消息
    if (scrollTop === 0 && hasMoreMessages && !isLoadingMessages) {
      loadMoreMessages();
    }
  }, [hasMoreMessages, isLoadingMessages, loadMoreMessages]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  // 渲染不同类型的消息内容
  const renderMessageContent = (msg: Message) => {
    // 如果消息类型是文本或没有指定类型，直接显示内容
    if (!msg.type || msg.type === 'text') {
      return <span>{msg.content}</span>;
    }

    // 尝试解析文件消息的JSON内容
    let fileData: any = null;
    try {
      fileData = JSON.parse(msg.content);
    } catch {
      // 如果解析失败，可能是普通文本消息，直接显示
      return <span>{msg.content}</span>;
    }

    // 安全函数：净化URL防止XSS
    const sanitizeUrl = (url: string) => {
      if (!url) return '#';
      // 只允许相对路径和特定协议
      if (url.startsWith('/') || url.startsWith('http://localhost') || url.startsWith('https://')) {
        return url;
      }
      return '#';
    };

    // 根据文件类型渲染不同内容
    if (msg.type === 'image' && fileData.fileUrl) {
      return (
        <div style={{ maxWidth: '300px' }}>
          <img
            src={sanitizeUrl(getFullFileUrl(fileData.thumbnailUrl || fileData.fileUrl))}
            alt={fileData.fileName || '图片'}
            style={{
              maxWidth: '100%',
              height: 'auto',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'block'
            }}
            onClick={() => {
              // 点击图片在新窗口打开原图
              const fullUrl = sanitizeUrl(getFullFileUrl(fileData.fileUrl));
              if (fullUrl !== '#') {
                window.open(fullUrl, '_blank');
              }
            }}
          />
          {fileData.fileName && (
            <div style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.7)',
              marginTop: '4px',
              textAlign: 'center'
            }}>
              {fileData.fileName}
            </div>
          )}
        </div>
      );
    }

    // 其他文件类型（document, audio, video等）
    if (fileData.fileUrl && fileData.fileName) {
      // 根据MIME类型或文件扩展名确定图标
      const getFileIcon = (mimeType: string, fileName: string) => {
        if (mimeType?.includes('pdf') || fileName?.endsWith('.pdf')) return '📄';
        if (mimeType?.includes('word') || fileName?.match(/\.(doc|docx)$/i)) return '📝';
        if (mimeType?.includes('excel') || fileName?.match(/\.(xls|xlsx)$/i)) return '📊';
        if (mimeType?.includes('powerpoint') || fileName?.match(/\.(ppt|pptx)$/i)) return '📽️';
        if (mimeType?.includes('audio') || fileName?.match(/\.(mp3|wav|flac|aac)$/i)) return '🎵';
        if (mimeType?.includes('video') || fileName?.match(/\.(mp4|avi|mov|mkv)$/i)) return '🎥';
        if (mimeType?.includes('zip') || fileName?.match(/\.(zip|rar|7z)$/i)) return '🗜️';
        if (mimeType?.includes('text') || fileName?.endsWith('.txt')) return '📝';
        return '📎'; // 默认文件图标
      };

      const fileIcon = getFileIcon(fileData.mimeType, fileData.fileName);
      const fileSize = fileData.fileSize ? formatFileSize(fileData.fileSize) : '';

      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          maxWidth: '300px'
        }}>
          <div style={{ fontSize: '24px' }}>{fileIcon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <a
              href={sanitizeUrl(getFullFileUrl(fileData.fileUrl))}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#ffffff',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: '500',
                display: 'block',
                wordBreak: 'break-all',
                cursor: 'pointer'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.textDecoration = 'underline';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.textDecoration = 'none';
              }}
            >
              {fileData.fileName}
            </a>
            {fileSize && (
              <div style={{
                fontSize: '12px',
                color: 'rgba(255,255,255,0.6)',
                marginTop: '2px'
              }}>
                {fileSize}
              </div>
            )}
          </div>
          <div style={{
            fontSize: '12px',
            color: 'rgba(255,255,255,0.5)'
          }}>
            📥
          </div>
        </div>
      );
    }

    // 如果无法识别文件格式，显示原始内容
    return <span>{msg.content}</span>;
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <>
      <div style={{
        display: 'flex',
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
        background: '#0f1419'
      }}>
        {/* 左侧边栏 - 联系人列表 */}
        <div style={{
          width: '420px',
          background: '#17212b',
          borderRight: '1px solid #2f3e4c',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* 顶部导航 */}
          <div style={{
            padding: '16px 20px',
            background: '#17212b',
            borderBottom: '1px solid #2f3e4c',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '18px'
              }}>
                {currentUser?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div>
                <div style={{ color: '#ffffff', fontSize: '16px', fontWeight: '500' }}>
                  {currentUser?.username || '用户'}
                </div>
                <div style={{
                  color: isConnected ? '#50a803' : '#ff6b6b',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: isConnected ? '#50a803' : '#ff6b6b'
                  }} />
                  {isConnected ? '在线' : '离线'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowAddContactModal(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#8596a8',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '6px',
                  fontSize: '18px'
                }}
                title="添加联系人"
              >
                ➕
              </button>
              <button
                onClick={handleLogout}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#8596a8',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '6px',
                  fontSize: '20px'
                }}
                title="登出"
              >
                ⚙️
              </button>
            </div>
          </div>

          {/* 搜索框 */}
          <div style={{
            padding: '12px 20px',
            borderBottom: '1px solid #2f3e4c'
          }}>
            <div style={{
              background: '#0f1419',
              borderRadius: '20px',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ color: '#8596a8', fontSize: '16px' }}>🔍</span>
              <input
                type="text"
                placeholder="搜索联系人"
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#ffffff',
                  fontSize: '14px',
                  flex: 1
                }}
              />
            </div>
          </div>

          {/* AI 助手入口 */}
          <div
            onClick={() => {
              setIsAiChatMode(true);
              // 清除普通联系人选择，进入 AI 模式
              selectContact(null);
            }}
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid #2f3e4c',
              background: isAiChatMode ? '#242f3d' : 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              transition: 'background 0.2s'
            }}
          >
            <div style={{
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px'
            }}>
              🤖
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px'
              }}>
                <div style={{
                  color: '#ffffff',
                  fontSize: '16px',
                  fontWeight: '500'
                }}>
                  Gemini AI 助手
                </div>
                <div style={{
                  background: '#50a803',
                  color: '#ffffff',
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  fontWeight: '500'
                }}>
                  AI
                </div>
              </div>
              <div style={{
                color: '#8596a8',
                fontSize: '14px'
              }}>
                点击开始AI对话
              </div>
            </div>
          </div>

          {/* 加载状态 */}
          {isLoadingContacts && (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#8596a8'
            }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
              <div>加载联系人中...</div>
            </div>
          )}

          {/* 错误状态 */}
          {error && (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: '#ff6b6b'
            }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>❌</div>
              <div>{error}</div>
              <button
                onClick={loadContacts}
                style={{
                  marginTop: '12px',
                  padding: '8px 16px',
                  background: '#5568c0',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                重试
              </button>
            </div>
          )}

          {/* 待处理请求加载状态 */}
          {isLoadingPendingRequests && (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: '#8596a8'
            }}>
              <div style={{ fontSize: '20px', marginBottom: '8px' }}>⏳</div>
              <div>加载待处理请求中...</div>
            </div>
          )}

          {/* 待处理的联系人请求 */}
          {!isLoadingPendingRequests && pendingRequests.length > 0 && (
            <>
              <div style={{
                padding: '12px 20px 8px',
                fontSize: '14px',
                fontWeight: '500',
                color: '#8596a8',
                borderBottom: '1px solid #2f3e4c'
              }}>
                待处理请求 ({pendingRequests.length})
              </div>
              {pendingRequests.map((request) => (
                <div
                  key={request.id}
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #2f3e4c',
                    background: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '50%',
                    background: request.avatarUrl
                      ? `url(${request.avatarUrl})`
                      : 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '20px'
                  }}>
                    {!request.avatarUrl && request.username.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '16px',
                      fontWeight: '500',
                      color: '#ffffff',
                      marginBottom: '4px'
                    }}>
                      {request.alias || request.username}
                    </div>
                    <div style={{
                      fontSize: '14px',
                      color: '#8596a8'
                    }}>
                      想要添加您为联系人
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      style={{
                        padding: '6px 12px',
                        background: '#50a803',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                      onClick={() => handleContactRequest(request.id, 'accept')}
                    >
                      接受
                    </button>
                    <button
                      style={{
                        padding: '6px 12px',
                        background: '#ff6b6b',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                      onClick={() => handleContactRequest(request.id, 'reject')}
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              ))}
              <div style={{
                height: '8px',
                background: '#0f1419',
                borderBottom: '1px solid #2f3e4c'
              }} />
            </>
          )}

          {/* 联系人列表 */}
          {!isLoadingContacts && !error && contacts.length === 0 && pendingRequests.length === 0 && (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#8596a8'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>👥</div>
              <div style={{ marginBottom: '8px' }}>暂无联系人</div>
              <div style={{ fontSize: '14px' }}>点击右上角 + 添加联系人</div>
            </div>
          )}

          {contacts.length > 0 && (
            <>
              <div style={{
                padding: '12px 20px 8px',
                fontSize: '14px',
                fontWeight: '500',
                color: '#8596a8',
                borderBottom: '1px solid #2f3e4c'
              }}>
                联系人 ({contacts.length})
              </div>
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  onClick={() => {
                    setIsAiChatMode(false); // 退出AI模式
                    selectContact(contact);
                  }}
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #2f3e4c',
                    background: selectedContact?.id === contact.id && !isAiChatMode ? '#242f3d' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    transition: 'background 0.2s'
                  }}
                >
                  <div style={{
                    position: 'relative'
                  }}>
                    <div style={{
                      width: '50px',
                      height: '50px',
                      borderRadius: '50%',
                      background: contact.avatarUrl
                        ? `url(${contact.avatarUrl})`
                        : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 'bold',
                      fontSize: '20px'
                    }}>
                      {!contact.avatarUrl && contact.username.charAt(0).toUpperCase()}
                    </div>
                    {/* 在线状态指示器 */}
                    <div style={{
                      position: 'absolute',
                      bottom: '2px',
                      right: '2px',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: contact.isOnline ? '#50a803' : '#8596a8',
                      border: '2px solid #17212b'
                    }} />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '4px'
                    }}>
                      <div style={{
                        color: '#ffffff',
                        fontSize: '16px',
                        fontWeight: '500'
                      }}>
                        {contact.alias || contact.username}
                      </div>
                      <div style={{ color: '#8596a8', fontSize: '13px' }}>
                        {contact.lastMessage
                          ? formatTime(contact.lastMessage.timestamp)
                          : (contact.isOnline ? '在线' : '离线')
                        }
                      </div>
                    </div>
                    <div style={{ color: '#8596a8', fontSize: '14px' }}>
                      {contact.lastMessage
                        ? `${contact.lastMessage.username}: ${contact.lastMessage.content}`
                        : '开始聊天吧！'
                      }
                    </div>
                  </div>

                  {contact.unreadCount > 0 && (
                    <div style={{
                      background: '#50a803',
                      color: 'white',
                      borderRadius: '50%',
                      width: '20px',
                      height: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      {contact.unreadCount}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column'
        }}>
          {isAiChatMode ? (
            /* AI聊天界面 */
            <AiChatComponent
              currentUser={currentUser}
              messages={messages}
              onSendMessage={(message: string, imageData?: any) => {
                if (imageData) {
                  // 包含图片的AI消息
                  const aiMessageData = {
                    content: message,
                    imageData: imageData
                  };
                  sendMessage(JSON.stringify(aiMessageData), 'ai');
                } else {
                  // 纯文本AI消息
                  const aiMessage = message.startsWith('/ai ') ? message : `/ai ${message}`;
                  sendMessage(aiMessage, 'ai');
                }
              }}
              isConnected={socketConnected}
              onBackToContacts={() => setIsAiChatMode(false)}
              onReceiveMessage={(response: any) => {
                // 将AI响应转换为Message类型并在UI中显示
                const aiMessage: any = {
                  id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  content: response.message,
                  senderId: 'ai-assistant',
                  senderUsername: 'Gemini AI',
                  userId: 'ai-assistant',
                  username: 'Gemini AI',
                  timestamp: response.timestamp || new Date().toISOString(),
                  type: 'text',
                  isGroupChat: false
                };
                addMessage(aiMessage);
              }}
            />
          ) : selectedContact ? (
            <>
              {/* 聊天头部 */}
              <div style={{
                padding: '16px 24px',
                background: '#17212b',
                borderBottom: '1px solid #2f3e4c',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  background: selectedContact.avatarUrl
                    ? `url(${selectedContact.avatarUrl})`
                    : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '18px'
                }}>
                  {!selectedContact.avatarUrl && selectedContact.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ color: '#ffffff', fontSize: '18px', fontWeight: '600' }}>
                    {selectedContact.alias || selectedContact.username}
                  </div>
                  <div style={{ color: '#8596a8', fontSize: '14px' }}>
                    {selectedContact.isOnline ? '在线' : `最后上线: ${selectedContact.lastSeen ? formatTime(selectedContact.lastSeen) : '未知'}`}
                  </div>
                </div>
              </div>

              {/* 消息区域 */}
              <div
                ref={messagesContainerRef}
                onScroll={handleScroll}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '16px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                {/* 加载更多消息指示器 */}
                {isLoadingMessages && (
                  <div style={{
                    textAlign: 'center',
                    padding: '16px',
                    color: '#8596a8'
                  }}>
                    <div style={{ fontSize: '18px', marginBottom: '8px' }}>⏳</div>
                    <div>加载消息中...</div>
                  </div>
                )}

                {/* 消息列表 */}
                {messages.length === 0 && !isLoadingMessages ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: '#8596a8',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '64px', marginBottom: '16px' }}>💬</div>
                    <h2 style={{ margin: '0 0 8px 0', color: '#ffffff' }}>开始聊天</h2>
                    <p style={{ margin: 0, fontSize: '16px' }}>发送消息开始对话</p>
                  </div>
                ) : (
                  messages.map((msg, index) => {
                    const isOwnMessage = msg.userId === currentUser?.id || msg.senderId === currentUser?.id;
                    return (
                      <div key={index} style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        maxWidth: '70%',
                        alignSelf: isOwnMessage ? 'flex-end' : 'flex-start'
                      }}>
                        {!isOwnMessage && (
                          <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '14px',
                            flexShrink: 0
                          }}>
                            {msg.username?.charAt(0).toUpperCase() || 'U'}
                          </div>
                        )}
                        <div style={{
                          background: isOwnMessage ? '#5568c0' : '#242f3d',
                          color: '#ffffff',
                          padding: '12px 16px',
                          borderRadius: '18px',
                          borderTopLeftRadius: isOwnMessage ? '18px' : '4px',
                          borderTopRightRadius: isOwnMessage ? '4px' : '18px',
                          maxWidth: '100%',
                          wordBreak: 'break-word'
                        }}>
                          {!isOwnMessage && (
                            <div style={{
                              fontSize: '13px',
                              color: '#50a803',
                              marginBottom: '4px',
                              fontWeight: '500'
                            }}>
                              {msg.username}
                            </div>
                          )}
                          <div style={{ fontSize: '15px', lineHeight: '1.4' }}>
                            {renderMessageContent(msg)}
                          </div>
                          <div style={{
                            fontSize: '12px',
                            color: isOwnMessage ? 'rgba(255,255,255,0.7)' : '#8596a8',
                            marginTop: '4px',
                            textAlign: 'right'
                          }}>
                            {formatTime(msg.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* 滚动锚点 */}
                <div ref={messagesEndRef} />
              </div>

              {/* 输入区域 */}
              <div style={{
                padding: '16px 24px',
                background: '#17212b',
                borderTop: '1px solid #2f3e4c'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '8px',
                  background: '#0f1419',
                  borderRadius: '24px',
                  padding: '8px'
                }}>
                  {/* 文件上传按钮 */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isConnected || isUploading}
                    title="发送文件"
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
                    {isUploading ? '⌛' : '📎'}
                  </button>

                  {/* 图片上传按钮 */}
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                          handleFileUpload({ target: { files: [file] } } as any);
                        }
                      };
                      input.click();
                    }}
                    disabled={!isConnected || isUploading}
                    title="发送图片"
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

                  {/* 表情包按钮 */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      disabled={!isConnected}
                      title="表情包"
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: 'transparent',
                        border: 'none',
                        cursor: isConnected ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '18px',
                        transition: 'all 0.2s',
                        opacity: isConnected ? 1 : 0.5
                      }}
                    >
                      😊
                    </button>

                    {/* 表情包选择器 */}
                    {showEmojiPicker && (
                      <div
                        ref={emojiPickerRef}
                        style={{
                          position: 'absolute',
                          bottom: '45px',
                          right: '0',
                          background: '#17212b',
                          border: '1px solid #2f3e4c',
                          borderRadius: '12px',
                          padding: '16px',
                          width: '320px',
                          maxHeight: '200px',
                          overflowY: 'auto',
                          zIndex: 1000,
                          boxShadow: '0 8px 20px rgba(0, 0, 0, 0.3)'
                        }}
                      >
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(8, 1fr)',
                          gap: '8px'
                        }}>
                          {commonEmojis.map((emoji, index) => (
                            <button
                              key={index}
                              onClick={() => handleEmojiSelect(emoji)}
                              style={{
                                width: '32px',
                                height: '32px',
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                fontSize: '20px',
                                borderRadius: '6px',
                                transition: 'background 0.2s'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = '#242f3d';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 文本输入框 */}
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="输入消息..."
                    disabled={!isConnected}
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

                  {/* 发送按钮 */}
                  <button
                    onClick={handleSendMessage}
                    disabled={!isConnected || !newMessage.trim()}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: isConnected && newMessage.trim() ? '#5568c0' : '#242f3d',
                      border: 'none',
                      cursor: isConnected && newMessage.trim() ? 'pointer' : 'not-allowed',
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
                    accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.zip,.rar"
                  />
                </div>

                {/* 上传进度显示 */}
                {isUploading && (
                  <div style={{
                    margin: '8px 0',
                    padding: '8px 16px',
                    background: '#0f1419',
                    borderRadius: '8px',
                    fontSize: '14px',
                    color: '#8596a8'
                  }}>
                    📤 正在上传文件...
                  </div>
                )}
              </div>
            </>
          ) : (
            /* 未选择联系人时的欢迎界面 */
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#8596a8',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '120px', marginBottom: '24px' }}>💬</div>
              <h1 style={{ margin: '0 0 16px 0', color: '#ffffff', fontSize: '28px' }}>
                欢迎使用 Telegram Clone
              </h1>
              <p style={{ margin: '0 0 24px 0', fontSize: '16px', maxWidth: '400px' }}>
                选择一个联系人开始聊天，或者添加新联系人开始使用
              </p>
              <button
                onClick={() => setShowAddContactModal(true)}
                style={{
                  padding: '12px 24px',
                  background: '#5568c0',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: '500'
                }}
              >
                + 添加联系人
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 添加联系人模态框 */}
      <AddContactModal
        isOpen={showAddContactModal}
        onClose={() => setShowAddContactModal(false)}
        onContactAdded={() => {
          loadContacts(); // 重新加载联系人列表
          setShowAddContactModal(false);
        }}
      />
    </>
  );
};

export default ChatPage;
