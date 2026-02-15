import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from '../../../components/common';
import type { Message } from '../../../types/chat';
import { useMessageStore } from '../store/messageStore';
import './ChatHistory.css';

type HighlightConfig = { termLower: string; regex: RegExp } | null;

interface ChatHistoryProps {
  currentUserId: string;

  // Provide one of:
  // - `messages` for small, local lists (search/context mode)
  // - `messageIds + messageIdsVersion` for the worker-driven active chat projection
  messages?: Message[];
  messageIds?: string[];
  messageIdsVersion?: number;

  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  highlightTerm?: string;
  highlightSeq?: number;
  onMessageSelect?: (message: Message) => void;
  disableAutoScroll?: boolean;
}

interface StoreMessageBubbleProps {
  messageId: string;
  currentUserId: string;
  highlightConfig: HighlightConfig;
  highlightSeq?: number;
  timeFormatter: Intl.DateTimeFormat;
}

const StoreMessageBubble: React.FC<StoreMessageBubbleProps> = ({
  messageId,
  currentUserId,
  highlightConfig,
  highlightSeq,
  timeFormatter,
}) => {
  const msg = useMessageStore(useCallback((state) => state.entities.get(messageId), [messageId]));
  if (!msg) return null;

  const isOut = msg.userId === currentUserId || msg.senderId === currentUserId;
  const attachment = msg.attachments?.[0];
  const fileUrl = msg.fileUrl || attachment?.fileUrl;
  const isMedia = msg.type === 'image' && !!fileUrl;
  const withTail = true;
  const isHighlighted = typeof highlightSeq === 'number' && msg.seq === highlightSeq;

  const renderContent = () => {
    if (isMedia) {
      return (
        <img
          src={fileUrl || ''}
          alt="图片"
          className="chat-history__media"
          loading="lazy"
          decoding="async"
        />
      );
    }
    if (!highlightConfig || !msg.content) return msg.content;
    return msg.content.split(highlightConfig.regex).map((part, index) => {
      const isMatch = part.toLowerCase() === highlightConfig.termLower;
      return isMatch ? (
        <mark key={`${msg.id}-mark-${index}`} className="tg-highlight">
          {part}
        </mark>
      ) : (
        <span key={`${msg.id}-text-${index}`}>{part}</span>
      );
    });
  };

  let time = '';
  try {
    time = timeFormatter.format(new Date(msg.timestamp));
  } catch {
    // ignore
  }

  return (
    <MessageBubble
      isOut={isOut}
      time={time}
      isRead={msg.status === 'read'}
      isSent={msg.status !== 'failed' && msg.status !== 'pending'}
      readCount={msg.readCount}
      withTail={withTail}
      isMedia={isMedia}
      className={isHighlighted ? 'is-highlighted' : ''}
    >
      {renderContent()}
    </MessageBubble>
  );
};

