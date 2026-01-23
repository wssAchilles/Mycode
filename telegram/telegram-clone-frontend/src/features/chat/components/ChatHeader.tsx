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
    const selectedChat = chats.find((c) => c.id === selectedChatId);

    // AI 模式头部
    if (isAiMode) {
        return (
            <div className="chat-header">
                <div className="chat-header__info">
                    <div className="chat-header__avatar chat-header__avatar--ai">
                        🤖
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
    if (!selectedChat) {
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
                    src={selectedChat.avatarUrl}
                    name={selectedChat.title}
                    online={selectedChat.online}
                    size="md"
                />
                <div className="chat-header__details">
                    <div className="chat-header__name">{selectedChat.title}</div>
                    <div
                        className={`chat-header__status ${!selectedChat.isGroup && selectedChat.online
                                ? 'chat-header__status--online'
                                : ''
                            }`}
                    >
                        {selectedChat.isGroup
                            ? `${selectedChat.memberCount || 0} 位成员`
                            : (selectedChat.online ? '在线' : '离线')
                        }
                    </div>
                </div>
            </div>

            {/* 搜索栏 */}
            <div className="chat-header__actions">
                <div className="chat-header__search">
                    <span className="chat-header__search-icon">🔍</span>
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
