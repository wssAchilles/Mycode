/**
 * VirtualMessageList 组件
 * 使用 @tanstack/react-virtual 实现高性能消息列表渲染
 */
import React, { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../../types/store';
import './VirtualMessageList.css';

interface VirtualMessageListProps {
    messages: Message[];
    currentUserId: string;
    isLoadingMore: boolean;
    hasMoreMessages: boolean;
    onLoadMore: () => void;
}

// 估算消息高度
const estimateSize = (message: Message): number => {
    // 基础高度
    let height = 60;

    // 根据内容长度调整
    if (message.content) {
        const lines = Math.ceil(message.content.length / 40);
        height += Math.min(lines * 20, 200);
    }

    // 图片消息额外高度
    if (message.type === 'image') {
        height += 200;
    }

    // 文件消息额外高度
    if (message.type === 'document' || message.type === 'video' || message.type === 'audio') {
        height += 60;
    }

    return height;
};

export const VirtualMessageList: React.FC<VirtualMessageListProps> = ({
    messages,
    currentUserId,
    isLoadingMore,
    hasMoreMessages,
    onLoadMore,
}) => {
    const parentRef = useRef<HTMLDivElement>(null);
    const scrolledToBottomRef = useRef(true);

    // 虚拟化配置
    const virtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index) => estimateSize(messages[index]),
        overscan: 5,
        getItemKey: (index) => messages[index]?.id || index,
    });

    const virtualItems = virtualizer.getVirtualItems();

    // 自动滚动到底部
    const scrollToBottom = useCallback(() => {
        if (parentRef.current) {
            virtualizer.scrollToIndex(messages.length - 1, {
                align: 'end',
                behavior: 'smooth',
            });
        }
    }, [virtualizer, messages.length]);

    // 监听新消息，自动滚动
    useEffect(() => {
        if (scrolledToBottomRef.current && messages.length > 0) {
            scrollToBottom();
        }
    }, [messages.length, scrollToBottom]);

    // 监听滚动
    const handleScroll = useCallback(() => {
        if (!parentRef.current) return;

        const { scrollTop, scrollHeight, clientHeight } = parentRef.current;

        // 检测是否在底部
        scrolledToBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;

        // 滚动到顶部加载更多
        if (scrollTop < 100 && hasMoreMessages && !isLoadingMore) {
            onLoadMore();
        }
    }, [hasMoreMessages, isLoadingMore, onLoadMore]);

    return (
        <div
            ref={parentRef}
            className="virtual-message-list"
            onScroll={handleScroll}
        >
            {/* 加载更多指示器 */}
            {isLoadingMore && (
                <div className="loading-indicator">
                    <div className="loading-spinner" />
                    <span>加载更多消息...</span>
                </div>
            )}

            {/* 虚拟化容器 */}
            <div
                className="virtual-container"
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {virtualItems.map((virtualRow) => {
                    const message = messages[virtualRow.index];
                    const isOwn =
                        message.senderId === currentUserId ||
                        message.userId === currentUserId;

                    return (
                        <div
                            key={virtualRow.key}
                            className="virtual-row"
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                            ref={virtualizer.measureElement}
                            data-index={virtualRow.index}
                        >
                            <MessageBubble
                                message={message}
                                isOwn={isOwn}
                                senderName={message.senderUsername || message.username}
                            />
                        </div>
                    );
                })}
            </div>

            {/* 滚动到底部按钮 */}
            {!scrolledToBottomRef.current && messages.length > 20 && (
                <button
                    className="scroll-to-bottom"
                    onClick={scrollToBottom}
                    title="滚动到最新消息"
                >
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path
                            fill="currentColor"
                            d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                        />
                    </svg>
                </button>
            )}
        </div>
    );
};

export default VirtualMessageList;
