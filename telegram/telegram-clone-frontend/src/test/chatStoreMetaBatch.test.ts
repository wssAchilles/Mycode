import { describe, expect, it } from 'vitest';
import { useChatStore } from '../features/chat/store/chatStore';
import type { Contact } from '../features/chat/store/chatStore';
import type { ChatSummary } from '../features/chat/types';
import type { Message } from '../types/chat';

function makeContact(userId: string): Contact {
  return {
    id: userId,
    userId,
    username: `user:${userId}`,
    status: 'accepted',
    isOnline: false,
    unreadCount: 0,
  };
}

function makeChat(id: string, isGroup: boolean): ChatSummary {
  return {
    id,
    title: `chat:${id}`,
    time: '',
    unreadCount: 0,
    isGroup,
    online: !isGroup ? false : undefined,
    lastMessage: '',
    lastMessageTimestamp: 0,
  };
}

function makeMessage(chatId: string, content: string, timestamp: string): Message {
  const isGroupChat = chatId.startsWith('g:');
  const chatType: Message['chatType'] = isGroupChat ? 'group' : 'private';
  return {
    id: `${chatId}:${timestamp}`,
    chatId,
    chatType,
    content,
    senderId: 'u',
    senderUsername: 'u',
    userId: 'u',
    username: 'u',
    timestamp,
    type: 'text',
    isGroupChat,
    status: 'delivered',
  };
}

