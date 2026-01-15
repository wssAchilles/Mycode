/**
 * ChatWindow 组件
 * 主消息窗口：消息列表 + 消息输入
 */
import React, { useRef, useEffect, useCallback } from 'react';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import type { Contact, Message } from '../../types/store';
import './ChatWindow.css';

interface ChatWindowProps {
    // 当前选中的联系人
    selectedContact: Contact | null;

    // 消息列表
    messages: Message[];
    isLoadingMessages: boolean;
    hasMoreMessages: boolean;

    // 当前用户ID
    currentUserId: string;

    // 连接状态
    isConnected: boolean;
    isUploading: boolean;

    // 事件处理
    onSendMessage: (content: string) => void;
    onFileUpload: (file: File) => void;
    onLoadMore: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
    selectedContact,
    messages,
    isLoadingMessages,
    hasMoreMessages,
    currentUserId,
    isConnected,
    isUploading,
    onSendMessage,
    onFileUpload,
    onLoadMore,
}) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 自动滚动到底部
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // 消息变化时滚动
    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // 滚动加载更多
    const handleScroll = useCallback(
        (e: React.UIEvent<HTMLDivElement>) => {
            const { scrollTop } = e.currentTarget;
            if (scrollTop === 0 && hasMoreMessages && !isLoadingMessages) {
                onLoadMore();
            }
        },
        [hasMoreMessages, isLoadingMessages, onLoadMore]
    );

    // 未选择联系人时的空状态
    if (!selectedContact) {
        return (
            <div className="chat-window empty">
                <div className="empty-state">
                    <div className="empty-icon">💬</div>
                    <h3>选择一个联系人开始聊天</h3>
                    <p>从左侧选择联系人或使用 AI 助手</p>
                </div>
            </div>
        );
    }

    return (
        <div className="chat-window">
            {/* 聊天头部 */}
            <div className="chat-header">
                <div className="chat-contact-info">
                    <div
                        className="chat-contact-avatar"
                        style={{
                            background: selectedContact.avatarUrl
                                ? `url(${selectedContact.avatarUrl})`
                                : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                        }}
                    >
                        {!selectedContact.avatarUrl &&
                            selectedContact.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="chat-contact-details">
                        <h2>{selectedContact.alias || selectedContact.username}</h2>
                        <span
                            className={`chat-contact-status ${selectedContact.isOnline ? 'online' : 'offline'
                                }`}
                        >
                            {selectedContact.isOnline ? '在线' : '离线'}
                        </span>
                    </div>
                </div>
                <div className="chat-header-actions">
                    <button className="header-action-btn" title="搜索">
                        🔍
                    </button>
                    <button className="header-action-btn" title="更多">
                        ⋮
                    </button>
                </div>
            </div>

            {/* 消息列表 */}
            <div
                className="messages-container"
                ref={containerRef}
                onScroll={handleScroll}
            >
                {/* 加载更多指示器 */}
                {isLoadingMessages && (
                    <div className="loading-more">
                        <span>加载中...</span>
                    </div>
                )}

                {/* 没有消息时 */}
                {!isLoadingMessages && messages.length === 0 && (
                    <div className="no-messages">
                        <span className="wave-emoji">👋</span>
                        <p>
                            向 <strong>{selectedContact.username}</strong> 发送第一条消息吧！
                        </p>
                    </div>
                )}

                {/* 消息列表 */}
                {messages.map((msg) => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        isOwn={msg.senderId === currentUserId || msg.userId === currentUserId}
                        senderName={msg.senderUsername || msg.username}
                    />
                ))}

                {/* 滚动锚点 */}
                <div ref={messagesEndRef} />
            </div>

            {/* 消息输入 */}
            <MessageInput
                onSend={onSendMessage}
                onFileUpload={onFileUpload}
                disabled={!isConnected}
                isUploading={isUploading}
                placeholder={
                    isConnected
                        ? `给 ${selectedContact.username} 发消息...`
                        : '连接中...'
                }
            />
        </div>
    );
};

export default ChatWindow;
