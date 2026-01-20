import React from 'react';
import { Avatar } from './Avatar';
import './ContactCard.css';

interface ContactCardProps {
    id: string;
    name: string;
    avatar?: string;
    lastMessage?: string;
    lastMessageTime?: string;
    unreadCount?: number;
    status?: 'online' | 'offline' | 'away' | 'busy';
    isTyping?: boolean;
    isSelected?: boolean;
    isPinned?: boolean;
    isMuted?: boolean;
    isAI?: boolean;
    onClick?: () => void;
    className?: string;
}

/**
 * 联系人卡片组件
 * Telegram 风格联系人列表项
 */
export const ContactCard: React.FC<ContactCardProps> = ({
    name,
    avatar,
    lastMessage = '',
    lastMessageTime,
    unreadCount = 0,
    status,
    isTyping = false,
    isSelected = false,
    isPinned = false,
    isMuted = false,
    isAI = false,
    onClick,
    className = ''
}) => {
    // 格式化最后消息
    const formatLastMessage = (message: string): string => {
        if (message.length > 40) {
            return message.substring(0, 40) + '...';
        }
        return message;
    };

    return (
        <div
            className={`
        tg-contact-card
        ${isSelected ? 'tg-contact-card--selected' : ''}
        ${isAI ? 'tg-contact-card--ai' : ''}
        ${className}
      `}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
        >
            {/* 头像 */}
            <div className="tg-contact-card__avatar">
                <Avatar
                    src={avatar}
                    name={name}
                    size="md"
                    status={status}
                    showStatus={!isAI}
                />
                {isAI && (
                    <span className="tg-contact-card__ai-badge">AI</span>
                )}
            </div>

            {/* 信息区 */}
            <div className="tg-contact-card__info">
                <div className="tg-contact-card__top">
                    <span className="tg-contact-card__name">
                        {isPinned && (
                            <svg className="tg-contact-card__pin" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                            </svg>
                        )}
                        {name}
                    </span>
                    {lastMessageTime && (
                        <span className="tg-contact-card__time">{lastMessageTime}</span>
                    )}
                </div>

                <div className="tg-contact-card__bottom">
                    <span className="tg-contact-card__message">
                        {isTyping ? (
                            <span className="tg-contact-card__typing">正在输入...</span>
                        ) : (
                            formatLastMessage(lastMessage)
                        )}
                    </span>

                    {/* 未读计数和静音 */}
                    <div className="tg-contact-card__badges">
                        {isMuted && (
                            <svg className="tg-contact-card__muted" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M16.5 12A4.5 4.5 0 0 0 14 8.17V4a2 2 0 0 0-4 0v4.17A4.5 4.5 0 0 0 7.5 12H16.5zM12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zM19 12h-2a5 5 0 0 1-10 0H5a7 7 0 0 0 14 0z" />
                                <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" />
                            </svg>
                        )}
                        {unreadCount > 0 && (
                            <span className={`tg-contact-card__unread ${isMuted ? 'tg-contact-card__unread--muted' : ''}`}>
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ContactCard;