describe('chatStore applyChatMetaBatch', () => {
  it('updates presence, unread, lastMessage, and reorders chats to top', () => {
    const u1 = 'u1';
    const g1 = 'g1';

    // Reset store baseline for test isolation.
    useChatStore.setState({
      chats: [makeChat(u1, false), makeChat(g1, true)],
      contacts: [makeContact(u1)],
      pendingRequests: [],
      selectedContact: null,
      selectedGroup: null,
      selectedChatId: undefined,
      isGroupChatMode: false,
      isLoading: false,
      isLoadingContacts: false,
      isLoadingPendingRequests: false,
      isLoadingGroupDetails: false,
      groupDetailsSeq: 0,
      error: null,
    } as any);

    const msg1 = makeMessage(`p:me:${u1}`, 'hello', '2026-01-01T10:00:00.000Z');

    useChatStore.getState().applyChatMetaBatch({
      onlineUpdates: [{ userId: u1, isOnline: true }],
      unreadDeltas: [
        { chatId: u1, delta: 2 },
        { chatId: g1, delta: 1 },
      ],
      lastMessages: [{ chatId: u1, message: msg1 }],
    });

    const st = useChatStore.getState();

    // Contacts.
    expect(st.contacts.find((c) => c.userId === u1)?.isOnline).toBe(true);
    expect(st.contacts.find((c) => c.userId === u1)?.unreadCount).toBe(2);
    expect(st.contacts.find((c) => c.userId === u1)?.lastMessage?.content).toBe('hello');

    // Chats.
    const chatU1 = st.chats.find((c) => c.id === u1)!;
    const chatG1 = st.chats.find((c) => c.id === g1)!;

    expect(chatU1.online).toBe(true);
    expect(chatU1.unreadCount).toBe(2);
    expect(chatU1.lastMessage).toBe('hello');
    expect(chatU1.lastMessageTimestamp).toBe(Date.parse(msg1.timestamp));
    expect(typeof chatU1.time).toBe('string');

    expect(chatG1.unreadCount).toBe(1);

    // Reorder: updated chat should be at top.
    expect(st.chats[0].id).toBe(u1);
  });

  it('reorders multiple updates by timestamp descending', () => {
    const u1 = 'u1';
    const g1 = 'g1';

    useChatStore.setState({
      chats: [makeChat(u1, false), makeChat(g1, true)],
      contacts: [makeContact(u1)],
      pendingRequests: [],
      selectedContact: null,
      selectedGroup: null,
      selectedChatId: undefined,
      isGroupChatMode: false,
      isLoading: false,
      isLoadingContacts: false,
      isLoadingPendingRequests: false,
      isLoadingGroupDetails: false,
      groupDetailsSeq: 0,
      error: null,
    } as any);

    const older = makeMessage(`p:me:${u1}`, 'old', '2026-01-01T10:00:00.000Z');
    const newer = makeMessage(`g:${g1}`, 'new', '2026-01-01T10:00:10.000Z');

    useChatStore.getState().applyChatMetaBatch({
      lastMessages: [
        { chatId: u1, message: older },
        { chatId: g1, message: newer },
      ],
    });

    const st = useChatStore.getState();
    expect(st.chats[0].id).toBe(g1);
    expect(st.chats[1].id).toBe(u1);
  });

  it('upserts group chat into chat list and updates selectedGroup shell', () => {
    const u1 = 'u1';
    const g1 = 'g1';

    useChatStore.setState({
      chats: [makeChat(u1, false)],
      contacts: [makeContact(u1)],
      pendingRequests: [],
      selectedContact: null,
      selectedGroup: {
        id: g1,
        name: 'old',
        ownerId: '',
        type: 'private',
        memberCount: 0,
        maxMembers: 0,
        members: [],
        createdAt: new Date().toISOString(),
        isActive: true,
      },
      selectedChatId: g1,
      isGroupChatMode: true,
      isLoading: false,
      isLoadingContacts: false,
      isLoadingPendingRequests: false,
      isLoadingGroupDetails: false,
      groupDetailsSeq: 0,
      error: null,
    } as any);

    useChatStore.getState().applyChatMetaBatch({
      chatUpserts: [{ chatId: g1, isGroup: true, title: 'new', avatarUrl: '/a.png', memberCount: 3 }],
    });

    const st = useChatStore.getState();

    const chat = st.chats.find((c) => c.id === g1)!;
    expect(chat.isGroup).toBe(true);
    expect(chat.title).toBe('new');
    expect(chat.memberCount).toBe(3);
    // withApiBase() should prefix relative urls.
    expect(typeof chat.avatarUrl).toBe('string');
    expect(chat.avatarUrl?.startsWith('http')).toBe(true);
    expect(chat.avatarUrl?.endsWith('/a.png')).toBe(true);
    // New upserted chat is visible immediately (top).
    expect(st.chats[0].id).toBe(g1);

    expect(st.selectedGroup?.id).toBe(g1);
    expect(st.selectedGroup?.name).toBe('new');
    expect(st.selectedGroup?.memberCount).toBe(3);
    expect(typeof st.selectedGroup?.avatarUrl).toBe('string');
    expect(st.selectedGroup?.avatarUrl?.startsWith('http')).toBe(true);
    expect(st.selectedGroup?.avatarUrl?.endsWith('/a.png')).toBe(true);
  });

  it('removes group chat from list and clears selection when active', () => {
    const u1 = 'u1';
    const g1 = 'g1';

    useChatStore.setState({
      chats: [makeChat(g1, true), makeChat(u1, false)],
      contacts: [makeContact(u1)],
      pendingRequests: [],
      selectedContact: null,
      selectedGroup: {
        id: g1,
        name: 'g',
        ownerId: '',
        type: 'private',
        memberCount: 1,
        maxMembers: 0,
        members: [],
        createdAt: new Date().toISOString(),
        isActive: true,
      },
      selectedChatId: g1,
      isGroupChatMode: true,
      isLoading: false,
      isLoadingContacts: false,
      isLoadingPendingRequests: false,
      isLoadingGroupDetails: true,
      groupDetailsSeq: 0,
      error: null,
    } as any);

    useChatStore.getState().applyChatMetaBatch({
      chatRemovals: [{ chatId: g1 }],
    });

    const st = useChatStore.getState();
    expect(st.chats.find((c) => c.id === g1)).toBeUndefined();
    expect(st.selectedGroup).toBeNull();
    expect(st.selectedChatId).toBeUndefined();
    expect(st.isGroupChatMode).toBe(false);
    // Cancels any in-flight group details request.
    expect(st.isLoadingGroupDetails).toBe(false);
    expect(st.groupDetailsSeq).toBe(1);
  });
});
