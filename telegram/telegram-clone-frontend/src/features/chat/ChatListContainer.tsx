import React, { useEffect } from 'react';
import { useChatStore, selectAllChats, selectActiveChatId, selectIsLoading } from './store/chatStore';
import ChatList from './components/ChatList';
import type { ChatSummary } from './types';

interface ChatListContainerProps {
    onChatSelected?: (chatId: string) => void;
}

const ChatListContainer: React.FC<ChatListContainerProps> = ({ onChatSelected }) => {
    const chats = useChatStore(selectAllChats);
    const selectedChatId = useChatStore(selectActiveChatId);
    const isLoading = useChatStore(selectIsLoading);
    const loadCachedChats = useChatStore((state) => state.loadCachedChats);
    const loadChats = useChatStore((state) => state.loadChats);
    const selectChat = useChatStore((state) => state.selectChat);

    useEffect(() => {
        void loadCachedChats().finally(() => {
            void loadChats();
        });
    }, [loadCachedChats, loadChats]);

    const handleSelectChat = (chat: ChatSummary) => {
        if (onChatSelected) {
            onChatSelected(chat.id);
            return;
        }
        selectChat(chat.id);
    };

    return (
        <ChatList
            chats={chats}
            selectedChatId={selectedChatId}
            onSelectChat={handleSelectChat}
            isLoading={isLoading}
        />
    );
};

export default ChatListContainer;
