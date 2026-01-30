/**
 * AI 聊天 Store - 管理 AI 会话状态
 */

import { create } from 'zustand';
import { aiChatAPI, type AiConversation } from '../../../services/aiChatAPI';

interface AiChatState {
    // 会话列表
    conversations: AiConversation[];
    // 当前活动会话 ID
    activeConversationId: string | null;
    // 当前会话消息
    currentMessages: AiConversation['messages'];
    // 加载状态
    isLoadingConversations: boolean;
    isLoadingMessages: boolean;

    // Actions
    loadConversations: () => Promise<void>;
    selectConversation: (conversationId: string) => Promise<void>;
    createNewConversation: () => void;
    deleteConversation: (conversationId: string) => Promise<void>;
    setActiveConversationId: (id: string | null) => void;
    addLocalMessage: (message: AiConversation['messages'][0]) => void;
    updateConversationFromResponse: (conversationId: string) => void;
}

export const useAiChatStore = create<AiChatState>((set, get) => ({
    conversations: [],
    activeConversationId: null,
    currentMessages: [],
    isLoadingConversations: false,
    isLoadingMessages: false,

    // 加载会话列表
    loadConversations: async () => {
        set({ isLoadingConversations: true });
        try {
            const conversations = await aiChatAPI.getConversations();
            set({ conversations, isLoadingConversations: false });
        } catch (error) {
            console.error('加载会话列表失败:', error);
            set({ isLoadingConversations: false });
        }
    },

    // 选择会话
    selectConversation: async (conversationId: string) => {
        set({ isLoadingMessages: true, activeConversationId: conversationId });
        try {
            const conversation = await aiChatAPI.getConversation(conversationId);
            if (conversation) {
                set({
                    currentMessages: conversation.messages,
                    isLoadingMessages: false
                });
            } else {
                set({ currentMessages: [], isLoadingMessages: false });
            }
        } catch (error) {
            console.error('加载会话详情失败:', error);
            set({ currentMessages: [], isLoadingMessages: false });
        }
    },

    // 创建新会话
    createNewConversation: () => {
        set({
            activeConversationId: null,
            currentMessages: []
        });
    },

    // 删除会话
    deleteConversation: async (conversationId: string) => {
        try {
            await aiChatAPI.deleteConversation(conversationId);
            const { conversations, activeConversationId } = get();
            const filtered = conversations.filter(c => c.conversationId !== conversationId);
            set({ conversations: filtered });

            // 如果删除的是当前会话，清空状态
            if (activeConversationId === conversationId) {
                set({ activeConversationId: null, currentMessages: [] });
            }
        } catch (error) {
            console.error('删除会话失败:', error);
        }
    },

    // 设置活动会话 ID（从后端响应）
    setActiveConversationId: (id: string | null) => {
        set({ activeConversationId: id });
    },

    // 本地添加消息（发送时立即显示）
    addLocalMessage: (message: AiConversation['messages'][0]) => {
        set(state => ({
            currentMessages: [...state.currentMessages, message]
        }));
    },

    // 从后端响应更新会话（刷新会话列表）
    updateConversationFromResponse: (conversationId: string) => {
        set({ activeConversationId: conversationId });
        // 重新加载会话列表以获取更新的标题
        get().loadConversations();
    }
}));

export default useAiChatStore;
