import { create } from 'zustand';
import { messageAPI } from '../../../services/apiClient';
import { messageCache } from '../../../services/db';
import type { Message } from '../../../types/chat';

interface MessageState {
    // 消息列表
    messages: Message[];
    // 当前选中的联系人ID（用于加载消息）
    activeContactId: string | null;
    // 分页状态
    currentPage: number;
    hasMore: boolean;
    nextBeforeSeq: number | null;
    // 加载状态
    isLoading: boolean;
    error: string | null;
    isGroupChat: boolean;

    // Actions
    setActiveContact: (contactId: string | null, isGroup?: boolean) => void;
    loadMessagesWithCache: (contactId: string, isGroup: boolean) => Promise<void>;
    loadMessages: (contactId: string) => Promise<void>;
    loadMoreMessages: () => Promise<void>;
    addMessage: (message: Message) => void;
    updateMessageStatus: (messageId: string, status: Message['status']) => void;
    applyReadReceipt: (chatId: string, seq: number, readCount: number, currentUserId: string) => void;
    clearMessages: () => void;
}

export const useMessageStore = create<MessageState>((set, get) => ({
    messages: [],
    activeContactId: null,
    currentPage: 1,
    hasMore: true,
    nextBeforeSeq: null,
    isLoading: false,
    error: null,
    isGroupChat: false,

    // 设置当前活跃的聊天（联系人或群组），并自动加载消息
    setActiveContact: (contactId, isGroup = false) => {
        const { activeContactId, isGroupChat } = get();
        if (activeContactId === contactId && isGroupChat === isGroup) return; // 避免重复加载

        set({
            activeContactId: contactId,
            isGroupChat: isGroup,
            messages: [],
            currentPage: 1,
            hasMore: true,
            nextBeforeSeq: null,
            error: null,
        });

        if (contactId) {
            // P3: 先从 IndexedDB 加载缓存，再加载 API
            get().loadMessagesWithCache(contactId, isGroup);
        }
    },

    // P3: 从缓存加载消息（瞄间显示）
    loadMessagesWithCache: async (contactId: string, isGroup: boolean) => {
        const chatId = isGroup ? `g:${contactId}` : contactId;

        try {
            // 1. 立即从 IndexedDB 加载缓存消息
            const cached = await messageCache.getMessages(chatId, 50);
            if (cached.length > 0) {
                set({ messages: cached, isLoading: true });
                console.log(`[P3] 从缓存加载 ${cached.length} 条消息`);
            } else {
                set({ isLoading: true });
            }

            // 2. 请求 API 获取最新消息
            await get().loadMessages(contactId);
        } catch (err) {
            console.error('[P3] 缓存加载失败:', err);
            // 缓存失败不影响正常加载
            await get().loadMessages(contactId);
        }
    },

    // 加载消息（首次）
    loadMessages: async (contactId) => {
        set({ isLoading: true, error: null });
        const { isGroupChat } = get();
        try {
            if (isGroupChat) {
                const response = await messageAPI.getGroupMessages(contactId, undefined, 50);
                const messages: Message[] = response.messages.map((msg: any) => ({
                    id: msg.id,
                    chatId: msg.chatId,
                    chatType: msg.chatType,
                    seq: msg.seq,
                    content: msg.content,
                    senderId: msg.senderId,
                    senderUsername: msg.senderUsername,
                    userId: msg.senderId,
                    username: msg.senderUsername,
                    receiverId: msg.receiverId,
                    groupId: msg.groupId,
                    timestamp: msg.timestamp,
                    type: msg.type || 'text',
                    status: msg.status,
                    isGroupChat: msg.chatType === 'group',
                    fileUrl: msg.fileUrl,
                    fileName: msg.fileName,
                    attachments: msg.attachments,
                }));

                set({
                    messages,
                    hasMore: response.paging.hasMore,
                    currentPage: 1,
                    nextBeforeSeq: response.paging.nextBeforeSeq ?? null,
                    isLoading: false,
                });

                // P3: 异步缓存到 IndexedDB
                messageCache.saveMessages(messages).catch((err) => {
                    console.error('[P3] 批量缓存失败:', err);
                });
            } else {
                const response = await messageAPI.getConversation(contactId, 1, 50);
                const messages: Message[] = response.messages.map((msg: any) => ({
                    id: msg.id,
                    chatId: msg.chatId,
                    chatType: msg.chatType,
                    seq: msg.seq,
                    content: msg.content,
                    senderId: msg.senderId,
                    senderUsername: msg.senderUsername,
                    userId: msg.senderId,
                    username: msg.senderUsername,
                    receiverId: msg.receiverId,
                    groupId: msg.groupId,
                    timestamp: msg.timestamp,
                    type: msg.type || 'text',
                    status: msg.status,
                    isGroupChat: msg.chatType === 'group',
                    fileUrl: msg.fileUrl,
                    fileName: msg.fileName,
                    attachments: msg.attachments,
                }));

                set({
                    messages,
                    hasMore: response.pagination.hasMore,
                    currentPage: response.pagination.currentPage,
                    nextBeforeSeq: null,
                    isLoading: false,
                });

                // P3: 异步缓存到 IndexedDB
                messageCache.saveMessages(messages).catch((err) => {
                    console.error('[P3] 批量缓存失败:', err);
                });
            }
        } catch (error: any) {
            console.error('加载消息失败:', error);
            set({ error: error.message, isLoading: false });
        }
    },

    // 加载更多历史消息
    loadMoreMessages: async () => {
        const { activeContactId, currentPage, hasMore, isLoading, isGroupChat, nextBeforeSeq } = get();
        if (!activeContactId || isLoading || !hasMore) return;

        set({ isLoading: true });
        try {
            const nextPage = currentPage + 1;
            if (isGroupChat) {
                const response = await messageAPI.getGroupMessages(activeContactId, nextBeforeSeq ?? undefined, 50);
                const newMessages: Message[] = response.messages.map((msg: any) => ({
                    id: msg.id,
                    chatId: msg.chatId,
                    chatType: msg.chatType,
                    seq: msg.seq,
                    content: msg.content,
                    senderId: msg.senderId,
                    senderUsername: msg.senderUsername,
                    userId: msg.senderId,
                    username: msg.senderUsername,
                    receiverId: msg.receiverId,
                    groupId: msg.groupId,
                    timestamp: msg.timestamp,
                    type: msg.type || 'text',
                    status: msg.status,
                    isGroupChat: msg.chatType === 'group',
                    fileUrl: msg.fileUrl,
                    fileName: msg.fileName,
                    attachments: msg.attachments,
                }));

                set((state) => ({
                    messages: [...newMessages, ...state.messages],
                    hasMore: response.paging.hasMore,
                    currentPage: state.currentPage,
                    nextBeforeSeq: response.paging.nextBeforeSeq ?? state.nextBeforeSeq,
                    isLoading: false,
                }));
            } else {
                const response = await messageAPI.getConversation(activeContactId, nextPage, 50);
                const newMessages: Message[] = response.messages.map((msg: any) => ({
                    id: msg.id,
                    chatId: msg.chatId,
                    chatType: msg.chatType,
                    seq: msg.seq,
                    content: msg.content,
                    senderId: msg.senderId,
                    senderUsername: msg.senderUsername,
                    userId: msg.senderId,
                    username: msg.senderUsername,
                    receiverId: msg.receiverId,
                    groupId: msg.groupId,
                    timestamp: msg.timestamp,
                    type: msg.type || 'text',
                    status: msg.status,
                    isGroupChat: msg.chatType === 'group',
                    fileUrl: msg.fileUrl,
                    fileName: msg.fileName,
                    attachments: msg.attachments,
                }));

                set((state) => ({
                    messages: [...newMessages, ...state.messages],
                    hasMore: response.pagination.hasMore,
                    currentPage: response.pagination.currentPage,
                    nextBeforeSeq: null,
                    isLoading: false,
                }));
            }
        } catch (error: any) {
            console.error('加载更多消息失败:', error);
            set({ error: error.message, isLoading: false });
        }
    },

    // 添加新消息（实时接收或发送后）
    addMessage: (message) => {
        const { activeContactId, isGroupChat } = get();
        if (!activeContactId) {
            const isAiMessage = message.receiverId === 'ai' || message.senderId === 'ai';
            if (!isAiMessage) return;
        }

        const matches = !activeContactId
            ? true
            : isGroupChat
                ? (message.groupId === activeContactId || message.chatId === `g:${activeContactId}`)
                : (message.senderId === activeContactId || message.receiverId === activeContactId);

        if (!matches) return;

        set((state) => {
            if (state.messages.find((m) => m.id === message.id)) return state;
            return { messages: [...state.messages, message] };
        });

        // P3: 异步写入 IndexedDB
        messageCache.saveMessage(message).catch((err) => {
            console.error('[P3] 消息缓存失败:', err);
        });
    },

    // 更新消息状态（如已读、已发送）
    updateMessageStatus: (messageId, status) => {
        set((state) => ({
            messages: state.messages.map((msg) =>
                msg.id === messageId ? { ...msg, status } : msg
            ),
        }));
    },

    // 应用已读回执（用于私聊已读 & 群聊已读人数）
    applyReadReceipt: (chatId, seq, readCount, currentUserId) => {
        set((state) => ({
            messages: state.messages.map((msg) => {
                const msgChatId = msg.chatId || (msg.groupId ? `g:${msg.groupId}` : undefined);
                if (!msgChatId || msgChatId !== chatId) return msg;
                if (!msg.seq || msg.seq > seq) return msg;
                if (msg.senderId !== currentUserId) return msg;
                return { ...msg, status: 'read', readCount: msg.isGroupChat ? readCount : msg.readCount };
            }),
        }));
    },

    // 清空消息（切换联系人时）
    clearMessages: () => {
        set({
            messages: [],
            currentPage: 1,
            hasMore: true,
            error: null,
            activeContactId: null,
            isGroupChat: false,
            nextBeforeSeq: null
        });
    },
}));

// Selectors
export const selectMessages = (state: MessageState) => state.messages;
export const selectIsLoadingMessages = (state: MessageState) => state.isLoading;
export const selectHasMoreMessages = (state: MessageState) => state.hasMore;
export const selectActiveContactId = (state: MessageState) => state.activeContactId;
