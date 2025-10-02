import React, { useState } from 'react';
import { contactAPI } from '../services/apiClient';

interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContactAdded: () => void;
}

export const AddContactModal: React.FC<AddContactModalProps> = ({
  isOpen,
  onClose,
  onContactAdded,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingContactId, setAddingContactId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  if (!isOpen) return null;

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await contactAPI.searchUsers(searchQuery.trim());
      setSearchResults(response.users || []);
    } catch (error: any) {
      console.error('搜索用户失败:', error);
      setMessage(`搜索失败: ${error.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddContact = async (userId: string) => {
    setAddingContactId(userId);
    setMessage('');

    try {
      await contactAPI.addContact(userId);
      setMessage('联系人请求已发送！');
      setTimeout(() => {
        onContactAdded();
        onClose();
      }, 1500);
    } catch (error: any) {
      setMessage(`添加失败: ${error.message}`);
    } finally {
      setAddingContactId(null);
    }
  };

  const handleClose = () => {
    setSearchQuery('');
    setSearchResults([]);
    setMessage('');
    setAddingContactId(null);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#17212b',
        borderRadius: '12px',
        width: '90%',
        maxWidth: '500px',
        maxHeight: '80vh',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
      }}>
        {/* 头部 */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid #2f3e4c',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h2 style={{
            margin: 0,
            color: '#ffffff',
            fontSize: '18px',
            fontWeight: '600',
          }}>
            添加联系人
          </h2>
          <button
            onClick={handleClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8596a8',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* 搜索区域 */}
        <div style={{ padding: '20px' }}>
          <div style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '16px',
          }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入用户名或邮箱搜索..."
              style={{
                flex: 1,
                padding: '12px 16px',
                background: '#0f1419',
                border: '1px solid #2f3e4c',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              style={{
                padding: '12px 20px',
                background: searchQuery.trim() ? '#5568c0' : '#2f3e4c',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                cursor: searchQuery.trim() ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: '500',
              }}
            >
              {isSearching ? '搜索中...' : '🔍 搜索'}
            </button>
          </div>

          {/* 消息提示 */}
          {message && (
            <div style={{
              padding: '12px',
              background: message.includes('失败') ? '#ff4757' : '#50a803',
              color: '#ffffff',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '14px',
              textAlign: 'center',
            }}>
              {message}
            </div>
          )}

          {/* 搜索结果 */}
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
          }}>
            {searchResults.length === 0 && searchQuery && !isSearching && (
              <div style={{
                textAlign: 'center',
                color: '#8596a8',
                padding: '40px 20px',
              }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔍</div>
                <p>未找到匹配的用户</p>
              </div>
            )}

            {searchResults.map((user) => (
              <div
                key={user.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  background: '#0f1419',
                  borderRadius: '8px',
                  marginBottom: '8px',
                }}
              >
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: user.avatarUrl 
                    ? `url(${user.avatarUrl})` 
                    : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  fontWeight: 'bold',
                  fontSize: '16px',
                }}>
                  {!user.avatarUrl && user.username.charAt(0).toUpperCase()}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{
                    color: '#ffffff',
                    fontSize: '16px',
                    fontWeight: '500',
                    marginBottom: '2px',
                  }}>
                    {user.username}
                  </div>
                  <div style={{
                    color: '#8596a8',
                    fontSize: '14px',
                  }}>
                    {user.email}
                  </div>
                </div>

                <button
                  onClick={() => handleAddContact(user.id)}
                  disabled={addingContactId === user.id}
                  style={{
                    padding: '8px 16px',
                    background: addingContactId === user.id ? '#2f3e4c' : '#50a803',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: addingContactId === user.id ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                  }}
                >
                  {addingContactId === user.id ? '添加中...' : '+ 添加'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
