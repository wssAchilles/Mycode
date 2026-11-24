/**
 * ChatSidebar - 聊天页面侧边栏组件
 * 包含：用户信息、导航、AI入口、联系人列表、待处理请求
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, UserPlus, Users, X } from 'lucide-react';
import { authAPI } from '../../services/apiClient';
import { formatChatListTimestamp, useChatStore } from '../../features/chat/store/chatStore';
import { useMessageStore } from '../../features/chat/store/messageStore';
import { Sidebar } from '../../components/layout';
import { Avatar } from '../../components/common';
import { showToast } from '../../components/ui/Toast';
import ChatListContainer from '../../features/chat/ChatListContainer';
import { ArrowLeftIcon, LogoutIcon } from '../../components/icons/SpaceIcons';
import type { User } from '../../types/auth';
import type { SelfPresenceStatus } from '../../features/chat/presence/presenceState';
import { buildGroupChatId, buildPrivateChatId } from '../../utils/chat';

interface PendingRequest {
    id: string;
    userId?: string;
    username: string;
    alias?: string;
    avatarUrl?: string;
    addedAt?: string;
}

interface ChatSidebarProps {
    currentUser: User | null;
    isConnected: boolean;
    connectionStatus?: SelfPresenceStatus;
    connectionLabel?: string;
    isAiChatMode: boolean;
    pendingRequests: PendingRequest[];
    onSelectAiChat: () => void;
    onOpenGroupModal: () => void;
    onOpenAddContactModal: (initialTab?: 'search' | 'requests' | 'sent') => void;
    onChatSelected?: () => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
    currentUser,
    isConnected,
    connectionStatus,
    connectionLabel,
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
    const resetUnread = useChatStore((state) => state.resetUnread);
    const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

    const processPendingRequest = async (req: PendingRequest, action: 'accept' | 'reject') => {
        if (busyRequestId) return;
        setBusyRequestId(req.id);
        const displayName = req.alias || req.username;
        try {
            await handleContactRequest(req.id, action);
            showToast(
                action === 'accept' ? `已同意 ${displayName} 的好友申请` : `已拒绝 ${displayName} 的好友申请`,
                action === 'accept' ? 'success' : 'info',
            );
        } catch {
            showToast('处理好友申请失败，请稍后重试', 'error');
        } finally {
            setBusyRequestId(null);
        }
    };

    const handleLogout = async () => {
        await authAPI.logout();
        navigate('/login');
    };

    const effectiveStatus: SelfPresenceStatus = connectionStatus ?? (isConnected ? 'online' : 'offline');
    const effectiveLabel = connectionLabel ?? (isConnected ? '在线' : '离线');

    const handleChatSelected = (chatId: string) => {
        const chat = useChatStore.getState().chats.find(c => c.id === chatId);
        if (chat) {
            if (typeof chat.lastMessageSeq === 'number' && chat.lastMessageSeq > 0) {
                const durableChatId = chat.isGroup
                    ? buildGroupChatId(chat.id)
                    : currentUser?.id
                        ? buildPrivateChatId(currentUser.id, chat.id)
                        : null;
                if (durableChatId) {
                    useMessageStore.getState().markChatRead(durableChatId, chat.lastMessageSeq);
                }
            }
            if (chat.isGroup) {
                // 群组：加载群详情（会自动更新 selectedGroup 和 isGroupChatMode）
                // 点击即清零本地未读；上方 durable read 负责刷新后的服务端状态。
                resetUnread(chatId);
                useChatStore.getState().loadGroupDetails(chatId);
            } else {
                // 私聊：选择联系人
                const contact = contacts.find(c => c.userId === chatId);
                selectContact(contact || null);
            }
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
                        online={effectiveStatus === 'online'}
                        priority="high"
                    />
                    <div className="user-details-container">
                        <h3 className="user-username">{currentUser?.username}</h3>
                        <span className={`status ${effectiveStatus}`}>
                            {effectiveLabel}
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

            {/* 快捷操作栏（新建群组 + 添加联系人） */}
            <div className="chat-list-header chat-list-header--padded chat-sidebar-actions">
                <button
                    type="button"
                    className="new-group-btn"
                    onClick={onOpenGroupModal}
                    title="新建群组"
                    aria-label="新建群组"
                >
                    <Users size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>新建群组</span>
                </button>
                <button
                    type="button"
                    onClick={() => onOpenAddContactModal(pendingRequests.length > 0 ? 'requests' : 'search')}
                    className="add-contact-btn"
                    title={pendingRequests.length > 0 ? `查看 ${pendingRequests.length} 条待处理好友申请` : '添加联系人'}
                    aria-label="添加联系人"
                >
                    <UserPlus size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>添加联系人</span>
                    {pendingRequests.length > 0 && (
                        <span className="action-badge" aria-label={`${pendingRequests.length} 条待处理好友申请`}>
                            {pendingRequests.length > 99 ? '99+' : pendingRequests.length}
                        </span>
                    )}
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
                title="AI 助手"
                aria-label="打开 AI 助手对话"
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
                        <span className="tg-contact-card__name">AI 助手</span>
                    </div>
                    <div className="tg-contact-card__bottom">
                        <span className="tg-contact-card__message">结合动态、通知和新闻提供个性化问答</span>
                    </div>
                </div>
            </button>

            {/* 新的朋友 / 待处理好友申请 */}
            {pendingRequests.length > 0 && (
                <section className="pending-requests-section" aria-label="新的朋友与好友申请">
                    <div className="pending-requests-header">
                        <span className="pending-requests-title">
                            <Bell size={13} aria-hidden="true" />
                            <span>新的朋友</span>
                            <span className="pending-requests-count">{pendingRequests.length}</span>
                        </span>
                        <button
                            type="button"
                            className="pending-requests-more"
                            onClick={() => onOpenAddContactModal('requests')}
                        >
                            全部管理
                        </button>
                    </div>
                    <div className="pending-requests-list">
                        {pendingRequests.map((req) => {
                            const displayName = req.alias || req.username;
                            const isBusy = busyRequestId === req.id;
                            const timeLabel = req.addedAt ? formatChatListTimestamp(req.addedAt) : '';
                            return (
                                <div key={req.id} className="pending-request">
                                    <div className="pending-request__info">
                                        <Avatar src={req.avatarUrl} name={displayName} size="sm" priority="high" />
                                        <div className="pending-request__details">
                                            <div className="pending-request__name">{displayName}</div>
                                            <div className="pending-request__label">
                                                请求加为好友{timeLabel ? ` · ${timeLabel}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="pending-request__actions">
                                        <button
                                            type="button"
                                            disabled={!!busyRequestId}
                                            onClick={() => void processPendingRequest(req, 'accept')}
                                            className="pending-request__btn pending-request__btn--accept"
                                            aria-label={`接受 ${displayName} 的好友请求`}
                                        >
                                            <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                                            <span>{isBusy ? '处理中' : '同意'}</span>
                                        </button>
                                        <button
                                            type="button"
                                            disabled={!!busyRequestId}
                                            onClick={() => void processPendingRequest(req, 'reject')}
                                            className="pending-request__btn pending-request__btn--reject"
                                            aria-label={`拒绝 ${displayName} 的好友请求`}
                                            title="拒绝"
                                        >
                                            <X size={12} strokeWidth={2.3} aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Contact List */}
            <div className="contact-list-container">
                <ChatListContainer onChatSelected={handleChatSelected} />
            </div>
        </Sidebar>
    );
};

export default ChatSidebar;
