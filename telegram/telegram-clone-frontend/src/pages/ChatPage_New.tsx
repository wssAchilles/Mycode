import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../services/apiClient';
import { useSocket } from '../hooks/useSocket';
import { useChat } from '../hooks/useChat';
import { AddContactModal } from '../components/AddContactModal';
import type { User } from '../types/auth';
import type { Message } from '../types/chat';

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
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
    selectedContact,
    messages,
    isLoadingMessages,
    hasMoreMessages,
    isLoadingContacts,
    error,
    loadContacts,
    selectContact,
    loadMoreMessages,
    addMessage,
    updateContactOnlineStatus,
    updateContactLastMessage,
  } = useChat();

  // 初始化用户信息和Socket连接
  useEffect(() => {
    const initializeUser = async () => {
      try {
        const user = await authAPI.getCurrentUser();
        if (user) {
          setCurrentUser(user);
          console.log('🎉 ChatPage 成功渲染，当前用户:', user.username);
          // 初始化Socket连接
          initializeSocket();
        } else {
          console.warn('未找到用户信息，重定向到登录页');
          navigate('/login');
        }
      } catch (error) {
        console.error('获取用户信息失败:', error);
        navigate('/login');
      }
    };

    initializeUser();
  }, [navigate, initializeSocket]);

  // 监听Socket连接状态
  useEffect(() => {
    const checkConnection = () => {
      setIsConnected(socketConnected);
    };
    
    checkConnection();
    const interval = setInterval(checkConnection, 1000);
    
    return () => clearInterval(interval);
  }, [socketConnected]);

  // 监听消息
  useEffect(() => {
    const cleanup = onMessage((data: any) => {
      console.log('收到消息:', data);
      
      if (data.type === 'chat' && data.data) {
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
        
        // 更新联系人最后一条消息
        updateContactLastMessage(message.userId, message);
      }
      
      // 处理用户上线/下线状态
      if (data.type === 'userOnline') {
        updateContactOnlineStatus(data.userId, true);
      } else if (data.type === 'userOffline') {
        updateContactOnlineStatus(data.userId, false, data.lastSeen);
      }
    });

    return cleanup;
  }, [onMessage, addMessage, updateContactLastMessage, updateContactOnlineStatus]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      disconnectSocket();
    };
  }, [disconnectSocket]);

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('登出失败:', error);
    }
    navigate('/login');
  };

  const handleSendMessage = () => {
    if (newMessage.trim() && isConnected && selectedContact) {
      console.log('发送消息给:', selectedContact.username, newMessage);
      sendMessage(newMessage.trim());
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

          {/* 联系人列表 */}
          <div style={{
            flex: 1,
            overflowY: 'auto'
          }}>
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

            {/* 联系人列表 */}
            {!isLoadingContacts && !error && contacts.length === 0 && (
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

            {contacts.map((contact) => (
              <div
                key={contact.id}
                onClick={() => selectContact(contact)}
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid #2f3e4c',
                  background: selectedContact?.id === contact.id ? '#242f3d' : 'transparent',
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
          </div>
        </div>

        {/* 右侧聊天区域 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#0e1621'
        }}>
          {selectedContact ? (
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
                  messages.map((msg, index) => (
                    <div key={index} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      maxWidth: '70%',
                      alignSelf: msg.userId === currentUser?.id ? 'flex-end' : 'flex-start'
                    }}>
                      {msg.userId !== currentUser?.id && (
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
                        background: msg.userId === currentUser?.id ? '#5568c0' : '#242f3d',
                        color: '#ffffff',
                        padding: '12px 16px',
                        borderRadius: '18px',
                        borderTopLeftRadius: msg.userId === currentUser?.id ? '18px' : '4px',
                        borderTopRightRadius: msg.userId === currentUser?.id ? '4px' : '18px',
                        maxWidth: '100%',
                        wordBreak: 'break-word'
                      }}>
                        {msg.userId !== currentUser?.id && (
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
                          {msg.content}
                        </div>
                        <div style={{
                          fontSize: '12px',
                          color: msg.userId === currentUser?.id ? 'rgba(255,255,255,0.7)' : '#8596a8',
                          marginTop: '4px',
                          textAlign: 'right'
                        }}>
                          {formatTime(msg.timestamp)}
                        </div>
                      </div>
                    </div>
                  ))
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
                  gap: '12px',
                  background: '#0f1419',
                  borderRadius: '24px',
                  padding: '8px 8px 8px 20px'
                }}>
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
                      padding: '12px 0',
                      minHeight: '20px'
                    }}
                  />
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
                </div>
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
