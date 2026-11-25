import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, Pin, PinOff, Search, X } from 'lucide-react';
import { useChatStore, selectAllChats, selectActiveChatId, selectIsLoading } from './store/chatStore';
import { useChatUiPrefsStore } from './state/chatUiPrefsStore';
import ChatList from './components/ChatList';
import type { ChatSummary } from './types';
import './ChatListContainer.css';

interface ChatListContainerProps {
  onChatSelected?: (chatId: string) => void;
}

export type ChatListFilterTab = 'all' | 'unread' | 'group';

const FILTER_TABS: Array<{ key: ChatListFilterTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'group', label: '群聊' },
];

const ChatListContainer: React.FC<ChatListContainerProps> = ({ onChatSelected }) => {
  const chats = useChatStore(selectAllChats);
  const selectedChatId = useChatStore(selectActiveChatId);
  const isLoading = useChatStore(selectIsLoading);
  const loadCachedChats = useChatStore((state) => state.loadCachedChats);
  const loadChats = useChatStore((state) => state.loadChats);
  const selectChat = useChatStore((state) => state.selectChat);

  const pinnedChatIds = useChatUiPrefsStore((state) => state.pinnedChatIds);
  const mutedChatIds = useChatUiPrefsStore((state) => state.mutedChatIds);
  const togglePinChat = useChatUiPrefsStore((state) => state.togglePinChat);
  const toggleMuteChat = useChatUiPrefsStore((state) => state.toggleMuteChat);

  const [filterQuery, setFilterQuery] = useState('');
  const [filterTab, setFilterTab] = useState<ChatListFilterTab>('all');
  const [contextMenu, setContextMenu] = useState<{
    chat: ChatSummary;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    void loadCachedChats().finally(() => {
      void loadChats();
    });
  }, [loadCachedChats, loadChats]);

  useEffect(() => {
    if (!contextMenu || typeof window === 'undefined') return;
    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const displayedChats = useMemo(() => {
    const queryLower = filterQuery.trim().toLowerCase();
    const pinnedIndexMap = new Map<string, number>();
    pinnedChatIds.forEach((id, idx) => pinnedIndexMap.set(id, idx));

    const filtered = chats.filter((chat) => {
      if (filterTab === 'unread' && (chat.unreadCount || 0) <= 0) return false;
      if (filterTab === 'group' && !chat.isGroup) return false;
      if (queryLower) {
        const titleHit = (chat.title || '').toLowerCase().includes(queryLower);
        const msgHit = (chat.lastMessage || '').toLowerCase().includes(queryLower);
        if (!titleHit && !msgHit) return false;
      }
      return true;
    });

    if (pinnedIndexMap.size === 0) return filtered;

    return filtered.slice().sort((a, b) => {
      const aPin = pinnedIndexMap.get(a.id);
      const bPin = pinnedIndexMap.get(b.id);
      if (aPin !== undefined && bPin !== undefined) return aPin - bPin;
      if (aPin !== undefined) return -1;
      if (bPin !== undefined) return 1;
      return 0;
    });
  }, [chats, filterQuery, filterTab, pinnedChatIds]);

  const handleSelectChat = (chat: ChatSummary) => {
    if (onChatSelected) {
      onChatSelected(chat.id);
      return;
    }
    selectChat(chat.id);
  };

  const handleChatContextMenu = (chat: ChatSummary, e: React.MouseEvent) => {
    e.preventDefault();
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
    const x = Math.min(e.clientX, viewportW - 170);
    const y = Math.min(e.clientY, viewportH - 100);
    setContextMenu({ chat, x, y });
  };

  const unreadTabCount = useMemo(
    () => chats.filter((c) => (c.unreadCount || 0) > 0).length,
    [chats],
  );

  const isContextPinned = contextMenu ? pinnedChatIds.includes(contextMenu.chat.id) : false;
  const isContextMuted = contextMenu ? mutedChatIds.includes(contextMenu.chat.id) : false;

  return (
    <>
      {chats.length > 0 && (
        <div className="tg-chat-list-toolbar">
          <div className="tg-chat-list-search">
            <span className="tg-chat-list-search__icon" aria-hidden="true">
              <Search size={14} />
            </span>
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="搜索联系人或消息摘要..."
              aria-label="筛选会话列表"
              className="tg-chat-list-search__input"
            />
            {filterQuery && (
              <button
                type="button"
                className="tg-chat-list-search__clear"
                onClick={() => setFilterQuery('')}
                aria-label="清除搜索关键词"
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="tg-chat-list-tabs" role="tablist" aria-label="会话分类筛选">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={filterTab === tab.key}
                className={`tg-chat-list-tab ${filterTab === tab.key ? 'is-active' : ''}`}
                onClick={() => setFilterTab(tab.key)}
              >
                {tab.label}
                {tab.key === 'unread' && unreadTabCount > 0 ? ` (${unreadTabCount})` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <ChatList
        chats={displayedChats}
        selectedChatId={selectedChatId}
        onSelectChat={handleSelectChat}
        onChatContextMenu={handleChatContextMenu}
        isLoading={isLoading}
        emptyMessage={filterQuery || filterTab !== 'all' ? '未找到匹配的会话' : '暂无聊天'}
      />

      {contextMenu && (
        <div
          className="tg-chat-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="tg-chat-context-menu__item"
            onClick={() => {
              togglePinChat(contextMenu.chat.id);
              setContextMenu(null);
            }}
          >
            {isContextPinned ? <PinOff size={14} /> : <Pin size={14} />}
            <span>{isContextPinned ? '取消置顶' : '置顶会话'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tg-chat-context-menu__item"
            onClick={() => {
              toggleMuteChat(contextMenu.chat.id);
              setContextMenu(null);
            }}
          >
            {isContextMuted ? <Bell size={14} /> : <BellOff size={14} />}
            <span>{isContextMuted ? '开启声音提醒' : '设为免打扰'}</span>
          </button>
        </div>
      )}
    </>
  );
};

export default ChatListContainer;
