import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Message } from '../../../types/chat';
import { isSameCalendarDay } from '../../../utils/dateTime';
import { readChatScrollState, saveChatScrollState } from '../state/chatScrollMemory';
import { useMessageStore } from '../store/messageStore';
import { useChatStore } from '../store/chatStore';
import { ChatImageLightbox, type LightboxMediaItem } from './media/ChatImageLightbox';
import { MessageActionMenu } from './history/MessageActionMenu';
import {
  MessageBubbleRow,
  type HighlightConfig,
  type ImagePreviewPayload,
  type SenderMeta,
} from './history/MessageBubbleRow';
import './ChatHistory.css';

type EmptyStateKind = 'loading' | 'empty' | 'error';
const EMPTY_GROUP_MEMBERS: readonly [] = [];

interface ChatHistoryProps {
  chatId?: string | null;
  currentUserId: string;
  currentUsername?: string;

  // Provide one of:
  // - `messages` for small, local lists (search/context mode)
  // - `messageIds + messageIdsVersion` for the worker-driven active chat projection
  messages?: Message[];
  messageIds?: string[];
  messageIdsVersion?: number;

  isLoading?: boolean;
  hasHistoryHint?: boolean;
  errorMessage?: string | null;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onRetryLoad?: () => void;
  highlightTerm?: string;
  highlightSeq?: number;
  unreadAnchorSeq?: number | null;
  onMessageSelect?: (message: Message) => void;
  onVisibleRangeChange?: (start: number, end: number) => void;
  disableAutoScroll?: boolean;
  onReplyMessage?: (message: Message) => void;
  onEditMessage?: (message: Message) => void;
  onDeleteMessage?: (message: Message) => void;
  onRetryMessage?: (message: Message) => void;
  onToggleReaction?: (message: Message, emoji: string) => void;
  onForwardMessage?: (message: Message) => void;
  onEnterMultiSelect?: (message: Message) => void;
  onPinMessage?: (message: Message) => void;
  onAskAiMessage?: (message: Message) => void;
  selectionMode?: boolean;
  selectedMessageIds?: Set<string>;
  onToggleSelectMessage?: (message: Message) => void;
  jumpToMessageRef?: React.MutableRefObject<((messageId: string) => void) | null>;
}

interface StoreMessageBubbleProps {
  messageId: string;
  prevMessageId?: string | null;
  currentUserId: string;
  currentUsername?: string;
  highlightConfig: HighlightConfig;
  highlightSeq?: number;
  isFlashed?: boolean;
  showGroupSenderMeta: boolean;
  resolveSenderMeta: (msg: Message) => SenderMeta;
  resolveReplyTarget: (replyToId: string) => Message | undefined;
  onJumpToMessage: (messageId: string) => void;
  onPreviewImage: (payload: ImagePreviewPayload) => void;
  onCopyMessage: (msg: Message) => void;
  onReplyMessage?: (msg: Message) => void;
  onRetryMessage?: (msg: Message) => void;
  onToggleReaction?: (msg: Message, emoji: string) => void;
  onOpenContextMenu: (msg: Message, isOut: boolean, x: number, y: number) => void;
  enableActions: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (msg: Message) => void;
}

const OVERSCAN_IDLE = 6;
const OVERSCAN_MEDIUM = 8;
const OVERSCAN_FAST = 10;
const OVERSCAN_UPDATE_INTERVAL_MS = 160;
const VISIBLE_RANGE_FLUSH_INTERVAL_MS = 42;

