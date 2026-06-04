import React, { useEffect, useRef } from 'react';
import { Avatar } from '../../../components/common';
import type { ChatSummary } from '../types';
import { useMessageStore } from '../store/messageStore';
import { motionDurations, useAnimeScope, waapi } from '../../../core/animation';
import './ChatListItem.css';

interface ChatListItemProps {
    chat: ChatSummary;
    isSelected?: boolean;
    onClick: (chat: ChatSummary) => void;
}

const ChatListItem: React.FC<ChatListItemProps> = ({ chat, isSelected, onClick }) => {
    const prefetchChat = useMessageStore((state) => state.prefetchChat);
    const prevUnreadRef = useRef(chat.unreadCount);
    const itemMotion = useAnimeScope<HTMLButtonElement, {
        unread: () => void;
        selected: () => void;
    }>(
        ({ root, reducedMotion, duration }) => ({
            unread: () => {
                if (reducedMotion || !root) return;
                const badge = root.querySelector('.tg-chat-item-badge');
                if (!badge) return;
                waapi.animate(badge, {
                    scale: [1, 1.16, 1],
                    y: ['0px', '-2px', '0px'],
                    duration: duration(motionDurations.normal),
                    ease: 'out(4)',
                });
            },
            selected: () => {
                if (reducedMotion || !root) return;
                const indicator = root.querySelector('.tg-chat-item-selected-indicator');
                if (!indicator) return;
                waapi.animate(indicator, {
                    opacity: [0, 1],
                    scaleY: [0.45, 1],
                    duration: duration(motionDurations.fast),
                    ease: 'out(4)',
                });
            },
        }),
        [],
    );

    useEffect(() => {
        if (chat.unreadCount > prevUnreadRef.current) {
            itemMotion.run('unread');
        }
        prevUnreadRef.current = chat.unreadCount;
    }, [chat.unreadCount, itemMotion]);

    useEffect(() => {
        if (isSelected) {
            itemMotion.run('selected');
        }
    }, [isSelected, itemMotion]);

    return (
        <button
            ref={itemMotion.rootRef}
            type="button"
            className={`tg-chat-item ${isSelected ? 'is-selected' : ''}`}
            onClick={() => onClick(chat)}
            onMouseEnter={() => prefetchChat(chat.id, !!chat.isGroup)}
            onFocus={() => prefetchChat(chat.id, !!chat.isGroup)}
            aria-label={`打开会话 ${chat.title}`}
        >
            <span className="tg-chat-item-selected-indicator" aria-hidden="true" />
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
        </button>
    );
};

export default React.memo(ChatListItem);
