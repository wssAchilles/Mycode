import React from 'react';
import ChatListItem from './ChatListItem';
import type { ChatSummary } from '../types';

interface ChatListProps {
  chats: ChatSummary[];
  selectedChatId?: string;
  onSelectChat: (chat: ChatSummary) => void;
  isLoading?: boolean;
}

const ChatList: React.FC<ChatListProps> = ({ chats, selectedChatId, onSelectChat, isLoading }) => {
  if (isLoading) {
    return (
      <div className="tg-chat-list-loading">
        <div className="tg-spinner" />
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="tg-chat-list-empty">
        <p>暂无聊天</p>
      </div>
    );
  }

  return (
    <div className="tg-chat-list">
      {chats.map((chat) => (
        <ChatListItem
          key={chat.id}
          chat={chat}
          isSelected={chat.id === selectedChatId}
          onClick={onSelectChat}
        />
      ))}
    </div>
  );
};

export default React.memo(ChatList);