const StoreMessageBubble: React.FC<StoreMessageBubbleProps> = ({
  messageId,
  prevMessageId,
  currentUserId,
  currentUsername,
  highlightConfig,
  highlightSeq,
  isFlashed,
  showGroupSenderMeta,
  resolveSenderMeta,
  resolveReplyTarget,
  onJumpToMessage,
  onPreviewImage,
  onCopyMessage,
  onReplyMessage,
  onRetryMessage,
  onToggleReaction,
  onOpenContextMenu,
  enableActions,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}) => {
  const msg = useMessageStore(useCallback((state) => state.entities.get(messageId), [messageId]));
  const prevMsg = useMessageStore(
    useCallback((state) => (prevMessageId ? state.entities.get(prevMessageId) : undefined), [prevMessageId]),
  );
  if (!msg) return <div className="chat-history__placeholder" aria-hidden="true" />;

  return (
    <MessageBubbleRow
      message={msg}
      previousMessage={prevMsg}
      currentUserId={currentUserId}
      currentUsername={currentUsername}
      useProgressiveImage
      highlightConfig={highlightConfig}
      highlightSeq={highlightSeq}
      isFlashed={isFlashed}
      showGroupSenderMeta={showGroupSenderMeta}
      resolveSenderMeta={resolveSenderMeta}
      resolveReplyTarget={resolveReplyTarget}
      onJumpToMessage={onJumpToMessage}
      onPreviewImage={onPreviewImage}
      onCopyMessage={onCopyMessage}
      onReplyMessage={onReplyMessage}
      onRetryMessage={onRetryMessage}
      onToggleReaction={onToggleReaction}
      onOpenContextMenu={onOpenContextMenu}
      enableActions={enableActions}
      selectionMode={selectionMode}
      isSelected={isSelected}
      onToggleSelect={onToggleSelect}
    />
  );
};

