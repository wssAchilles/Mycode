import React, { useEffect, useRef } from 'react';
import { BellOff, Pin } from 'lucide-react';
import { Avatar } from '../../../components/common';
import type { ChatSummary } from '../types';
import { useMessageStore } from '../store/messageStore';
import { useChatUiPrefsStore } from '../state/chatUiPrefsStore';
import { motionDurations, useAnimeScope, waapi } from '../../../core/animation';
import './ChatListItem.css';

interface ChatListItemProps {
    chat: ChatSummary;
    isSelected?: boolean;
    isNew?: boolean;
    onClick: (chat: ChatSummary) => void;
    onContextMenu?: (chat: ChatSummary, event: React.MouseEvent) => void;
}

const ChatListItem: React.FC<ChatListItemProps> = ({ chat, isSelected, isNew = false, onClick, onContextMenu }) => {
    const prefetchChat = useMessageStore((state) => state.prefetchChat);
    const draftText = useChatUiPrefsStore((state) => state.draftByChatId[chat.id] || '');
    const isPinned = useChatUiPrefsStore((state) => state.pinnedChatIds.includes(chat.id));
    const isMuted = useChatUiPrefsStore((state) => state.mutedChatIds.includes(chat.id));
    const hasDraft = draftText.trim().length > 0 && !isSelected;
    const prevUnreadPulseSeqRef = useRef(chat.unreadPulseSeq || 0);
    const itemMotion = useAnimeScope<HTMLButtonElement, {
        unread: () => void;
    }>(
        ({ root, reducedMotion, duration }) => ({
            unread: () => {
                if (reducedMotion || !root) return;
                const badge = root.querySelector<HTMLElement>('.tg-chat-item-badge');
                if (!badge) return;
                waapi.animate(badge, {
                    scale: [1, 1.16, 1],
                    y: ['0px', '-2px', '0px'],
                    duration: duration(motionDurations.normal),
                    ease: 'out(4)',
                });
            },
        }),
        [],
    );

    useEffect(() => {
        const nextPulseSeq = chat.unreadPulseSeq || 0;
        if (nextPulseSeq > prevUnreadPulseSeqRef.current) {
            itemMotion.run('unread');
        }
        prevUnreadPulseSeqRef.current = nextPulseSeq;
    }, [chat.unreadPulseSeq, itemMotion]);

    return (
        <button
            ref={itemMotion.rootRef}
            type="button"
            className={`tg-chat-item ${isSelected ? 'is-selected' : ''} ${isNew ? 'is-new' : ''}`}
            onClick={() => onClick(chat)}
            onContextMenu={onContextMenu ? (event) => onContextMenu(chat, event) : undefined}
            onMouseEnter={() => prefetchChat(chat.id, !!chat.isGroup)}
            onFocus={() => prefetchChat(chat.id, !!chat.isGroup)}
            title={chat.title}
            aria-label={`打开会话 ${chat.title}`}
            aria-current={isSelected ? 'true' : undefined}
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
                    <h3 className="tg-chat-item-title">
                        {isPinned && (
                            <Pin size={12} className="tg-chat-item-flag is-pin" aria-label="已置顶" />
                        )}
                        {chat.title}
                        {isMuted && (
                            <BellOff size={12} className="tg-chat-item-flag is-mute" aria-label="已免打扰" />
                        )}
                    </h3>
                    <div className="tg-chat-item-meta">
                        <span className="tg-chat-item-time">{chat.time}</span>
                    </div>
                </div>

                <div className="tg-chat-item-bottom">
                    <p className="tg-chat-item-message">
                        {hasDraft ? (
                            <>
                                <span className="tg-chat-item-draft">[草稿] </span>
                                <span>{draftText}</span>
                            </>
                        ) : (
                            <span className={`tg-text-preview ${!chat.lastMessage ? 'tg-text-placeholder' : ''}`}>
                                {chat.lastMessage || '点击开始聊天'}
                            </span>
                        )}
                    </p>

                    {chat.unreadCount > 0 && (
                        <div className={`tg-chat-item-badge ${isMuted ? 'is-muted' : ''}`}>
                            {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                        </div>
                    )}
                </div>
            </div>

            <div className="tg-chat-item-ripple-container" />
        </button>
    );
};

export default React.memo(ChatListItem);
