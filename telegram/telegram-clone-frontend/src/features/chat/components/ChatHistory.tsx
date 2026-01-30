import React, { useRef, useEffect } from 'react';
import { MessageBubble } from '../../../components/common';
import type { Message } from '../../../types/chat';
import './ChatHistory.css';

interface ChatHistoryProps {
    currentUserId: string;
    messages: Message[];
    isLoading?: boolean;
    hasMore?: boolean;
    onLoadMore?: () => void;
    highlightTerm?: string;
    highlightSeq?: number;
    onMessageSelect?: (message: Message) => void;
    disableAutoScroll?: boolean;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
    currentUserId,
    messages,
    isLoading = false,
    hasMore = false,
    onLoadMore,
    highlightTerm,
    highlightSeq,
    onMessageSelect,
    disableAutoScroll = false
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // 自动滚动到底部（仅在容器内滚动，避免影响父容器）
    useEffect(() => {
        if (disableAutoScroll) return;
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [messages, disableAutoScroll]);

    useEffect(() => {
        if (!highlightSeq || !containerRef.current) return;
        const target = containerRef.current.querySelector(`[data-seq="${highlightSeq}"]`) as HTMLElement | null;
        if (target) {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [highlightSeq]);

    // 处理滚动加载更多
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop } = e.currentTarget;
        if (scrollTop === 0 && hasMore && !isLoading && onLoadMore) {
            onLoadMore();
        }
    };

    return (
        <div
            ref={containerRef}
            className="chat-history"
            onScroll={handleScroll}
        >
            {/* 加载更多指示器 */}
            {isLoading && (
                <div className="chat-history__loading">
                    加载更多消息...
                </div>
            )}

            {/* 消息列表 */}
            {messages.map((msg) => {
                const isOut = msg.userId === currentUserId || msg.senderId === currentUserId;
                const attachment = msg.attachments?.[0];
                const fileUrl = msg.fileUrl || attachment?.fileUrl;
                const isMedia = msg.type === 'image' && !!fileUrl;

                // 判断是否需要显示尾巴（简化版：每条消息都有尾巴）
                // 更精确的逻辑可以判断是否是连续消息的最后一条
                const withTail = true;
                const isHighlighted = typeof highlightSeq === 'number' && msg.seq === highlightSeq;

                const renderContent = () => {
                    if (isMedia) {
                        return (
                            <img
                                src={fileUrl || ''}
                                alt="图片"
                                className="chat-history__media"
                            />
                        );
                    }
                    if (!highlightTerm || !msg.content) return msg.content;
                    const escaped = highlightTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`(${escaped})`, 'gi');
                    return msg.content.split(regex).map((part, index) => {
                        const isMatch = part.toLowerCase() === highlightTerm.toLowerCase();
                        return isMatch ? (
                            <mark key={`${msg.id}-mark-${index}`} className="tg-highlight">
                                {part}
                            </mark>
                        ) : (
                            <span key={`${msg.id}-text-${index}`}>{part}</span>
                        );
                    });
                };

                return (
                    <div
                        key={msg.id}
                        className={`chat-history__item ${onMessageSelect ? 'is-clickable' : ''}`}
                        data-seq={msg.seq}
                        role={onMessageSelect ? 'button' : undefined}
                        tabIndex={onMessageSelect ? 0 : -1}
                        onClick={() => onMessageSelect?.(msg)}
                        onKeyDown={(event) => {
                            if (!onMessageSelect) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onMessageSelect(msg);
                            }
                        }}
                    >
                        <MessageBubble
                            isOut={isOut}
                            time={new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                            isRead={msg.status === 'read'}
                            isSent={msg.status !== 'failed' && msg.status !== 'pending'}
                            readCount={msg.readCount}
                            withTail={withTail}
                            isMedia={isMedia}
                            className={isHighlighted ? 'is-highlighted' : ''}
                        >
                            {renderContent()}
                        </MessageBubble>
                    </div>
                );
            })}

            {/* 底部锚点 */}
            <div ref={bottomRef} />
        </div>
    );
};

export default ChatHistory;
