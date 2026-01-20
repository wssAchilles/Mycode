import { useState, useEffect, useCallback } from 'react';
import { messageAPI, contactAPI } from '../services/apiClient';
import type { Message } from '../types/chat';

export interface Contact {
  id: string;
  userId: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  alias?: string;
  status: 'accepted' | 'pending' | 'blocked' | 'rejected';
  isOnline: boolean;
  lastSeen?: string;
  lastMessage?: Message;
  unreadCount: number;
}

export interface ChatState {
  // 联系人相关
  contacts: Contact[];
  pendingRequests: Contact[];
  selectedContact: Contact | null;

  // 消息相关
  messages: Message[];
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  currentPage: number;

  // UI状态
  isLoadingContacts: boolean;
  isLoadingPendingRequests: boolean;
  error: string | null;
}

export const useChat = () => {
  const [state, setState] = useState<ChatState>({
    contacts: [],
    pendingRequests: [],
    selectedContact: null,
    messages: [],
    isLoadingMessages: false,
    hasMoreMessages: true,
    currentPage: 1,
    isLoadingContacts: false,
    isLoadingPendingRequests: false,
    error: null,
  });

  // 加载联系人列表
  const loadContacts = useCallback(async () => {
    setState(prev => ({ ...prev, isLoadingContacts: true, error: null }));

    try {
      const response = await contactAPI.getContacts('accepted');
      const contacts: Contact[] = response.contacts.map((contact: any) => ({
        id: contact.id,
        userId: contact.contactId,
        username: contact.contact?.username || '未知用户', // 使用正确的关联字段名
        email: contact.contact?.email,
        avatarUrl: contact.contact?.avatarUrl,
        alias: contact.alias,
        status: contact.status,
        isOnline: false, // 稍后通过Socket.IO更新
        lastSeen: contact.contact?.lastSeen,
        lastMessage: undefined, // 稍后加载
        unreadCount: 0,
      }));

      setState(prev => ({
        ...prev,
        contacts,
        isLoadingContacts: false,
      }));
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        error: error.message,
        isLoadingContacts: false,
      }));
    }
  }, []);

  // 加载待处理的联系人请求
  const loadPendingRequests = useCallback(async () => {
    setState(prev => ({ ...prev, isLoadingPendingRequests: true, error: null }));

    try {
      // 使用专门的 API 获取发送给当前用户的待处理请求
      const response = await contactAPI.getPendingRequests();
      console.log('📋 待处理请求API响应:', response);

      // 安全处理API响应
      const requestsArray = response?.pendingRequests || response?.requests || [];
      if (!Array.isArray(requestsArray)) {
        console.warn('⚠️ 待处理请求数据不是数组:', requestsArray);
        setState(prev => ({
          ...prev,
          pendingRequests: [],
          isLoadingPendingRequests: false,
        }));
        return;
      }

      const pendingRequests: Contact[] = requestsArray.map((request: any) => {
        console.log('🔍 处理请求项:', request);
        return {
          id: request.id,
          userId: request.userId, // 请求发送者的ID
          username: request.user?.username || '未知用户', // 请求发送者的用户名
          email: request.user?.email,
          avatarUrl: request.user?.avatarUrl,
          alias: request.alias,
          status: request.status,
          isOnline: false,
          lastSeen: request.user?.lastSeen,
          lastMessage: undefined,
          unreadCount: 0,
        };
      });

      console.log('✅ 解析后的待处理请求:', pendingRequests);

      setState(prev => ({
        ...prev,
        pendingRequests,
        isLoadingPendingRequests: false,
      }));
    } catch (error: any) {
      console.error('❌ 加载待处理请求失败:', error);
      setState(prev => ({
        ...prev,
        error: error.message,
        pendingRequests: [], // 确保出错时也有空数组
        isLoadingPendingRequests: false,
      }));
    }
  }, []);

  // 选择联系人并加载聊天记录（支持传入 null 用于清空选择/进入 AI 模式）
  const selectContact = useCallback(async (contact: Contact | null) => {
    // 允许传入 null：仅重置选中联系人与消息列表，不发起请求
    if (!contact) {
      setState(prev => ({
        ...prev,
        selectedContact: null,
        messages: [],
        currentPage: 1,
        hasMoreMessages: true,
        isLoadingMessages: false,
        error: null,
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      selectedContact: contact,
      messages: [],
      currentPage: 1,
      hasMoreMessages: true,
      isLoadingMessages: true,
      error: null,
    }));

    try {
      const response = await messageAPI.getConversation(contact.userId, 1, 50);
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
        isGroupChat: false,
      }));

      setState(prev => ({
        ...prev,
        messages: messages.reverse(), // 最新消息在底部
        hasMoreMessages: response.pagination.hasMore,
        currentPage: response.pagination.currentPage,
        isLoadingMessages: false,
      }));
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        error: error.message,
        isLoadingMessages: false,
      }));
    }
  }, []);

  // 加载更多历史消息（分页）
  const loadMoreMessages = useCallback(async () => {
    if (!state.selectedContact || state.isLoadingMessages || !state.hasMoreMessages) {
      return;
    }

    setState(prev => ({ ...prev, isLoadingMessages: true }));

    try {
      const nextPage = state.currentPage + 1;
      const response = await messageAPI.getConversation(
        state.selectedContact.userId,
        nextPage,
        50
      );

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
        isGroupChat: false,
      }));

      setState(prev => ({
        ...prev,
        messages: [...newMessages.reverse(), ...prev.messages], // 历史消息在顶部
        hasMoreMessages: response.pagination.hasMore,
        currentPage: response.pagination.currentPage,
        isLoadingMessages: false,
      }));
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        error: error.message,
        isLoadingMessages: false,
      }));
    }
  }, [state.selectedContact, state.currentPage, state.isLoadingMessages, state.hasMoreMessages]);

  // 添加新消息到当前会话
  const addMessage = useCallback((message: Message) => {
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, message],
    }));
  }, []);

  // 更新联系人在线状态
  const updateContactOnlineStatus = useCallback((userId: string, isOnline: boolean, lastSeen?: string) => {
    setState(prev => ({
      ...prev,
      contacts: prev.contacts.map(contact =>
        contact.userId === userId
          ? { ...contact, isOnline, lastSeen }
          : contact
      ),
    }));
  }, []);

  // 更新联系人最后一条消息
  const updateContactLastMessage = useCallback((userId: string, message: Message) => {
    setState(prev => ({
      ...prev,
      contacts: prev.contacts.map(contact =>
        contact.userId === userId
          ? { ...contact, lastMessage: message }
          : contact
      ),
    }));
  }, []);

  // 处理联系人请求（接受/拒绝）
  const handleContactRequest = useCallback(async (requestId: string, action: 'accept' | 'reject') => {
    try {
      await contactAPI.handleRequest(requestId, action);
      // 操作成功后重新加载联系人和待处理请求
      loadContacts();
      loadPendingRequests();
    } catch (error: any) {
      console.error(`处理联系人请求失败 (${action}):`, error);
      setState(prev => ({ ...prev, error: error.message }));
    }
  }, [loadContacts, loadPendingRequests]);

  // 初始化时加载联系人和待处理请求
  useEffect(() => {
    loadContacts();
    loadPendingRequests();
  }, [loadContacts, loadPendingRequests]);

  return {
    // 状态
    ...state,

    // 操作方法
    loadContacts,
    loadPendingRequests,
    selectContact,
    loadMoreMessages,
    addMessage,
    updateContactOnlineStatus,
    updateContactLastMessage,
    handleContactRequest,
  };
};
