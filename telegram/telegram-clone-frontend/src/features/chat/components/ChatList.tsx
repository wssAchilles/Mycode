import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatSummary } from '../types';
import ChatListItem from './ChatListItem';

interface ChatListProps {
    chats: ChatSummary[];
    selectedChatId?: string;
    onSelectChat: (chat: ChatSummary) => void;
    isLoading?: boolean;
}

const ChatList: React.FC<ChatListProps> = ({
    chats,
    selectedChatId,
    onSelectChat,
    isLoading
}) => {
    const parentRef = useRef<HTMLDivElement>(null);

    const rowVirtualizer = useVirtualizer({
        count: chats.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 72, // Default height of chat item (54 + padding)
        overscan: 5,
    });

    if (isLoading) {
        return (
            <div className="tg-chat-list-loading">
                Loading...
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            style={{
                height: '100%',
                overflowY: 'auto',
                contain: 'strict',
            }}
            className="tg-scroll-hide" // Utility class to hide scrollbar if preferred
        >
            <div
                style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const chat = chats[virtualRow.index];
                    return (
                        <div
                            key={virtualRow.key}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            <ChatListItem
                                chat={chat}
                                isSelected={selectedChatId === chat.id}
                                onClick={onSelectChat}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default React.memo(ChatList);
