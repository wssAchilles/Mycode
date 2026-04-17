/**
 * ChatSidebar 组件
 * 聊天侧边栏：用户信息、搜索、AI入口、联系人列表
 */
import React, { useState, useCallback } from 'react';
import { ContactItem } from './ContactItem';
import type { Contact, PendingRequest } from '../../types/store';
import type { User } from '../../types/auth';
import './ChatSidebar.css';

interface ChatSidebarProps {
    // 用户信息
    currentUser: User | null;
    isConnected: boolean;

    // 联系人
    contacts: Contact[];
    selectedContact: Contact | null;
    isLoadingContacts: boolean;

    // 待处理请求
    pendingRequests: PendingRequest[];
    isLoadingPendingRequests: boolean;

    // AI 模式
    isAiChatMode: boolean;

    // 错误
    error: string | null;

    // 事件处理
    onSelectContact: (contact: Contact | null) => void;
    onSelectAiMode: () => void;
    onLogout: () => void;
    onAddContact: () => void;
    onAcceptRequest: (requestId: string) => void;
    onRejectRequest: (requestId: string) => void;
    onRetryLoadContacts: () => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
    currentUser,
    isConnected,
    contacts,
    selectedContact,
    isLoadingContacts,
    pendingRequests,
    isLoadingPendingRequests,
    isAiChatMode,
    error,
    onSelectContact,
    onSelectAiMode,
    onLogout,
    onAddContact,
    onAcceptRequest,
    onRejectRequest,
    onRetryLoadContacts,
}) => {
    const [searchQuery, setSearchQuery] = useState('');

    // 过滤联系人
    const filteredContacts = useCallback(() => {
        if (!searchQuery.trim()) return contacts;
        const query = searchQuery.toLowerCase();
        return contacts.filter(
            (c) =>
                c.username.toLowerCase().includes(query) ||
                c.alias?.toLowerCase().includes(query)
        );
    }, [contacts, searchQuery])();

    return (
        <div className="chat-sidebar">
            {/* 顶部用户信息 */}
            <div className="sidebar-header">
                <div className="user-profile">
                    <div className="user-avatar">
                        {currentUser?.username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="user-info">
                        <div className="user-name">{currentUser?.username || '用户'}</div>
                        <div className={`user-status ${isConnected ? 'online' : 'offline'}`}>
                            <span className="status-dot" />
                            {isConnected ? '在线' : '离线'}
                        </div>
                    </div>
                </div>
                <div className="header-actions">
                    <button
                        className="action-button"
                        onClick={onAddContact}
                        title="添加联系人"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <button
                        className="action-button"
                        onClick={onLogout}
                        title="设置/登出"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                </div>
            </div>

            {/* 搜索框 */}
            <div className="sidebar-search">
                <div className="search-wrapper">
                    <span className="search-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    </span>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="搜索联系人"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button
                            className="search-clear"
                            onClick={() => setSearchQuery('')}
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* Space (动态) 入口 */}
            <div
                className="ai-entry space-entry"
                onClick={() => window.location.href = '/space'}
                style={{ marginBottom: '8px' }}
            >
                <div className="ai-avatar" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                    </svg>
                </div>
                <div className="ai-info">
                    <div className="ai-header">
                        <span className="ai-name">Space 动态</span>
                        <span className="ai-badge" style={{ background: '#764ba2' }}>NEW</span>
                    </div>
                    <div className="ai-desc">探索热门新闻与话题</div>
                </div>
            </div>

            {/* AI 助手入口 */}
            <div
                className={`ai-entry ${isAiChatMode ? 'selected' : ''}`}
                onClick={onSelectAiMode}
            >
                <div className="ai-avatar">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>
                </div>
                <div className="ai-info">
                    <div className="ai-header">
                        <span className="ai-name">AI 助手</span>
                        <span className="ai-badge">AI</span>
                    </div>
                    <div className="ai-desc">结合动态、通知和新闻提供个性化问答</div>
                </div>
            </div>

            {/* 滚动内容区 */}
            <div className="sidebar-content">
                {/* 加载状态 */}
                {isLoadingContacts && (
                    <div className="sidebar-loading">
                        <span className="loading-icon">
                            <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                        </span>
                        <span>加载联系人中...</span>
                    </div>
                )}

                {/* 错误状态 */}
                {error && (
                    <div className="sidebar-error">
                        <span className="error-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                        </span>
                        <span>{error}</span>
                        <button className="retry-button" onClick={onRetryLoadContacts}>
                            重试
                        </button>
                    </div>
                )}

                {/* 待处理请求 */}
                {!isLoadingPendingRequests && pendingRequests.length > 0 && (
                    <div className="pending-requests">
                        <div className="section-title">
                            待处理请求 ({pendingRequests.length})
                        </div>
                        {pendingRequests.map((request) => (
                            <div key={request.id} className="pending-request-item">
                                <div
                                    className="request-avatar"
                                    style={{
                                        background: request.avatarUrl
                                            ? `url(${request.avatarUrl})`
                                            : 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
                                        backgroundSize: 'cover',
                                    }}
                                >
                                    {!request.avatarUrl && request.username.charAt(0).toUpperCase()}
                                </div>
                                <div className="request-info">
                                    <div className="request-name">
                                        {request.alias || request.username}
                                    </div>
                                    <div className="request-message">想要添加您为联系人</div>
                                </div>
                                <div className="request-actions">
                                    <button
                                        className="accept-button"
                                        onClick={() => onAcceptRequest(request.id)}
                                    >
                                        接受
                                    </button>
                                    <button
                                        className="reject-button"
                                        onClick={() => onRejectRequest(request.id)}
                                    >
                                        拒绝
                                    </button>
                                </div>
                            </div>
                        ))}
                        <div className="section-divider" />
                    </div>
                )}

                {/* 空状态 */}
                {!isLoadingContacts &&
                    !error &&
                    contacts.length === 0 &&
                    pendingRequests.length === 0 && (
                        <div className="sidebar-empty">
                            <span className="empty-icon">👥</span>
                            <span className="empty-title">暂无联系人</span>
                            <span className="empty-desc">点击右上角 + 添加联系人</span>
                        </div>
                    )}

                {/* 联系人列表 */}
                {filteredContacts.length > 0 && (
                    <div className="contacts-list">
                        <div className="section-title">联系人 ({contacts.length})</div>
                        {filteredContacts.map((contact) => (
                            <ContactItem
                                key={contact.id}
                                contact={contact}
                                isSelected={selectedContact?.id === contact.id && !isAiChatMode}
                                onClick={() => onSelectContact(contact)}
                            />
                        ))}
                    </div>
                )}

                {/* 搜索无结果 */}
                {searchQuery && filteredContacts.length === 0 && contacts.length > 0 && (
                    <div className="sidebar-empty">
                        <span className="empty-icon">🔍</span>
                        <span className="empty-title">未找到匹配的联系人</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChatSidebar;
