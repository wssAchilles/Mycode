/**
 * ContactItem 组件
 * 联系人列表中的单个联系人项
 */
import React from 'react';
import type { Contact } from '../../types/store';
import './ContactItem.css';

interface ContactItemProps {
    contact: Contact;
    isSelected: boolean;
    onClick: () => void;
    formatTime?: (timestamp: string) => string;
}

// 默认时间格式化
const defaultFormatTime = (timestamp: string): string => {
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        return date.toLocaleDateString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
        });
    } catch {
        return '';
    }
};

export const ContactItem: React.FC<ContactItemProps> = ({
    contact,
    isSelected,
    onClick,
    formatTime = defaultFormatTime,
}) => {
    return (
        <div
            className={`contact-item ${isSelected ? 'selected' : ''}`}
            onClick={onClick}
        >
            {/* 头像 */}
            <div className="contact-avatar-wrapper">
                <div
                    className="contact-avatar"
                    style={{
                        background: contact.avatarUrl
                            ? `url(${contact.avatarUrl})`
                            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                    }}
                >
                    {!contact.avatarUrl && contact.username.charAt(0).toUpperCase()}
                </div>
                <div
                    className={`contact-status-indicator ${contact.isOnline ? 'online' : 'offline'}`}
                />
            </div>

            {/* 信息 */}
            <div className="contact-info">
                <div className="contact-header">
                    <span className="contact-name">
                        {contact.alias || contact.username}
                    </span>
                    <span className="contact-time">
                        {contact.lastMessage
                            ? formatTime(contact.lastMessage.timestamp)
                            : contact.isOnline
                                ? '在线'
                                : '离线'}
                    </span>
                </div>
                <div className="contact-preview">
                    {contact.lastMessage
                        ? `${contact.lastMessage.username}: ${contact.lastMessage.content}`
                        : '开始聊天吧！'}
                </div>
            </div>

            {/* 未读计数 */}
            {contact.unreadCount > 0 && (
                <div className="contact-unread-badge">
                    {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
                </div>
            )}
        </div>
    );
};

export default ContactItem;