const ChatHistory: React.FC<ChatHistoryProps> = ({
  chatId = null,
  currentUserId,
  currentUsername,
  messages,
  messageIds,
  messageIdsVersion = 0,
  isLoading = false,
  hasHistoryHint = false,
  errorMessage = null,
  hasMore = false,
  onLoadMore,
  onRetryLoad,
  highlightTerm,
  highlightSeq,
  unreadAnchorSeq = null,
  onMessageSelect,
  onVisibleRangeChange,
  disableAutoScroll = false,
  onReplyMessage,
  onEditMessage,
  onDeleteMessage,
  onRetryMessage,
  onToggleReaction,
  onForwardMessage,
  onEnterMultiSelect,
  onPinMessage,
  selectionMode = false,
  selectedMessageIds,
  onToggleSelectMessage,
  jumpToMessageRef,
}) => {
  const isStoreMode = Array.isArray(messageIds);
  const count = isStoreMode ? (messageIds?.length ?? 0) : (messages?.length ?? 0);
  const listVersion = isStoreMode ? messageIdsVersion : count;
  const isGroupChatMode = useChatStore((state) => state.isGroupChatMode);
  const selectedGroupMembers = useChatStore((state) => state.selectedGroup?.members);
  const groupMembers = selectedGroupMembers ?? EMPTY_GROUP_MEMBERS;

  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const loadMoreLockRef = useRef(false);
  const loadMoreAnchorRef = useRef<{ id: string; offset: number } | null>(null);
  const prevLastMessageIdRef = useRef<string | null>(null);
  const [overscan, setOverscan] = useState(OVERSCAN_IDLE);
  const overscanRef = useRef(OVERSCAN_IDLE);
  const overscanLastSetAtRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const lastScrollTsRef = useRef(0);
  const rafScrollRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const visibleRangeLastAtRef = useRef(0);
  const visibleRangeLastSentRef = useRef<{ start: number; end: number }>({ start: -1, end: -1 });
  const visibleRangePendingRef = useRef<{ start: number; end: number } | null>(null);
  const visibleRangeRafRef = useRef<number | null>(null);
  const latestCountRef = useRef(count);
  latestCountRef.current = count;
  const scrollRafRef = useRef<number | null>(null);
  const loadMoreAnchorRafRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lightboxMedia, setLightboxMedia] = useState<ImagePreviewPayload | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    message: Message;
    isOut: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [unreadBelowCount, setUnreadBelowCount] = useState(0);
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const restoredScrollRef = useRef(false);

  const enableActions = Boolean(
    !onMessageSelect
    && (onReplyMessage || onEditMessage || onDeleteMessage || onRetryMessage || onToggleReaction),
  );

  // 收集当前会话中的图片消息，供多图相册灯箱左右切换
  const galleryImages = useMemo<LightboxMediaItem[]>(() => {
    const items: LightboxMediaItem[] = [];
    if (isStoreMode && messageIds) {
      const { entities } = useMessageStore.getState();
      for (const id of messageIds) {
        const msg = entities.get(id);
        if (!msg || msg.type !== 'image') continue;
        const src = msg.fileUrl || msg.attachments?.[0]?.fileUrl;
        if (!src) continue;
        items.push({
          id: msg.id,
          src,
          fileName: msg.fileName || msg.attachments?.[0]?.fileName,
        });
      }
      return items;
    }

    for (const msg of messages || []) {
      if (msg.type !== 'image') continue;
      const src = msg.fileUrl || msg.attachments?.[0]?.fileUrl;
      if (!src) continue;
      items.push({
        id: msg.id,
        src,
        fileName: msg.fileName || msg.attachments?.[0]?.fileName,
      });
    }
    return items;
  }, [isStoreMode, messageIds, listVersion, messages]);

  // 定位第一条未读消息 ID（用于在列表内渲染“以下为新消息”分界线）
  const firstUnreadMessageId = useMemo<string | null>(() => {
    if (typeof unreadAnchorSeq !== 'number' || !Number.isFinite(unreadAnchorSeq)) {
      return null;
    }
    if (isStoreMode && messageIds) {
      const { entities } = useMessageStore.getState();
      for (const id of messageIds) {
        const msg = entities.get(id);
        if (!msg || typeof msg.seq !== 'number') continue;
        const isIncoming = msg.userId !== currentUserId && msg.senderId !== currentUserId;
        if (isIncoming && msg.seq > unreadAnchorSeq) {
          return msg.id;
        }
      }
      return null;
    }
    for (const msg of messages || []) {
      if (typeof msg.seq !== 'number') continue;
      const isIncoming = msg.userId !== currentUserId && msg.senderId !== currentUserId;
      if (isIncoming && msg.seq > unreadAnchorSeq) {
        return msg.id;
      }
    }
    return null;
  }, [unreadAnchorSeq, isStoreMode, messageIds, listVersion, messages, currentUserId]);

  const lightboxInitialIndex = useMemo(() => {
    if (!lightboxMedia || galleryImages.length === 0) return 0;
    const byId = lightboxMedia.messageId
      ? galleryImages.findIndex((item) => item.id === lightboxMedia.messageId)
      : -1;
    if (byId >= 0) return byId;
    const bySrc = galleryImages.findIndex((item) => item.src === lightboxMedia.src);
    return bySrc >= 0 ? bySrc : 0;
  }, [lightboxMedia, galleryImages]);

  const groupMemberByUserId = useMemo(() => {
    const map = new Map<string, { username?: string; avatarUrl?: string }>();
    for (const member of groupMembers) {
      const userId = member?.userId ? String(member.userId) : '';
      if (!userId) continue;
      map.set(userId, {
        username: member?.username,
        avatarUrl: member?.avatarUrl,
      });
    }
    return map;
  }, [groupMembers]);

  const groupMemberByName = useMemo(() => {
    const map = new Map<string, { username?: string; avatarUrl?: string }>();
    for (const member of groupMembers) {
      const key = typeof member?.username === 'string' ? member.username.trim().toLowerCase() : '';
      if (!key) continue;
      map.set(key, {
        username: member?.username,
        avatarUrl: member?.avatarUrl,
      });
    }
    return map;
  }, [groupMembers]);

  const resolveSenderMeta = useCallback(
    (msg: Message): SenderMeta => {
      const senderId = msg.senderId ? String(msg.senderId) : msg.userId ? String(msg.userId) : '';
      const senderNameRaw =
        typeof msg.senderUsername === 'string'
          ? msg.senderUsername
          : typeof msg.username === 'string'
            ? msg.username
            : '';
      const senderNameKey = senderNameRaw.trim().toLowerCase();
      const byId = senderId ? groupMemberByUserId.get(senderId) : undefined;
      const byName = senderNameKey ? groupMemberByName.get(senderNameKey) : undefined;

      return {
        senderName: byId?.username || byName?.username || senderNameRaw || '未知用户',
        senderAvatarUrl: byId?.avatarUrl || byName?.avatarUrl,
      };
    },
    [groupMemberByName, groupMemberByUserId],
  );

  const highlightConfig = useMemo<HighlightConfig>(() => {
    const term = highlightTerm?.trim();
    if (!term) return null;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { termLower: term.toLowerCase(), regex: new RegExp(`(${escaped})`, 'gi') };
  }, [highlightTerm]);

  const estimateSize = useCallback(
    (index: number) => {
      const getAt = (idx: number) => {
        if (idx < 0) return undefined;
        if (isStoreMode) {
          const id = messageIds?.[idx];
          return id ? useMessageStore.getState().entities.get(id) : undefined;
        }
        return messages?.[idx];
      };

      const msg = getAt(index);
      if (!msg) return 72;

      let height = 64;
      const len = msg.content?.length ?? 0;
      if (len > 0) height += Math.min(Math.ceil(len / 36) * 18, 220);
      if (msg.type === 'image') height += 200;
      if (msg.type === 'document' || msg.type === 'file' || msg.type === 'video' || msg.type === 'audio') {
        height += 80;
      }
      if (msg.replyTo) height += 44;

      const prevMsg = index > 0 ? getAt(index - 1) : undefined;
      const curDate = msg.timestamp ? new Date(msg.timestamp) : null;
      const prevDate = prevMsg?.timestamp ? new Date(prevMsg.timestamp) : null;
      if (
        curDate
        && Number.isFinite(curDate.getTime())
        && (!prevDate || !Number.isFinite(prevDate.getTime()) || !isSameCalendarDay(curDate, prevDate))
      ) {
        height += 32;
      }

      return height;
    },
    [isStoreMode, messageIds, messages],
  );

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => containerRef.current,
    estimateSize,
    overscan,
    measureElement: (element) => element.getBoundingClientRect().height,
    followOnAppend: isAtBottomRef.current,
    getItemKey: (index) => {
      if (isStoreMode) return messageIds?.[index] ?? index;
      return messages?.[index]?.id ?? messages?.[index]?.seq ?? index;
    },
  });

  const virtualItems = virtualizer.getVirtualItems();

  const flushVisibleRange = useCallback(
    (force = false) => {
      visibleRangeRafRef.current = null;
      if (!isStoreMode || !onVisibleRangeChange) return;
      const pending = visibleRangePendingRef.current;
      if (!pending) return;

      const now =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const last = visibleRangeLastSentRef.current;
      const unchanged = pending.start === last.start && pending.end === last.end;
      if (unchanged) {
        visibleRangePendingRef.current = null;
        return;
      }

      if (!force && now - visibleRangeLastAtRef.current < VISIBLE_RANGE_FLUSH_INTERVAL_MS) {
        visibleRangeRafRef.current = requestAnimationFrame(() => flushVisibleRange(false));
        return;
      }

      visibleRangeLastAtRef.current = now;
      visibleRangeLastSentRef.current = pending;
      visibleRangePendingRef.current = null;
      onVisibleRangeChange(pending.start, pending.end);
    },
    [isStoreMode, onVisibleRangeChange],
  );

  useEffect(() => {
    if (!isStoreMode || !onVisibleRangeChange) return;
    const next = virtualItems.length
      ? { start: virtualItems[0].index, end: virtualItems[virtualItems.length - 1].index }
      : { start: -1, end: -1 };
    visibleRangePendingRef.current = next;

    if (visibleRangeRafRef.current !== null) return;
    visibleRangeRafRef.current = requestAnimationFrame(() => flushVisibleRange(false));
  }, [flushVisibleRange, isStoreMode, onVisibleRangeChange, virtualItems]);

  useEffect(
    () => () => {
      if (visibleRangeRafRef.current !== null) {
        cancelAnimationFrame(visibleRangeRafRef.current);
        visibleRangeRafRef.current = null;
      }
      if (!isStoreMode || !onVisibleRangeChange) return;
      visibleRangePendingRef.current = null;
      visibleRangeLastSentRef.current = { start: -1, end: -1 };
      onVisibleRangeChange(-1, -1);
    },
    [isStoreMode, onVisibleRangeChange],
  );

  const cancelPendingScrollToIndex = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    // 清理 virtualizer 内部滞留的滚动目标索引，避免会话切换导致 count 缩减后 verify 回调误报警告
    const v = virtualizer as unknown as { currentScrollToIndex?: number | null };
    if (v && 'currentScrollToIndex' in v) {
      v.currentScrollToIndex = null;
    }
  }, [virtualizer]);

  const safeScrollToIndex = useCallback(
    (
      targetIndex: number,
      options: { align?: 'start' | 'center' | 'end' | 'auto'; behavior?: 'auto' | 'smooth' } = {},
    ) => {
      const currentCount = latestCountRef.current;
      if (currentCount <= 0 || targetIndex < 0 || targetIndex >= currentCount) return;

      cancelPendingScrollToIndex();
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const el = containerRef.current;
        const latestCount = latestCountRef.current;
        if (!el || el.clientHeight <= 0) return;
        if (latestCount <= 0 || targetIndex < 0 || targetIndex >= latestCount) return;

        const measurements = virtualizer.getMeasurements();
        if (!measurements || targetIndex >= measurements.length || !measurements[targetIndex]) {
          return;
        }

        virtualizer.scrollToIndex(targetIndex, options);
      });
    },
    [cancelPendingScrollToIndex, virtualizer],
  );

  useEffect(() => {
    if (count <= 0) {
      cancelPendingScrollToIndex();
      return;
    }
    const v = virtualizer as unknown as { currentScrollToIndex?: number | null };
    if (v && typeof v.currentScrollToIndex === 'number' && v.currentScrollToIndex >= count) {
      v.currentScrollToIndex = null;
    }
  }, [cancelPendingScrollToIndex, count, virtualizer]);

  useEffect(
    () => () => {
      cancelPendingScrollToIndex();
      if (loadMoreAnchorRafRef.current !== null) {
        cancelAnimationFrame(loadMoreAnchorRafRef.current);
        loadMoreAnchorRafRef.current = null;
      }
    },
    [cancelPendingScrollToIndex],
  );

  const resolveReplyTarget = useCallback(
    (replyToId: string): Message | undefined => {
      if (!replyToId) return undefined;
      if (isStoreMode) {
        return useMessageStore.getState().entities.get(replyToId);
      }
      return messages?.find((item) => item.id === replyToId);
    },
    [isStoreMode, messages],
  );

  const handleJumpToMessage = useCallback(
    (targetId: string) => {
      if (!targetId || count <= 0) return;
      const idx = isStoreMode
        ? (messageIds || []).indexOf(targetId)
        : (messages || []).findIndex((item) => item.id === targetId);
      if (idx < 0 || idx >= count) return;

      safeScrollToIndex(idx, { align: 'center', behavior: 'smooth' });
      setFlashMessageId(targetId);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        setFlashMessageId(null);
        flashTimerRef.current = null;
      }, 1600);
    },
    [count, isStoreMode, messageIds, messages, safeScrollToIndex],
  );

  useEffect(() => {
    if (!jumpToMessageRef) return;
    jumpToMessageRef.current = handleJumpToMessage;
    return () => {
      if (jumpToMessageRef.current === handleJumpToMessage) {
        jumpToMessageRef.current = null;
      }
    };
  }, [handleJumpToMessage, jumpToMessageRef]);

  const handleCopyMessage = useCallback((msg: Message) => {
    const text = msg.content?.trim();
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedNotice(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopiedNotice(false);
        copyTimerRef.current = null;
      }, 1500);
    }).catch(() => undefined);
  }, []);

  const handleOpenContextMenu = useCallback((msg: Message, isOut: boolean, x: number, y: number) => {
    if (typeof window === 'undefined') {
      setContextMenu({ message: msg, isOut, x, y });
      return;
    }
    const clampedX = Math.max(12, Math.min(x, window.innerWidth - 180));
    const clampedY = Math.max(12, Math.min(y, window.innerHeight - 220));
    setContextMenu({ message: msg, isOut, x: clampedX, y: clampedY });
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const scrollToBottom = useCallback(() => {
    if (count <= 0) return;
    setUnreadBelowCount(0);
    setShowScrollBottom(false);
    safeScrollToIndex(count - 1, { align: 'end', behavior: 'auto' });
  }, [count, safeScrollToIndex]);

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

    if (idx < 0 || idx >= count) {
      loadMoreAnchorRef.current = null;
      return;
    }

    if (loadMoreAnchorRafRef.current !== null) {
      cancelAnimationFrame(loadMoreAnchorRafRef.current);
    }
    loadMoreAnchorRafRef.current = requestAnimationFrame(() => {
      loadMoreAnchorRafRef.current = null;
      const el = containerRef.current;
      const latestCount = latestCountRef.current;
      if (!el || el.clientHeight <= 0 || latestCount <= 0 || idx < 0 || idx >= latestCount) {
        loadMoreAnchorRef.current = null;
        return;
      }

      const measurements = virtualizer.getMeasurements();
      if (!measurements || idx >= measurements.length || !measurements[idx]) {
        loadMoreAnchorRef.current = null;
        return;
      }

      const offsetInfo = virtualizer.getOffsetForIndex(idx, 'start');
      if (offsetInfo) {
        const [toOffset] = offsetInfo;
        virtualizer.scrollToOffset(toOffset + anchor.offset, { behavior: 'auto' });
      } else {
        virtualizer.scrollToIndex(idx, { align: 'start' });
      }
      loadMoreAnchorRef.current = null;
    });
  }, [count, isStoreMode, listVersion, messageIds, messages, virtualizer]);

  // 仅在已在底部附近时自动滚底，否则统计底部未读新消息数
  useEffect(() => {
    if (disableAutoScroll) return;
    if (!count) {
      prevLastMessageIdRef.current = null;
      setUnreadBelowCount(0);
      setShowScrollBottom(false);
      return;
    }

    const lastId = isStoreMode ? messageIds?.[count - 1] ?? null : messages?.[count - 1]?.id ?? null;
    const prevLastId = prevLastMessageIdRef.current;
    prevLastMessageIdRef.current = lastId;

    if (prevLastId === null) {
      if (!restoredScrollRef.current && chatId) {
        restoredScrollRef.current = true;
        const saved = readChatScrollState(chatId);
        if (saved && !saved.wasAtBottom && saved.scrollTop > 0) {
          isAtBottomRef.current = false;
          setShowScrollBottom(true);
          requestAnimationFrame(() => {
            if (containerRef.current) {
              containerRef.current.scrollTop = saved.scrollTop;
            }
          });
          return;
        }
      }
      scrollToBottom();
      return;
    }

    if (lastId && lastId !== prevLastId) {
      if (isAtBottomRef.current) {
        scrollToBottom();
      } else {
        setUnreadBelowCount((prev) => prev + 1);
        setShowScrollBottom(true);
      }
    }
  }, [count, listVersion, isStoreMode, messageIds, messages, disableAutoScroll, scrollToBottom]);

  // Scroll to highlighted message (search context mode only).
  useEffect(() => {
    if (typeof highlightSeq !== 'number') return;
    if (isStoreMode) return;
    const idx = (messages || []).findIndex((m) => m.seq === highlightSeq);
    if (idx < 0 || idx >= count) return;
    safeScrollToIndex(idx, { align: 'center', behavior: 'auto' });
  }, [count, highlightSeq, isStoreMode, messages, safeScrollToIndex]);

  const processScroll = useCallback(
    (scrollTop: number) => {
      const el = containerRef.current;
      if (!el) return;

      const now =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const prevTs = lastScrollTsRef.current || now;
      const dt = Math.max(1, now - prevTs);
      const dy = Math.abs(scrollTop - lastScrollTopRef.current);
      const velocity = dy / dt;
      lastScrollTopRef.current = scrollTop;
      lastScrollTsRef.current = now;

      let targetOverscan = OVERSCAN_IDLE;
      if (velocity > 2.0) targetOverscan = OVERSCAN_FAST;
      else if (velocity > 1.0) targetOverscan = OVERSCAN_MEDIUM;

      if (
        targetOverscan !== overscanRef.current &&
        now - overscanLastSetAtRef.current > OVERSCAN_UPDATE_INTERVAL_MS
      ) {
        overscanRef.current = targetOverscan;
        overscanLastSetAtRef.current = now;
        setOverscan(targetOverscan);
      }

      const { scrollHeight, clientHeight } = el;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      // 底部距离判定：接近底部时允许自动滚底并清零悬浮未读角标
      const isNearBottom = distanceFromBottom < 120;
      isAtBottomRef.current = isNearBottom;
      if (chatId && !disableAutoScroll) {
        saveChatScrollState(chatId, { scrollTop, wasAtBottom: isNearBottom });
      }
      if (distanceFromBottom > 220) {
        setShowScrollBottom(true);
      } else if (distanceFromBottom < 140) {
        setShowScrollBottom(false);
        setUnreadBelowCount(0);
      }

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
    },
    [chatId, disableAutoScroll, hasMore, isLoading, onLoadMore, virtualizer, isStoreMode, messageIds, messages],
  );

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    pendingScrollTopRef.current = el.scrollTop;

    if (rafScrollRef.current !== null) return;
    rafScrollRef.current = requestAnimationFrame(() => {
      rafScrollRef.current = null;
      const nextScrollTop = pendingScrollTopRef.current;
      pendingScrollTopRef.current = null;
      if (nextScrollTop === null) return;
      processScroll(nextScrollTop);
    });
  }, [processScroll]);

  useEffect(
    () => () => {
      if (rafScrollRef.current !== null) {
        cancelAnimationFrame(rafScrollRef.current);
        rafScrollRef.current = null;
      }
    },
    [],
  );

  const normalizedErrorMessage = typeof errorMessage === 'string' ? errorMessage.trim() : '';
  const emptyStateKind: EmptyStateKind | null =
    count > 0
      ? null
      : normalizedErrorMessage
        ? 'error'
        : isLoading || hasHistoryHint
          ? 'loading'
          : 'empty';
  const isEmpty = emptyStateKind !== null;
  const showLoadingOverlay = isLoading && count > 0;
  const emptyStateCopy = (() => {
    if (emptyStateKind === 'error') {
      return {
        title: '消息加载失败',
        description: normalizedErrorMessage || '请稍后重试',
      };
    }
    if (emptyStateKind === 'loading') {
      return {
        title: '正在同步消息...',
        description: '正在从服务器获取该会话的历史记录',
      };
    }
    return {
      title: '还没有消息',
      description: '发送第一条消息开始对话',
    };
  })();

  return (
    <div className="chat-history__viewport">
      <div
        ref={containerRef}
        className={`chat-history ${isEmpty ? 'chat-history--empty' : ''}`}
        onScroll={handleScroll}
      >
        {showLoadingOverlay && <div className="chat-history__loading chat-history__loading--overlay">加载中...</div>}

        {isEmpty ? (
          <div
            className={`chat-history__empty-state chat-history__empty-state--${emptyStateKind}`}
            role={emptyStateKind === 'error' ? 'alert' : 'status'}
          >
            <div className="chat-history__empty-title">{emptyStateCopy.title}</div>
            <div className="chat-history__empty-description">{emptyStateCopy.description}</div>
            {emptyStateKind === 'error' && onRetryLoad && (
              <button
                type="button"
                className="chat-history__empty-retry"
                onClick={onRetryLoad}
              >
                重新加载
              </button>
            )}
          </div>
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
                const prevId = virtualRow.index > 0 ? messageIds?.[virtualRow.index - 1] ?? null : null;
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
                    {firstUnreadMessageId === id && (
                      <div className="chat-history__unread-divider" role="separator" aria-label="以下为新消息">
                        <span>以下为新消息</span>
                      </div>
                    )}
                    <StoreMessageBubble
                      messageId={id}
                      prevMessageId={prevId}
                      currentUserId={currentUserId}
                      currentUsername={currentUsername}
                      highlightConfig={highlightConfig}
                      highlightSeq={highlightSeq}
                      isFlashed={flashMessageId === id}
                      showGroupSenderMeta={isGroupChatMode}
                      resolveSenderMeta={resolveSenderMeta}
                      resolveReplyTarget={resolveReplyTarget}
                      onJumpToMessage={handleJumpToMessage}
                      onPreviewImage={setLightboxMedia}
                      onCopyMessage={handleCopyMessage}
                      onReplyMessage={onReplyMessage}
                      onRetryMessage={onRetryMessage}
                      onToggleReaction={onToggleReaction}
                      onOpenContextMenu={handleOpenContextMenu}
                      enableActions={enableActions}
                      selectionMode={selectionMode}
                      isSelected={Boolean(selectedMessageIds?.has(id))}
                      onToggleSelect={onToggleSelectMessage}
                    />
                  </div>
                );
              }

              const msg = messages?.[virtualRow.index];
              if (!msg) return null;
              const prevMsg = virtualRow.index > 0 ? messages?.[virtualRow.index - 1] ?? null : null;

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
                  {firstUnreadMessageId === msg.id && (
                    <div className="chat-history__unread-divider" role="separator" aria-label="以下为新消息">
                      <span>以下为新消息</span>
                    </div>
                  )}
                  <MessageBubbleRow
                    message={msg}
                    previousMessage={prevMsg}
                    currentUserId={currentUserId}
                    currentUsername={currentUsername}
                    highlightConfig={highlightConfig}
                    highlightSeq={highlightSeq}
                    isFlashed={flashMessageId === msg.id}
                    showGroupSenderMeta={isGroupChatMode}
                    resolveSenderMeta={resolveSenderMeta}
                    resolveReplyTarget={resolveReplyTarget}
                    onJumpToMessage={handleJumpToMessage}
                    onPreviewImage={setLightboxMedia}
                    onCopyMessage={handleCopyMessage}
                    onReplyMessage={onReplyMessage}
                    onRetryMessage={onRetryMessage}
                    onToggleReaction={onToggleReaction}
                    onOpenContextMenu={handleOpenContextMenu}
                    enableActions={enableActions}
                    selectionMode={selectionMode}
                    isSelected={Boolean(selectedMessageIds?.has(msg.id))}
                    onToggleSelect={onToggleSelectMessage}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!isEmpty && firstUnreadMessageId && showScrollBottom && (
        <button
          type="button"
          className="chat-history__unread-jump"
          onClick={() => handleJumpToMessage(firstUnreadMessageId)}
          aria-label="跳转到未读消息起点"
        >
          <ArrowUp size={14} />
          <span>跳转到未读起点</span>
        </button>
      )}

      {!isEmpty && (showScrollBottom || unreadBelowCount > 0) && (
        <button
          type="button"
          className={`chat-history__scroll-bottom ${unreadBelowCount > 0 ? 'has-unread' : ''}`}
          onClick={scrollToBottom}
          aria-label={unreadBelowCount > 0 ? `查看底部 ${unreadBelowCount} 条新消息` : '回到底部'}
        >
          <ArrowDown size={15} />
          <span>{unreadBelowCount > 0 ? `${unreadBelowCount} 条新消息` : '回到底部'}</span>
          {unreadBelowCount > 0 && (
            <span className="chat-history__scroll-bottom-badge" aria-hidden="true">
              {unreadBelowCount > 99 ? '99+' : unreadBelowCount}
            </span>
          )}
        </button>
      )}

      {copiedNotice && (
        <div className="chat-history__loading chat-history__loading--overlay" role="status">
          已复制消息文字
        </div>
      )}

      <ChatImageLightbox
        src={lightboxMedia?.src ?? null}
        fileName={lightboxMedia?.fileName}
        items={lightboxMedia ? galleryImages : undefined}
        initialIndex={lightboxInitialIndex}
        onClose={() => setLightboxMedia(null)}
      />

      {contextMenu && (
        <MessageActionMenu
          message={contextMenu.message}
          isOut={contextMenu.isOut}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCopy={handleCopyMessage}
          onReply={(target) => onReplyMessage?.(target)}
          onForward={onForwardMessage ? (target) => onForwardMessage(target) : undefined}
          onMultiSelect={onEnterMultiSelect ? (target) => onEnterMultiSelect(target) : undefined}
          onPin={onPinMessage ? (target) => onPinMessage(target) : undefined}
          onAskAi={onAskAiMessage ? (target) => onAskAiMessage(target) : undefined}
          onEdit={(target) => onEditMessage?.(target)}
          onDelete={(target) => onDeleteMessage?.(target)}
          onRetry={(target) => onRetryMessage?.(target)}
        />
      )}
    </div>
  );
};

export default ChatHistory;
