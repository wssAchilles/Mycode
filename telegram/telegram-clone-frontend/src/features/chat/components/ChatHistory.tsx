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
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
    currentUserId,
    messages,
    isLoading = false,
    hasMore = false,
    onLoadMore
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // 自动滚动到底部
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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
                const isMedia = msg.type === 'image';

                // 判断是否需要显示尾巴（简化版：每条消息都有尾巴）
                // 更精确的逻辑可以判断是否是连续消息的最后一条
                const withTail = true;

                return (
                    <MessageBubble
                        key={msg.id}
                        isOut={isOut}
                        time={new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                        isRead={msg.status === 'read'}
                        isSent={msg.status !== 'failed' && msg.status !== 'pending'}
                        withTail={withTail}
                        isMedia={isMedia}
                    >
                        {isMedia ? (
                            <img
                                src={msg.fileUrl || ''}
                                alt="图片"
                                className="chat-history__media"
                            />
                        ) : (
                            msg.content
                        )}
                    </MessageBubble>
                );
            })}

            {/* 底部锚点 */}
            <div ref={bottomRef} />
        </div>
    );
};

export default ChatHistory;
