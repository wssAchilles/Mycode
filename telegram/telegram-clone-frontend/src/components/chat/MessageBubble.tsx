/**
 * MessageBubble 组件
 * 渲染单条消息，支持文本、图片、文件等多种类型
 */
import React, { useMemo } from 'react';
import type { Message } from '../../types/store';
import { MessageStatusIcon, type MessageStatusType } from '../icons/MessageStatusIcon';
import { FileTypeIcon, getFileIconType } from '../icons/FileTypeIcon';
import './MessageBubble.css';

// API 基础 URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://telegram-clone-backend-88ez.onrender.com';

interface MessageBubbleProps {
    message: Message;
    isOwn: boolean;
    showAvatar?: boolean;
    senderName?: string;
}

// 工具函数：将相对URL转换为完整URL
const getFullFileUrl = (fileUrl: string): string => {
    if (!fileUrl) return '#';
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        return fileUrl;
    }
    const cleanUrl = fileUrl.startsWith('/') ? fileUrl : '/' + fileUrl;
    return `${API_BASE_URL}${cleanUrl}`;
};

// 安全函数：净化URL防止XSS
const sanitizeUrl = (url: string): string => {
    if (!url) return '#';
    // 只允许相对路径、API服务器地址和HTTPS协议
    if (url.startsWith('/') || url.startsWith(API_BASE_URL) || url.startsWith('https://')) {
        return url;
    }
    // 开发环境也允许 localhost
    if (url.startsWith('http://localhost')) {
        return url;
    }
    return '#';
};

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// 格式化时间
const formatTime = (timestamp: string): string => {
    try {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
};

// 使用 FileTypeIcon 组件替代 emoji 图标 (见 getFileIconType)

export const MessageBubble: React.FC<MessageBubbleProps> = ({
    message,
    isOwn,
    showAvatar = true,
    senderName,
}) => {
    // 解析消息内容
    const parsedContent = useMemo(() => {
        if (!message.type || message.type === 'text') {
            return { type: 'text', content: message.content };
        }

        try {
            const fileData = JSON.parse(message.content);
            return { type: message.type, ...fileData };
        } catch {
            return { type: 'text', content: message.content };
        }
    }, [message]);

    // 渲染消息内容
    const renderContent = () => {
        // 文本消息
        if (parsedContent.type === 'text') {
            return <span className="message-text">{parsedContent.content}</span>;
        }

        // 图片消息
        if (parsedContent.type === 'image' && parsedContent.fileUrl) {
            return (
                <div className="message-image-container">
                    <img
                        src={sanitizeUrl(getFullFileUrl(parsedContent.thumbnailUrl || parsedContent.fileUrl))}
                        alt={parsedContent.fileName || '图片'}
                        className="message-image"
                        onClick={() => {
                            const fullUrl = sanitizeUrl(getFullFileUrl(parsedContent.fileUrl));
                            if (fullUrl !== '#') {
                                window.open(fullUrl, '_blank');
                            }
                        }}
                    />
                    {parsedContent.fileName && (
                        <div className="message-image-name">{parsedContent.fileName}</div>
                    )}
                </div>
            );
        }

        // 文件消息
        if (parsedContent.fileUrl && parsedContent.fileName) {
            return (
                <div className="message-file-container">
                    <div className="file-icon">
                        <FileTypeIcon type={getFileIconType(parsedContent.mimeType, parsedContent.fileName)} size={28} />
                    </div>
                    <div className="file-info">
                        <a
                            href={sanitizeUrl(getFullFileUrl(parsedContent.fileUrl))}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="file-name"
                        >
                            {parsedContent.fileName}
                        </a>
                        {parsedContent.fileSize && <div className="file-size">{formatFileSize(parsedContent.fileSize)}</div>}
                    </div>
                    <a
                        href={sanitizeUrl(getFullFileUrl(parsedContent.fileUrl))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="file-download"
                        title="下载文件"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 3V15M12 15L8 11M12 15L16 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M3 17V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </a>
                </div>
            );
        }

        // 默认显示原始内容
        return <span className="message-text">{message.content}</span>;
    };

    return (
        <div className={`message-bubble-wrapper ${isOwn ? 'own' : 'other'}`}>
            {showAvatar && !isOwn && (
                <div className="message-avatar">
                    {senderName?.charAt(0).toUpperCase() || 'U'}
                </div>
            )}
            <div className="message-bubble-container">
                {!isOwn && senderName && (
                    <div className="message-sender-name">{senderName}</div>
                )}
                <div className={`message-bubble ${isOwn ? 'own' : 'other'}`}>
                    {renderContent()}
                    <div className="message-footer">
                        <span className="message-time">{formatTime(message.timestamp)}</span>
                        {isOwn && (
                            <MessageStatusIcon
                                status={(message.status as MessageStatusType) || 'sent'}
                                size={14}
                                className="message-status-icon"
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MessageBubble;
