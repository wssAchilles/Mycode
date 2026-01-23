import { create } from 'zustand';
import { messageAPI } from '../../../services/apiClient';
import type { Message } from '../../../types/chat';

interface MessageState {
    // 消息列表
    messages: Message[];
    // 当前选中的联系人ID（用于加载消息）
    activeContactId: string | null;
    // 分页状态
    currentPage: number;
    hasMore: boolean;
    // 加载状态
    isLoading: boolean;
    error: string | null;
    isGroupChat: boolean;

    // Actions
    setActiveContact: (contactId: string | null, isGroup?: boolean) => void;
    loadMessages: (contactId: string) => Promise<void>;
    loadMoreMessages: () => Promise<void>;
    addMessage: (message: Message) => void;
    updateMessageStatus: (messageId: string, status: Message['status']) => void;
    clearMessages: () => void;
}

export const useMessageStore = create<MessageState>((set, get) => ({
    messages: [],
    activeContactId: null,
    currentPage: 1,
    hasMore: true,
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
            error: null,
        });

        if (contactId) {
            get().loadMessages(contactId);
        }
    },

    // 加载消息（首次）
    loadMessages: async (contactId) => {
        set({ isLoading: true, error: null });
        const { isGroupChat } = get();
        try {
            const response = isGroupChat
                ? await messageAPI.getGroupMessages(contactId, 1, 50)
                : await messageAPI.getConversation(contactId, 1, 50);

            const messages: Message[] = response.messages.map((msg: any) => ({
                id: msg.id,
                content: msg.content,
                senderId: msg.senderId,
                senderUsername: msg.senderUsername,
                userId: msg.senderId,
                username: msg.senderUsername,
                timestamp: msg.timestamp,
                type: msg.type || 'text',
                status: msg.status,
                isGroupChat: isGroupChat,
                fileUrl: msg.fileUrl,
                fileName: msg.fileName,
            }));

            set({
                messages: messages.reverse(), // 最新消息在底部
                hasMore: response.pagination.hasMore,
                currentPage: response.pagination.currentPage,
                isLoading: false,
            });
        } catch (error: any) {
            console.error('加载消息失败:', error);
            set({ error: error.message, isLoading: false });
        }
    },

    // 加载更多历史消息
    loadMoreMessages: async () => {
        const { activeContactId, currentPage, hasMore, isLoading, isGroupChat } = get();
        if (!activeContactId || isLoading || !hasMore) return;

        set({ isLoading: true });
        try {
            const nextPage = currentPage + 1;
            const response = isGroupChat
                ? await messageAPI.getGroupMessages(activeContactId, nextPage, 50)
                : await messageAPI.getConversation(activeContactId, nextPage, 50);

            const newMessages: Message[] = response.messages.map((msg: any) => ({
                id: msg.id,
                content: msg.content,
                senderId: msg.senderId,
                senderUsername: msg.senderUsername,
                userId: msg.senderId,
                username: msg.senderUsername,
                timestamp: msg.timestamp,
                type: msg.type || 'text',
                status: msg.status,
                isGroupChat: isGroupChat,
                fileUrl: msg.fileUrl,
                fileName: msg.fileName,
            }));

            set((state) => ({
                messages: [...newMessages.reverse(), ...state.messages], // 历史消息在顶部
                hasMore: response.pagination.hasMore,
                currentPage: response.pagination.currentPage,
                isLoading: false,
            }));
        } catch (error: any) {
            console.error('加载更多消息失败:', error);
            set({ error: error.message, isLoading: false });
        }
    },

    // 添加新消息（实时接收或发送后）
    addMessage: (message) => {
        set((state) => ({
            messages: [...state.messages, message],
        }));
    },

    // 更新消息状态（如已读、已发送）
    updateMessageStatus: (messageId, status) => {
        set((state) => ({
            messages: state.messages.map((msg) =>
                msg.id === messageId ? { ...msg, status } : msg
            ),
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
            isGroupChat: false
        });
    },
}));

// Selectors
export const selectMessages = (state: MessageState) => state.messages;
export const selectIsLoadingMessages = (state: MessageState) => state.isLoading;
export const selectHasMoreMessages = (state: MessageState) => state.hasMore;
export const selectActiveContactId = (state: MessageState) => state.activeContactId;
