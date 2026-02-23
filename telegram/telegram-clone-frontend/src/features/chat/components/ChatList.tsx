import React, { useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatSummary } from '../types';
import ChatListItem from './ChatListItem';
import { useMessageStore } from '../store/messageStore';

const PREFETCH_NEARBY_RADIUS = 3;
const PREFETCH_COOLDOWN_MS = 20_000;
const PREFETCH_BATCH_SIZE = 6;
const PREFETCH_HEAD_IMMEDIATE_COUNT = 8;
const CHAT_ROW_HEIGHT = 92;
const CHAT_ROW_PADDING_Y = 6;
const CHAT_ROW_PADDING_X = 10;

function scheduleIdleTask(cb: () => void): number | null {
    if (typeof globalThis.window === 'undefined') return null;
    const win = globalThis.window as any;
    if (typeof win.requestIdleCallback === 'function') {
        return win.requestIdleCallback(cb, { timeout: 120 }) as number;
    }
    return globalThis.setTimeout(cb, 48) as unknown as number;
}

function cancelIdleTask(handle: number | null) {
    if (handle === null || typeof globalThis.window === 'undefined') return;
    const win = globalThis.window as any;
    if (typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(handle);
        return;
    }
    globalThis.clearTimeout(handle);
}

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
    const prefetchChats = useMessageStore((state) => state.prefetchChats);
    const animatedChatIdsRef = useRef<Set<string>>(new Set());
    const prefetchQueueRef = useRef<Map<string, { targetId: string; isGroup?: boolean }>>(new Map());
    const prefetchMarkRef = useRef<Map<string, number>>(new Map());
    const idleHandleRef = useRef<number | null>(null);
    const immediatePrefetchFingerprintRef = useRef<string>('');

    const rowVirtualizer = useVirtualizer({
        count: chats.length,
        getScrollElement: () => parentRef.current,
        // Keep virtual row height aligned with real rendered item box model.
        estimateSize: () => CHAT_ROW_HEIGHT,
        overscan: 5,
    });
    const virtualItems = rowVirtualizer.getVirtualItems();

    const flushPrefetchQueue = useCallback(() => {
        idleHandleRef.current = null;
        if (!prefetchQueueRef.current.size) return;

        const entries = Array.from(prefetchQueueRef.current.entries()).slice(0, PREFETCH_BATCH_SIZE);
        if (!entries.length) return;

        for (const [key] of entries) {
            prefetchQueueRef.current.delete(key);
        }

        prefetchChats(entries.map(([, item]) => item));

        if (prefetchQueueRef.current.size) {
            idleHandleRef.current = scheduleIdleTask(flushPrefetchQueue);
        }
    }, [prefetchChats]);

    const schedulePrefetchFlush = useCallback(() => {
        if (idleHandleRef.current !== null) return;
        idleHandleRef.current = scheduleIdleTask(flushPrefetchQueue);
    }, [flushPrefetchQueue]);

    useEffect(() => {
        if (!virtualItems.length || !chats.length) return;

        const now = Date.now();
        for (const row of virtualItems) {
            const start = Math.max(0, row.index - PREFETCH_NEARBY_RADIUS);
            const end = Math.min(chats.length - 1, row.index + PREFETCH_NEARBY_RADIUS);

            for (let idx = start; idx <= end; idx += 1) {
                const chat = chats[idx];
                if (!chat) continue;

                const key = `${chat.id}:${chat.isGroup ? 'g' : 'p'}`;
                const last = prefetchMarkRef.current.get(key) || 0;
                if (now - last < PREFETCH_COOLDOWN_MS) continue;

                prefetchMarkRef.current.set(key, now);
                prefetchQueueRef.current.set(key, { targetId: chat.id, isGroup: !!chat.isGroup });
            }
        }

        schedulePrefetchFlush();
    }, [chats, virtualItems, schedulePrefetchFlush]);

    useEffect(() => {
        if (!chats.length) return;
        const head = chats.slice(0, PREFETCH_HEAD_IMMEDIATE_COUNT);
        if (!head.length) return;

        const fingerprint = head.map((chat) => `${chat.id}:${chat.isGroup ? 'g' : 'p'}`).join('|');
        if (!fingerprint || immediatePrefetchFingerprintRef.current === fingerprint) return;
        immediatePrefetchFingerprintRef.current = fingerprint;

        prefetchChats(
            head.map((chat) => ({
                targetId: chat.id,
                isGroup: !!chat.isGroup,
            })),
        );
    }, [chats, prefetchChats]);

    useEffect(
        () => () => {
            cancelIdleTask(idleHandleRef.current);
            idleHandleRef.current = null;
        },
        [],
    );

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
                {virtualItems.map((virtualRow) => {
                    const chat = chats[virtualRow.index];
                    if (!chat) return null;

                    const shouldAnimate = virtualRow.index < 12 && !animatedChatIdsRef.current.has(chat.id);
                    if (shouldAnimate) {
                        animatedChatIdsRef.current.add(chat.id);
                    }

                    const rowStyle: React.CSSProperties = {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                        padding: `${CHAT_ROW_PADDING_Y}px ${CHAT_ROW_PADDING_X}px`,
                        boxSizing: 'border-box',
                    };

                    if (!shouldAnimate) {
                        return (
                            <div key={virtualRow.key} style={rowStyle}>
                                <ChatListItem
                                    chat={chat}
                                    isSelected={selectedChatId === chat.id}
                                    onClick={onSelectChat}
                                />
                            </div>
                        );
                    }

                    return (
                        <motion.div
                            key={virtualRow.key}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                                duration: 0.18,
                                ease: 'easeOut',
                                delay: virtualRow.index < 15 ? virtualRow.index * 0.03 : 0
                            }}
                            style={rowStyle}
                        >
                            <ChatListItem
                                chat={chat}
                                isSelected={selectedChatId === chat.id}
                                onClick={onSelectChat}
                            />
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
};

export default React.memo(ChatList);
