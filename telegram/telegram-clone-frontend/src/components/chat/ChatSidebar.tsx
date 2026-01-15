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
                        ➕
                    </button>
                    <button
                        className="action-button"
                        onClick={onLogout}
                        title="设置/登出"
                    >
                        ⚙️
                    </button>
                </div>
            </div>

            {/* 搜索框 */}
            <div className="sidebar-search">
                <div className="search-wrapper">
                    <span className="search-icon">🔍</span>
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

            {/* AI 助手入口 */}
            <div
                className={`ai-entry ${isAiChatMode ? 'selected' : ''}`}
                onClick={onSelectAiMode}
            >
                <div className="ai-avatar">🤖</div>
                <div className="ai-info">
                    <div className="ai-header">
                        <span className="ai-name">Gemini AI 助手</span>
                        <span className="ai-badge">AI</span>
                    </div>
                    <div className="ai-desc">点击开始AI对话</div>
                </div>
            </div>

            {/* 滚动内容区 */}
            <div className="sidebar-content">
                {/* 加载状态 */}
                {isLoadingContacts && (
                    <div className="sidebar-loading">
                        <span className="loading-icon">⏳</span>
                        <span>加载联系人中...</span>
                    </div>
                )}

                {/* 错误状态 */}
                {error && (
                    <div className="sidebar-error">
                        <span className="error-icon">❌</span>
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
