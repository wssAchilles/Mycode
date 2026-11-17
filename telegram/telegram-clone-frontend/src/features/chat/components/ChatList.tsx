import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import ChatListItem from './ChatListItem';
import type { ChatSummary } from '../types';
import './ChatList.css';

interface ChatListProps {
  chats: ChatSummary[];
  selectedChatId?: string;
  onSelectChat: (chat: ChatSummary) => void;
  isLoading?: boolean;
}

const ESTIMATED_CHAT_ITEM_HEIGHT = 80;
const CHAT_ITEM_GAP = 8;
const CHAT_LIST_OVERSCAN = 6;
const FALLBACK_VIEWPORT_RECT = { width: 320, height: 640 };

const ChatList: React.FC<ChatListProps> = ({ chats, selectedChatId, onSelectChat, isLoading }) => {
  const initializedRef = useRef(false);
  const seenChatIdsRef = useRef<Set<string>>(new Set());
  const nextNewChatIdsRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const prevSelectedChatIdRef = useRef<string | undefined>(undefined);

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

  // 优先复用外层 .contact-list-container 作为虚拟滚动容器，独立渲染时回退到自身
  const handleListRef = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    if (!node) {
      setScrollElement(null);
      return;
    }
    const parentScroll = node.closest('.contact-list-container') as HTMLElement | null;
    setScrollElement(parentScroll || node);
  }, []);

  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ESTIMATED_CHAT_ITEM_HEIGHT,
    overscan: CHAT_LIST_OVERSCAN,
    gap: CHAT_ITEM_GAP,
    initialRect: FALLBACK_VIEWPORT_RECT,
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) => {
        // 容器高度为 0（如 JSDOM 测试或隐藏态）时保留回退视口尺寸，确保虚拟列表仍可计算可视切片
        cb(rect.height > 0 ? rect : FALLBACK_VIEWPORT_RECT);
      }),
    measureElement: (element) => {
      const height = element.getBoundingClientRect().height;
      return height > 0 ? height : ESTIMATED_CHAT_ITEM_HEIGHT;
    },
    getItemKey: (index) => chats[index]?.id ?? index,
  });

  const safeScrollToChatIndex = useCallback(
    (index: number, align: 'start' | 'center' | 'end' | 'auto' = 'auto') => {
      if (chats.length <= 0 || index < 0 || index >= chats.length) return;
      if (!scrollElement || scrollElement.clientHeight <= 0) return;
      const measurements = virtualizer.getMeasurements();
      if (!measurements || index >= measurements.length || !measurements[index]) return;
      virtualizer.scrollToIndex(index, { align, behavior: 'auto' });
    },
    [chats.length, scrollElement, virtualizer],
  );

  // 选中会话切换时自动确保其在可视区域内
  useEffect(() => {
    if (!selectedChatId || selectedChatId === prevSelectedChatIdRef.current) {
      prevSelectedChatIdRef.current = selectedChatId;
      return;
    }
    prevSelectedChatIdRef.current = selectedChatId;
    const selectedIndex = chats.findIndex((chat) => chat.id === selectedChatId);
    if (selectedIndex < 0) return;
    const rafId = requestAnimationFrame(() => {
      safeScrollToChatIndex(selectedIndex, 'auto');
    });
    return () => cancelAnimationFrame(rafId);
  }, [chats, safeScrollToChatIndex, selectedChatId]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!chats.length) return;
      const target = event.target as HTMLElement | null;
      const row = target?.closest('[data-chat-index]') as HTMLElement | null;
      const currentIndex = row ? Number(row.dataset.chatIndex) : -1;
      if (!Number.isInteger(currentIndex) || currentIndex < 0) return;

      let nextIndex = -1;
      if (event.key === 'ArrowDown') {
        nextIndex = Math.min(chats.length - 1, currentIndex + 1);
      } else if (event.key === 'ArrowUp') {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = chats.length - 1;
      }

      if (nextIndex < 0 || nextIndex === currentIndex) return;
      event.preventDefault();
      safeScrollToChatIndex(nextIndex, 'auto');
      requestAnimationFrame(() => {
        const nextBtn = listRef.current?.querySelector<HTMLButtonElement>(
          `[data-chat-index="${nextIndex}"] .tg-chat-item`,
        );
        nextBtn?.focus();
      });
    },
    [chats.length, safeScrollToChatIndex],
  );

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

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={handleListRef} className="tg-chat-list" role="list" onKeyDown={handleKeyDown}>
      <div
        className="tg-chat-list__inner"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const chat = chats[virtualRow.index];
          if (!chat) return null;

          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              data-chat-index={virtualRow.index}
              role="listitem"
              className="tg-chat-list__item"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ChatListItem
                chat={chat}
                isSelected={chat.id === selectedChatId}
                isNew={nextNewChatIdsRef.current.has(chat.id)}
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