const ChatHistory: React.FC<ChatHistoryProps> = ({
  currentUserId,
  messages,
  messageIds,
  messageIdsVersion = 0,
  isLoading = false,
  hasMore = false,
  onLoadMore,
  highlightTerm,
  highlightSeq,
  onMessageSelect,
  disableAutoScroll = false,
}) => {
  const isStoreMode = Array.isArray(messageIds);
  const count = isStoreMode ? (messageIds?.length ?? 0) : (messages?.length ?? 0);
  const listVersion = isStoreMode ? messageIdsVersion : count;

  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const loadMoreLockRef = useRef(false);
  const loadMoreAnchorRef = useRef<{ id: string; offset: number } | null>(null);
  const prevLastMessageIdRef = useRef<string | null>(null);

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }),
    [],
  );

  const highlightConfig = useMemo<HighlightConfig>(() => {
    const term = highlightTerm?.trim();
    if (!term) return null;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { termLower: term.toLowerCase(), regex: new RegExp(`(${escaped})`, 'gi') };
  }, [highlightTerm]);

  const estimateSize = useCallback(
    (index: number) => {
      const msg = isStoreMode
        ? (() => {
            const id = messageIds?.[index];
            if (!id) return undefined;
            return useMessageStore.getState().entities.get(id);
          })()
        : messages?.[index];

      if (!msg) return 72;
      let height = 64;
      const len = msg.content?.length ?? 0;
      if (len > 0) height += Math.min(Math.ceil(len / 36) * 18, 220);
      if (msg.type === 'image') height += 200;
      if (msg.type === 'document' || msg.type === 'video' || msg.type === 'audio') height += 80;
      return height;
    },
    [isStoreMode, messageIds, messages],
  );

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => containerRef.current,
    estimateSize,
    overscan: 8,
    getItemKey: (index) => {
      if (isStoreMode) return messageIds?.[index] ?? index;
      return messages?.[index]?.id ?? messages?.[index]?.seq ?? index;
    },
  });

  const virtualItems = virtualizer.getVirtualItems();

  const scrollToBottom = useCallback(() => {
    if (!count) return;
    virtualizer.scrollToIndex(count - 1, { align: 'end', behavior: 'auto' });
  }, [virtualizer, count]);

  useEffect(() => {
    if (!isLoading) loadMoreLockRef.current = false;
  }, [isLoading]);

  // Preserve viewport position when prepending older messages.
  useEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    if (!anchor) return;

    let idx = -1;
    if (isStoreMode) {
      const ids = messageIds || [];
      for (let i = 0; i < ids.length; i += 1) {
        if (ids[i] === anchor.id) {
          idx = i;
          break;
        }
      }
    } else {
      idx = (messages || []).findIndex((m) => m.id === anchor.id);
    }

    if (idx < 0) {
      loadMoreAnchorRef.current = null;
      return;
    }

    requestAnimationFrame(() => {
      const offsetInfo = virtualizer.getOffsetForIndex(idx, 'start');
      if (offsetInfo) {
        const [toOffset] = offsetInfo;
        virtualizer.scrollToOffset(toOffset + anchor.offset, { behavior: 'auto' });
      } else {
        virtualizer.scrollToIndex(idx, { align: 'start' });
      }
      loadMoreAnchorRef.current = null;
    });
  }, [isStoreMode, listVersion, messageIds, messages, virtualizer]);

  // Auto-scroll only when the user is already at (or near) bottom.
  useEffect(() => {
    if (disableAutoScroll) return;
    if (!count) {
      prevLastMessageIdRef.current = null;
      return;
    }

    const lastId = isStoreMode ? messageIds?.[count - 1] ?? null : messages?.[count - 1]?.id ?? null;
    const prevLastId = prevLastMessageIdRef.current;
    prevLastMessageIdRef.current = lastId;

    if (prevLastId === null) {
      scrollToBottom();
      return;
    }

    if (lastId && lastId !== prevLastId && isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [count, listVersion, isStoreMode, messageIds, messages, disableAutoScroll, scrollToBottom]);

  // Scroll to highlighted message (search context mode only).
  useEffect(() => {
    if (typeof highlightSeq !== 'number') return;
    if (isStoreMode) return;
    const idx = (messages || []).findIndex((m) => m.seq === highlightSeq);
    if (idx < 0) return;
    virtualizer.scrollToIndex(idx, { align: 'center', behavior: 'auto' });
  }, [highlightSeq, isStoreMode, messages, virtualizer]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;

    // Bottom detection (Telegram-style: only autoscroll if already at bottom).
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;

    // Top trigger to load older messages.
    if (scrollTop < 80 && hasMore && !isLoading && onLoadMore && !loadMoreLockRef.current) {
      const first = virtualizer.getVirtualItems()[0];
      const anchorId = (() => {
        if (!first) return null;
        if (isStoreMode) return messageIds?.[first.index] ?? null;
        return messages?.[first.index]?.id ?? null;
      })();

      if (anchorId && first) {
        loadMoreAnchorRef.current = {
          id: anchorId,
          offset: scrollTop - first.start,
        };
      }

      loadMoreLockRef.current = true;
      onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore, virtualizer, isStoreMode, messageIds, messages]);

  const isEmpty = count === 0 && !isLoading;

  return (
    <div
      ref={containerRef}
      className={`chat-history ${isEmpty ? 'chat-history--empty' : ''}`}
      onScroll={handleScroll}
    >
      {isLoading && <div className="chat-history__loading chat-history__loading--overlay">加载中...</div>}

      {isEmpty ? (
        <div className="chat-history__empty-text">暂无消息</div>
      ) : (
        <div
          className="chat-history__inner"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => {
            if (isStoreMode) {
              const id = messageIds?.[virtualRow.index];
              if (!id) return null;
              const seq = useMessageStore.getState().entities.get(id)?.seq;

              return (
                <div
                  key={virtualRow.key}
                  className="chat-history__item"
                  data-index={virtualRow.index}
                  data-seq={seq}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  ref={virtualizer.measureElement}
                >
                  <StoreMessageBubble
                    messageId={id}
                    currentUserId={currentUserId}
                    highlightConfig={highlightConfig}
                    highlightSeq={highlightSeq}
                    timeFormatter={timeFormatter}
                  />
                </div>
              );
            }

            const msg = messages?.[virtualRow.index];
            if (!msg) return null;

            const isOut = msg.userId === currentUserId || msg.senderId === currentUserId;
            const attachment = msg.attachments?.[0];
            const fileUrl = msg.fileUrl || attachment?.fileUrl;
            const isMedia = msg.type === 'image' && !!fileUrl;
            const withTail = true;
            const isHighlighted = typeof highlightSeq === 'number' && msg.seq === highlightSeq;

            const renderContent = () => {
              if (isMedia) {
                return (
                  <img
                    src={fileUrl || ''}
                    alt="图片"
                    className="chat-history__media"
                    loading="lazy"
                    decoding="async"
                  />
                );
              }
              if (!highlightConfig || !msg.content) return msg.content;
              return msg.content.split(highlightConfig.regex).map((part, index) => {
                const isMatch = part.toLowerCase() === highlightConfig.termLower;
                return isMatch ? (
                  <mark key={`${msg.id}-mark-${index}`} className="tg-highlight">
                    {part}
                  </mark>
                ) : (
                  <span key={`${msg.id}-text-${index}`}>{part}</span>
                );
              });
            };

            let time = '';
            try {
              time = timeFormatter.format(new Date(msg.timestamp));
            } catch {
              // ignore
            }

            return (
              <div
                key={virtualRow.key}
                className={`chat-history__item ${onMessageSelect ? 'is-clickable' : ''}`}
                data-index={virtualRow.index}
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
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                ref={virtualizer.measureElement}
              >
                <MessageBubble
                  isOut={isOut}
                  time={time}
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
        </div>
      )}
    </div>
  );
};

export default ChatHistory;

