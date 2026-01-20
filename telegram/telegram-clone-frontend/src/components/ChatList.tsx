import React, { useState, useEffect } from 'react';
import { contactAPI, groupAPI } from '../services/apiClient';
import { useRecommendation } from '../hooks/useRecommendation';
import './ChatList.css';

interface Contact {
  id: string;
  userId: string;
  contactId: string;
  status: string;
  alias?: string;
  addedAt: string;
  ContactUser?: {
    id: string;
    username: string;
    email: string;
    avatarUrl?: string;
  };
}

interface Group {
  id: string;
  name: string;
  description?: string;
  type: string;
  avatarUrl?: string;
  memberCount: number;
  memberRole: string;
  joinedAt: string;
}

interface ChatListProps {
  onChatSelect: (chatId: string, chatType: 'contact' | 'group', chatInfo?: any) => void;
  selectedChatId?: string;
}

export const ChatList: React.FC<ChatListProps> = ({ onChatSelect, selectedChatId }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'contacts' | 'groups'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // const [useSmartSort, setUseSmartSort] = useState(true); // 智能排序开关

  // 使用推荐系统 Hook
  useRecommendation({ limit: 100 });

  // 加载联系人和群组
  useEffect(() => {
    loadChats();
  }, []);

  const loadChats = async () => {
    try {
      setLoading(true);

      // 并行加载联系人和群组
      const [contactsRes, groupsRes] = await Promise.allSettled([
        contactAPI.getContacts('accepted'),
        groupAPI.getUserGroups()
      ]);

      if (contactsRes.status === 'fulfilled') {
        setContacts(contactsRes.value.contacts || []);
      } else {
        console.error('加载联系人失败:', contactsRes.reason);
      }

      if (groupsRes.status === 'fulfilled') {
        setGroups(groupsRes.value.groups || []);
      } else {
        console.error('加载群组失败:', groupsRes.reason);
      }
    } catch (error) {
      console.error('加载聊天列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 过滤聊天列表
  const filteredChats = () => {
    let allChats: Array<{
      id: string;
      name: string;
      type: 'contact' | 'group';
      avatar?: string;
      lastMessage?: string;
      time?: string;
      unreadCount?: number;
      data: Contact | Group;
    }> = [];

    // 添加联系人
    if (activeTab === 'all' || activeTab === 'contacts') {
      const contactChats = contacts.map(contact => ({
        id: contact.ContactUser?.id || contact.contactId,
        name: contact.alias || contact.ContactUser?.username || '未知用户',
        type: 'contact' as const,
        avatar: contact.ContactUser?.avatarUrl,
        lastMessage: '点击开始聊天...',
        time: new Date(contact.addedAt).toLocaleDateString(),
        unreadCount: 0,
        data: contact
      }));
      allChats = [...allChats, ...contactChats];
    }

    // 添加群组
    if (activeTab === 'all' || activeTab === 'groups') {
      const groupChats = groups.map(group => ({
        id: group.id,
        name: group.name,
        type: 'group' as const,
        avatar: group.avatarUrl,
        lastMessage: `${group.memberCount} 个成员`,
        time: new Date(group.joinedAt).toLocaleDateString(),
        unreadCount: 0,
        data: group
      }));
      allChats = [...allChats, ...groupChats];
    }

    // 搜索过滤
    if (searchQuery.trim()) {
      allChats = allChats.filter(chat =>
        chat.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return allChats;
  };

  const handleChatClick = (chat: any) => {
    onChatSelect(chat.id, chat.type, chat.data);
  };

  if (loading) {
    return (
      <div className="chat-list">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>加载聊天列表...</p>
        </div>
      </div>
    );
  }

  const chats = filteredChats();

  return (
    <div className="chat-list">
      {/* 搜索栏 */}
      <div className="search-bar">
        <div className="search-input-container">
          <input
            type="text"
            placeholder="搜索联系人和群组..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <span className="search-icon">🔍</span>
        </div>
      </div>

      {/* 标签页 */}
      <div className="chat-tabs">
        <button
          className={`tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          全部 ({contacts.length + groups.length})
        </button>
        <button
          className={`tab ${activeTab === 'contacts' ? 'active' : ''}`}
          onClick={() => setActiveTab('contacts')}
        >
          联系人 ({contacts.length})
        </button>
        <button
          className={`tab ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups')}
        >
          群组 ({groups.length})
        </button>
      </div>

      {/* 聊天列表 */}
      <div className="chat-items">
        {chats.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <h3>暂无聊天</h3>
            <p>
              {activeTab === 'contacts' && '暂无联系人，去添加一些朋友吧！'}
              {activeTab === 'groups' && '暂无群组，创建或加入一些群组吧！'}
              {activeTab === 'all' && '暂无聊天记录，开始你的第一次对话吧！'}
            </p>
          </div>
        ) : (
          chats.map((chat) => (
            <div
              key={`${chat.type}-${chat.id}`}
              className={`chat-item ${selectedChatId === chat.id ? 'selected' : ''}`}
              onClick={() => handleChatClick(chat)}
            >
              <div className="chat-avatar">
                {chat.avatar ? (
                  <img src={chat.avatar} alt={chat.name} />
                ) : (
                  <div className="avatar-placeholder">
                    {chat.type === 'group' ? '👥' : chat.name[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </div>

              <div className="chat-info">
                <div className="chat-header">
                  <h4 className="chat-name">{chat.name}</h4>
                  <span className="chat-time">{chat.time}</span>
                </div>
                <div className="chat-preview">
                  <p className="last-message">{chat.lastMessage}</p>
                  {chat.unreadCount && chat.unreadCount > 0 && (
                    <span className="unread-badge">{chat.unreadCount}</span>
                  )}
                </div>
              </div>

              <div className="chat-type-indicator">
                {chat.type === 'group' ? '🏢' : '👤'}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 添加按钮 */}
      <div className="chat-actions">
        <button className="action-btn" onClick={() => alert('TODO: 添加联系人功能')}>
          ➕ 添加联系人
        </button>
        <button className="action-btn" onClick={() => alert('TODO: 创建群组功能')}>
          🏢 创建群组
        </button>
      </div>
    </div>
  );
};

export default ChatList;
