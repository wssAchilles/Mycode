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
    const loadChats = useChatStore((state: any) => state.loadChats); // Typed in store, but explicit here if needed
    const selectChat = useChatStore((state: any) => state.selectChat);

    useEffect(() => {
        loadChats();
    }, [loadChats]);

    const handleSelectChat = (chat: ChatSummary) => {
        selectChat(chat.id);
        if (onChatSelected) {
            onChatSelected(chat.id);
        }
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
