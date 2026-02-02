import React from 'react';
import { Avatar } from '../../../components/common';
import { useChatStore } from '../store/chatStore';
import './ChatHeader.css';

interface ChatHeaderProps {
    isAiMode: boolean;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onSearch: () => void;
    onAvatarClick?: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
    isAiMode,
    searchQuery,
    onSearchChange,
    onSearch,
    onAvatarClick,
}) => {
    // 从 Store 获取选中的联系人信息
    const selectedChatId = useChatStore((state) => state.selectedChatId);
    const chats = useChatStore((state) => state.chats);
    const selectedContact = useChatStore((state) => state.selectedContact);
    const selectedChat = chats.find((c) => c.id === selectedChatId);
    const fallbackChat = selectedContact ? {
        id: selectedContact.userId,
        title: selectedContact.alias || selectedContact.username,
        avatarUrl: selectedContact.avatarUrl,
        online: selectedContact.isOnline,
        isGroup: false,
        memberCount: 0,
    } : null;
    const displayChat = selectedChat || fallbackChat;

    // AI 模式头部
    if (isAiMode) {
        return (
            <div className="chat-header">
                <div className="chat-header__info">
                    <div className="chat-header__avatar chat-header__avatar--ai">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                            <circle cx="12" cy="5" r="2"></circle>
                            <path d="M12 7v4"></path>
                            <line x1="8" y1="16" x2="8" y2="16"></line>
                            <line x1="16" y1="16" x2="16" y2="16"></line>
                        </svg>
                    </div>
                    <div className="chat-header__details">
                        <div className="chat-header__name">Gemini AI 助手</div>
                        <div className="chat-header__status chat-header__status--online">
                            Always Online
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // 无选中联系人
    if (!displayChat) {
        return null;
    }

    // 正常联系人头部
    return (
        <div className="chat-header">
            <div
                className="chat-header__info"
                onClick={onAvatarClick}
                style={{ cursor: 'pointer' }}
            >
                <Avatar
                    src={displayChat.avatarUrl}
                    name={displayChat.title}
                    online={displayChat.online}
                    size="md"
                />
                <div className="chat-header__details">
                    <div className="chat-header__name">{displayChat.title}</div>
                    <div
                        className={`chat-header__status ${!displayChat.isGroup && displayChat.online
                            ? 'chat-header__status--online'
                            : ''
                            }`}
                    >
                        {displayChat.isGroup
                            ? `${displayChat.memberCount || 0} 位成员`
                            : (displayChat.online ? '在线' : '离线')
                        }
                    </div>
                </div>
            </div>

            {/* 搜索栏 */}
            <div className="chat-header__actions">
                <div className="chat-header__search">
                    <span className="chat-header__search-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </span>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && onSearch()}
                        placeholder="搜索..."
                        className="chat-header__search-input"
                    />
                </div>
            </div>
        </div>
    );
};

export default ChatHeader;
