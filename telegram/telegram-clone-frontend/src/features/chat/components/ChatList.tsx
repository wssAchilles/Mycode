import React, { useEffect, useRef } from 'react';
import ChatListItem from './ChatListItem';
import type { ChatSummary } from '../types';

interface ChatListProps {
  chats: ChatSummary[];
  selectedChatId?: string;
  onSelectChat: (chat: ChatSummary) => void;
  isLoading?: boolean;
}

const ChatList: React.FC<ChatListProps> = ({ chats, selectedChatId, onSelectChat, isLoading }) => {
  const initializedRef = useRef(false);
  const seenChatIdsRef = useRef<Set<string>>(new Set());
  const nextNewChatIdsRef = useRef<Set<string>>(new Set());

  if (chats.length > 0) {
    const nextIds = new Set(chats.map((chat) => chat.id));

    if (!initializedRef.current) {
      seenChatIdsRef.current = nextIds;
      nextNewChatIdsRef.current = new Set();
      initializedRef.current = true;
    } else {
      const newIds = new Set<string>();
      for (const id of nextIds) {
        if (!seenChatIdsRef.current.has(id)) {
          newIds.add(id);
        }
      }
      nextNewChatIdsRef.current = newIds;
      seenChatIdsRef.current = nextIds;
    }
  }

  useEffect(() => {
    if (nextNewChatIdsRef.current.size > 0) {
      nextNewChatIdsRef.current = new Set();
    }
  }, [chats]);

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
          isNew={nextNewChatIdsRef.current.has(chat.id)}
          onClick={onSelectChat}
        />
      ))}
    </div>
  );
};

export default React.memo(ChatList);
