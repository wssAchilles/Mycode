/**
 * ChatSidebar - 聊天页面侧边栏组件
 * 包含：用户信息、导航、AI入口、联系人列表、待处理请求
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../../services/apiClient';
import { useChatStore } from '../../features/chat/store/chatStore';
import { useMessageStore } from '../../features/chat/store/messageStore';
import { Sidebar } from '../../components/layout';
import { Avatar } from '../../components/common';
import ChatListContainer from '../../features/chat/ChatListContainer';
import { ArrowLeftIcon, LogoutIcon } from '../../components/icons/SpaceIcons';
import type { User } from '../../types/auth';

interface PendingRequest {
    id: string;
    username: string;
    alias?: string;
}

interface ChatSidebarProps {
    currentUser: User | null;
    isConnected: boolean;
    isAiChatMode: boolean;
    pendingRequests: PendingRequest[];
    onSelectAiChat: () => void;
    onOpenGroupModal: () => void;
    onOpenAddContactModal: () => void;
    onChatSelected?: () => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
    currentUser,
    isConnected,
    isAiChatMode,
    pendingRequests,
    onSelectAiChat,
    onOpenGroupModal,
    onOpenAddContactModal,
    onChatSelected,
}) => {
    const navigate = useNavigate();

    // Store actions
    const contacts = useChatStore((state) => state.contacts);
    const selectContact = useChatStore((state) => state.selectContact);
    const handleContactRequest = useChatStore((state) => state.handleContactRequest);
    const setActiveContact = useMessageStore((state) => state.setActiveContact);

    const handleLogout = async () => {
        await authAPI.logout();
        navigate('/login');
    };

    const handleChatSelected = (chatId: string) => {
        const chat = useChatStore.getState().chats.find(c => c.id === chatId);
        if (chat) {
            if (chat.isGroup) {
                // 群组：加载群详情（会自动更新 selectedGroup 和 isGroupChatMode）
                useChatStore.getState().loadGroupDetails(chatId);
            } else {
                // 私聊：选择联系人
                const contact = contacts.find(c => c.userId === chatId);
                selectContact(contact || null);
            }
            setActiveContact(chatId, chat.isGroup);
            onChatSelected?.();
        }
    };

    return (
        <Sidebar className="chat-sidebar" width={320}>
            {/* Header */}
            <div className="sidebar-header">
                <button
                    type="button"
                    className="back-to-space-btn"
                    onClick={() => navigate('/space')}
                    title="返回 Space"
                    aria-label="返回 Space 首页"
                >
                    <ArrowLeftIcon />
                </button>

                <div className="user-info">
                    <Avatar
                        name={currentUser?.username || '?'}
                        src={currentUser?.avatarUrl}
                        size="md"
                        online={isConnected}
                    />
                    <div className="user-details-container">
                        <h3 className="user-username">{currentUser?.username}</h3>
                        <span className={`status ${isConnected ? 'online' : 'offline'}`}>
                            {isConnected ? '在线' : '离线'}
                        </span>
                    </div>
                </div>

                <button
                    type="button"
                    className="logout-button"
                    onClick={handleLogout}
                    title="退出登录"
                    aria-label="退出登录"
                >
                    <LogoutIcon />
                </button>
            </div>

            {/* New Group Button */}
            <div className="chat-list-header chat-list-header--padded">
                <button
                    type="button"
                    className="new-group-btn"
                    onClick={onOpenGroupModal}
                    aria-label="新建群组"
                >
                    <span className="new-group-icon">+</span> 新建群组
                </button>
            </div>

            {/* AI Entry */}
            <button
                type="button"
                onClick={() => {
                    onSelectAiChat();
                    onChatSelected?.();
                }}
                className={`tg-contact-card ${isAiChatMode ? 'tg-contact-card--selected' : ''} tg-contact-card--ai`}
                aria-label="打开 Gemini AI 助手对话"
            >
                <div className="tg-contact-card__avatar">
                    <div className="ai-avatar">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                            <circle cx="12" cy="5" r="2"></circle>
                            <path d="M12 7v4"></path>
                            <line x1="8" y1="16" x2="8" y2="16"></line>
                            <line x1="16" y1="16" x2="16" y2="16"></line>
                        </svg>
                    </div>
                    <span className="tg-contact-card__ai-badge">AI</span>
                </div>
                <div className="tg-contact-card__info">
                    <div className="tg-contact-card__top">
                        <span className="tg-contact-card__name">Gemini AI 助手</span>
                    </div>
                    <div className="tg-contact-card__bottom">
                        <span className="tg-contact-card__message">点击开始智能对话</span>
                    </div>
                </div>
            </button>

            {/* Pending Requests */}
            {pendingRequests.map(req => (
                <div key={req.id} className="pending-request">
                    <div className="pending-request__info">
                        <Avatar name={req.username} size="sm" />
                        <div className="pending-request__details">
                            <div className="pending-request__name">{req.alias || req.username}</div>
                            <div className="pending-request__label">请求添加好友</div>
                        </div>
                    </div>
                    <div className="pending-request__actions">
                        <button
                            type="button"
                            onClick={() => handleContactRequest(req.id, 'accept')}
                            className="pending-request__btn pending-request__btn--accept"
                            aria-label={`接受 ${req.alias || req.username} 的好友请求`}
                        >
                            接受
                        </button>
                        <button
                            type="button"
                            onClick={() => handleContactRequest(req.id, 'reject')}
                            className="pending-request__btn pending-request__btn--reject"
                            aria-label={`拒绝 ${req.alias || req.username} 的好友请求`}
                        >
                            拒绝
                        </button>
                    </div>
                </div>
            ))}

            {/* Contact List */}
            <div className="contact-list-container">
                <ChatListContainer onChatSelected={handleChatSelected} />
            </div>

            {/* Footer */}
            <div className="sidebar-footer">
                <button
                    type="button"
                    onClick={onOpenAddContactModal}
                    className="add-contact-btn"
                    title="添加联系人"
                    aria-label="添加联系人"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="8.5" cy="7" r="4"></circle>
                        <line x1="20" y1="8" x2="20" y2="14"></line>
                        <line x1="23" y1="11" x2="17" y2="11"></line>
                    </svg>
                </button>
            </div>
        </Sidebar>
    );
};

export default ChatSidebar;
