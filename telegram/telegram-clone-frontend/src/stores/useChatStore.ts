/**
 * 聊天状态管理 Store
 * 管理联系人、消息、会话等核心聊天数据
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Contact, Message, PendingRequest } from '../types/store';

interface ChatState {
    // 联系人
    contacts: Contact[];
    selectedContact: Contact | null;
    isLoadingContacts: boolean;

    // 待处理请求
    pendingRequests: PendingRequest[];
    isLoadingPendingRequests: boolean;

    // 消息
    messages: Message[];
    isLoadingMessages: boolean;
    hasMoreMessages: boolean;
    currentPage: number;

    // 视图状态
    isAiChatMode: boolean;
    showAddContactModal: boolean;
    showEmojiPicker: boolean;

    // 错误
    error: string | null;

    // 联系人操作
    setContacts: (contacts: Contact[]) => void;
    addContact: (contact: Contact) => void;
    removeContact: (contactId: string) => void;
    selectContact: (contact: Contact | null) => void;
    updateContactOnlineStatus: (userId: string, isOnline: boolean, lastSeen?: string) => void;
    updateContactLastMessage: (userId: string, message: Message) => void;
    incrementUnreadCount: (userId: string) => void;
    resetUnreadCount: (userId: string) => void;

    // 待处理请求操作
    setPendingRequests: (requests: PendingRequest[]) => void;
    removePendingRequest: (requestId: string) => void;

    // 消息操作
    setMessages: (messages: Message[]) => void;
    addMessage: (message: Message) => void;
    prependMessages: (messages: Message[]) => void;
    updateMessage: (messageId: string, updates: Partial<Message>) => void;
    deleteMessage: (messageId: string) => void;
    clearMessages: () => void;

    // 视图操作
    setAiChatMode: (enabled: boolean) => void;
    setShowAddContactModal: (show: boolean) => void;
    setShowEmojiPicker: (show: boolean) => void;

    // 加载状态
    setLoadingContacts: (loading: boolean) => void;
    setLoadingPendingRequests: (loading: boolean) => void;
    setLoadingMessages: (loading: boolean) => void;
    setHasMoreMessages: (hasMore: boolean) => void;
    setCurrentPage: (page: number) => void;
    setError: (error: string | null) => void;
}

export const useChatStore = create<ChatState>()(
    immer((set) => ({
        // 初始状态
        contacts: [],
        selectedContact: null,
        isLoadingContacts: false,

        pendingRequests: [],
        isLoadingPendingRequests: false,

        messages: [],
        isLoadingMessages: false,
        hasMoreMessages: true,
        currentPage: 1,

        isAiChatMode: false,
        showAddContactModal: false,
        showEmojiPicker: false,

        error: null,

        // === 联系人操作 ===
        setContacts: (contacts) =>
            set((state) => {
                state.contacts = contacts;
            }),

        addContact: (contact) =>
            set((state) => {
                // 避免重复添加
                const exists = state.contacts.some((c) => c.id === contact.id);
                if (!exists) {
                    state.contacts.unshift(contact);
                }
            }),

        removeContact: (contactId) =>
            set((state) => {
                state.contacts = state.contacts.filter((c) => c.id !== contactId);
                if (state.selectedContact?.id === contactId) {
                    state.selectedContact = null;
                }
            }),

        selectContact: (contact) =>
            set((state) => {
                state.selectedContact = contact;
                state.messages = [];
                state.currentPage = 1;
                state.hasMoreMessages = true;
                if (contact) {
                    state.isAiChatMode = false;
                    // 重置未读计数
                    const idx = state.contacts.findIndex((c) => c.id === contact.id);
                    if (idx !== -1) {
                        state.contacts[idx].unreadCount = 0;
                    }
                }
            }),

        updateContactOnlineStatus: (userId, isOnline, lastSeen) =>
            set((state) => {
                const idx = state.contacts.findIndex((c) => c.id === userId || (c as any).userId === userId);
                if (idx !== -1) {
                    state.contacts[idx].isOnline = isOnline;
                    if (lastSeen) {
                        state.contacts[idx].lastSeen = lastSeen;
                    }
                }
            }),

        updateContactLastMessage: (userId, message) =>
            set((state) => {
                const idx = state.contacts.findIndex((c) => c.id === userId || (c as any).userId === userId);
                if (idx !== -1) {
                    state.contacts[idx].lastMessage = message;
                }
            }),

        incrementUnreadCount: (userId) =>
            set((state) => {
                const idx = state.contacts.findIndex((c) => c.id === userId || (c as any).userId === userId);
                if (idx !== -1) {
                    state.contacts[idx].unreadCount += 1;
                }
            }),

        resetUnreadCount: (userId) =>
            set((state) => {
                const idx = state.contacts.findIndex((c) => c.id === userId || (c as any).userId === userId);
                if (idx !== -1) {
                    state.contacts[idx].unreadCount = 0;
                }
            }),

        // === 待处理请求操作 ===
        setPendingRequests: (requests) =>
            set((state) => {
                state.pendingRequests = requests;
            }),

        removePendingRequest: (requestId) =>
            set((state) => {
                state.pendingRequests = state.pendingRequests.filter((r) => r.id !== requestId);
            }),

        // === 消息操作 ===
        setMessages: (messages) =>
            set((state) => {
                state.messages = messages;
            }),

        addMessage: (message) =>
            set((state) => {
                // 避免重复消息
                const exists = state.messages.some((m) => m.id === message.id);
                if (!exists) {
                    state.messages.push(message);
                }
            }),

        prependMessages: (messages) =>
            set((state) => {
                // 过滤掉已存在的消息
                const existingIds = new Set(state.messages.map((m) => m.id));
                const newMessages = messages.filter((m) => !existingIds.has(m.id));
                state.messages = [...newMessages, ...state.messages];
            }),

        updateMessage: (messageId, updates) =>
            set((state) => {
                const idx = state.messages.findIndex((m) => m.id === messageId);
                if (idx !== -1) {
                    state.messages[idx] = { ...state.messages[idx], ...updates };
                }
            }),

        deleteMessage: (messageId) =>
            set((state) => {
                state.messages = state.messages.filter((m) => m.id !== messageId);
            }),

        clearMessages: () =>
            set((state) => {
                state.messages = [];
                state.currentPage = 1;
                state.hasMoreMessages = true;
            }),

        // === 视图操作 ===
        setAiChatMode: (enabled) =>
            set((state) => {
                state.isAiChatMode = enabled;
                if (enabled) {
                    state.selectedContact = null;
                    state.messages = [];
                }
            }),

        setShowAddContactModal: (show) =>
            set((state) => {
                state.showAddContactModal = show;
            }),

        setShowEmojiPicker: (show) =>
            set((state) => {
                state.showEmojiPicker = show;
            }),

        // === 加载状态 ===
        setLoadingContacts: (loading) =>
            set((state) => {
                state.isLoadingContacts = loading;
            }),

        setLoadingPendingRequests: (loading) =>
            set((state) => {
                state.isLoadingPendingRequests = loading;
            }),

        setLoadingMessages: (loading) =>
            set((state) => {
                state.isLoadingMessages = loading;
            }),

        setHasMoreMessages: (hasMore) =>
            set((state) => {
                state.hasMoreMessages = hasMore;
            }),

        setCurrentPage: (page) =>
            set((state) => {
                state.currentPage = page;
            }),

        setError: (error) =>
            set((state) => {
                state.error = error;
            }),
    }))
);

// 选择器
export const selectContacts = (state: ChatState) => state.contacts;
export const selectSelectedContact = (state: ChatState) => state.selectedContact;
export const selectMessages = (state: ChatState) => state.messages;
export const selectIsAiChatMode = (state: ChatState) => state.isAiChatMode;
