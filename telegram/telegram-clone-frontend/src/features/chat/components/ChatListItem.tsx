import React from 'react';
import { Avatar } from '../../../components/common';
import type { ChatSummary } from '../types';
import './ChatListItem.css';

interface ChatListItemProps {
    chat: ChatSummary;
    isSelected?: boolean;
    onClick: (chat: ChatSummary) => void;
}

const ChatListItem: React.FC<ChatListItemProps> = ({ chat, isSelected, onClick }) => {
    return (
        <div
            className={`tg-chat-item ${isSelected ? 'is-selected' : ''}`}
            onClick={() => onClick(chat)}
        >
            <div className="tg-chat-item-avatar">
                <Avatar
                    id={chat.id}
                    name={chat.title}
                    src={chat.avatarUrl}
                    size={54}
                    online={!chat.isGroup && chat.online}
                />
            </div>

            <div className="tg-chat-item-content">
                <div className="tg-chat-item-top">
                    <h3 className="tg-chat-item-title">{chat.title}</h3>
                    <div className="tg-chat-item-meta">
                        {/* If has read status, show icon here? Usually status is next to last msg for out, OR unread count */}
                        <span className="tg-chat-item-time">{chat.time}</span>
                    </div>
                </div>

                <div className="tg-chat-item-bottom">
                    <p className="tg-chat-item-message">
                        {/* If sent by me, would show sender name or 'You:' */}
                        <span className={`tg-text-preview ${!chat.lastMessage ? 'tg-text-placeholder' : ''}`}>
                            {chat.lastMessage || '点击开始聊天'}
                        </span>
                    </p>

                    {chat.unreadCount > 0 && (
                        <div className="tg-chat-item-badge">
                            {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                        </div>
                    )}

                    {/* If no unread and out, show tick? Not implemented in types yet */}
                </div>
            </div>

            <div className="tg-chat-item-ripple-container">
                {/* Native ripple or our component if wrapped */}
            </div>
        </div>
    );
};

export default React.memo(ChatListItem);
