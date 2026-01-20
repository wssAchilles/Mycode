import React, { useState } from 'react';
import { contactAPI } from '../services/apiClient';
import './AddContactModal.css';

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
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  if (!isOpen) return null;

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setMessage('');
    try {
      const response = await contactAPI.searchUsers(searchQuery.trim());
      setSearchResults(response.users || []);
    } catch (error: any) {
      console.error('搜索用户失败:', error);
      setMessage(`搜索失败: ${error.message}`);
      setMessageType('error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddContact = async (userId: string) => {
    setAddingContactId(userId);
    setMessage('');

    try {
      await contactAPI.addContact(userId);
      setMessage('✓ 联系人请求已发送！');
      setMessageType('success');
      setTimeout(() => {
        onContactAdded();
        handleClose();
      }, 1500);
    } catch (error: any) {
      setMessage(`添加失败: ${error.message}`);
      setMessageType('error');
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // 阻止点击模态框内部时关闭
  const handleModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="tg-modal-overlay" onClick={handleClose}>
      <div className="tg-modal" onClick={handleModalClick}>
        {/* 头部 */}
        <div className="tg-modal__header">
          <h2 className="tg-modal__title">
            <span className="tg-modal__title-icon">👥</span>
            添加联系人
          </h2>
          <button
            className="tg-modal__close"
            onClick={handleClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* 内容区 */}
        <div className="tg-modal__body">
          {/* 搜索区域 */}
          <div className="tg-modal__search">
            <input
              type="text"
              className="tg-modal__search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入用户名或邮箱搜索..."
              autoFocus
            />
            <button
              className={`tg-modal__search-btn ${isSearching ? 'tg-modal__search-btn--loading' : ''}`}
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
            >
              {isSearching ? (
                <>
                  <span className="tg-modal__spinner" />
                  搜索中
                </>
              ) : (
                <>
                  🔍 搜索
                </>
              )}
            </button>
          </div>

          {/* 消息提示 */}
          {message && (
            <div className={`tg-modal__message tg-modal__message--${messageType}`}>
              {message}
            </div>
          )}

          {/* 搜索结果 */}
          <div className="tg-modal__results">
            {searchResults.length === 0 && searchQuery && !isSearching && (
              <div className="tg-modal__empty">
                <div className="tg-modal__empty-icon">🔍</div>
                <p className="tg-modal__empty-text">未找到匹配的用户</p>
              </div>
            )}

            {searchResults.map((user) => (
              <div key={user.id} className="tg-modal__user-card">
                <div
                  className="tg-modal__user-avatar"
                  style={
                    user.avatarUrl
                      ? { backgroundImage: `url(${user.avatarUrl})` }
                      : undefined
                  }
                >
                  {!user.avatarUrl && user.username.charAt(0).toUpperCase()}
                </div>

                <div className="tg-modal__user-info">
                  <div className="tg-modal__user-name">{user.username}</div>
                  <div className="tg-modal__user-email">{user.email}</div>
                </div>

                <button
                  className={`tg-modal__add-btn ${addingContactId === user.id ? 'tg-modal__add-btn--loading' : ''}`}
                  onClick={() => handleAddContact(user.id)}
                  disabled={addingContactId === user.id}
                >
                  {addingContactId === user.id ? (
                    <>
                      <span className="tg-modal__spinner" />
                      添加中
                    </>
                  ) : (
                    <>✚ 添加</>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddContactModal;
