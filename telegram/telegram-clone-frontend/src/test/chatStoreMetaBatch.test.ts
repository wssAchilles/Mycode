import { describe, expect, it, vi } from 'vitest';
import { formatChatListTimestamp, useChatStore } from '../features/chat/store/chatStore';
import { contactAPI } from '../services/apiClient';
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
    lastMessageSeq: 0,
  };
}

function makeMessage(chatId: string, content: string, timestamp: string, seq = 42): Message {
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
    seq,
    type: 'text',
    isGroupChat,
    status: 'delivered',
  };
}

describe('chatStore applyChatMetaBatch', () => {
  it('本日时间仅显示时分，非本日且本周内显示周几，非本周显示具体日期', () => {
    // 2026-06-05 为周五
    const now = new Date('2026-06-05T08:30:00.000+08:00');

    expect(formatChatListTimestamp('2026-06-05T07:28:00.000+08:00', now)).toBe('07:28');
    expect(formatChatListTimestamp('2026-06-04T22:27:00.000+08:00', now)).toBe('周四');
    expect(formatChatListTimestamp('2026-05-31T22:27:00.000+08:00', now)).toBe('05/31');
    expect(formatChatListTimestamp('2025-12-31T22:27:00.000+08:00', now)).toBe('2025/12/31');
  });

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
    expect(chatU1.unreadPulseSeq).toBe(1);
    expect(chatU1.lastMessage).toBe('hello');
    expect(chatU1.lastMessageTimestamp).toBe(Date.parse(msg1.timestamp));
    expect(chatU1.lastMessageSeq).toBe(42);
    expect(typeof chatU1.time).toBe('string');

    expect(chatG1.unreadCount).toBe(1);

    // Reorder: updated chat should be at top.
    expect(st.chats[0].id).toBe(u1);
  });

  it('keeps selected contact presence in sync with realtime meta updates', () => {
    const u1 = 'u1';
    const selected = makeContact(u1);

    useChatStore.setState({
      chats: [makeChat(u1, false)],
      contacts: [selected],
      pendingRequests: [],
      selectedContact: selected,
      selectedGroup: null,
      selectedChatId: u1,
      isGroupChatMode: false,
      isLoading: false,
      isLoadingContacts: false,
      isLoadingPendingRequests: false,
      isLoadingGroupDetails: false,
      groupDetailsSeq: 0,
      error: null,
    } as any);

    useChatStore.getState().applyChatMetaBatch({
      onlineUpdates: [{ userId: u1, isOnline: true }],
    });

    const st = useChatStore.getState();
    expect(st.selectedContact?.isOnline).toBe(true);
    expect(st.contacts.find((c) => c.userId === u1)?.isOnline).toBe(true);
    expect(st.chats.find((c) => c.id === u1)?.online).toBe(true);
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
    expect(st.chats[0].lastMessageSeq).toBe(42);
  });

  it('does not move chats to top for stale or same lastMessage metadata', () => {
    const u1 = 'u1';
    const g1 = 'g1';
    const newerTimestamp = '2026-01-01T10:00:10.000Z';

    useChatStore.setState({
      chats: [
        {
          ...makeChat(g1, true),
          lastMessage: 'newer',
          lastMessageTimestamp: Date.parse(newerTimestamp),
          lastMessageSeq: 10,
        },
        makeChat(u1, false),
      ],
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

    useChatStore.getState().applyChatMetaBatch({
      lastMessages: [
        { chatId: u1, message: makeMessage(`p:me:${u1}`, 'same', '2026-01-01T10:00:00.000Z', 0) },
        { chatId: g1, message: makeMessage(`g:${g1}`, 'older', '2026-01-01T10:00:00.000Z', 9) },
      ],
    });

    const st = useChatStore.getState();
    expect(st.chats[0].id).toBe(g1);
    expect(st.chats[0].lastMessage).toBe('newer');
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

  it('deduplicates concurrent loadContacts requests with an in-flight lock', async () => {
    type GetContactsResult = Awaited<ReturnType<typeof contactAPI.getContacts>>;
    let resolveContacts!: (val: GetContactsResult) => void;
    const pendingPromise = new Promise<GetContactsResult>((resolve) => {
      resolveContacts = resolve;
    });
    const spy = vi.spyOn(contactAPI, 'getContacts').mockReturnValue(pendingPromise);

    const p1 = useChatStore.getState().loadContacts();
    const p2 = useChatStore.getState().loadContacts();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('accepted');

    resolveContacts({
      contacts: [
        {
          id: 'c1',
          contactId: 'u-1',
          userId: 'me',
          status: 'accepted',
          contact: { username: 'Alice' },
        },
      ],
    } as unknown as GetContactsResult);
    await Promise.all([p1, p2]);

    expect(useChatStore.getState().contacts).toHaveLength(1);
    expect(useChatStore.getState().isLoadingContacts).toBe(false);

    spy.mockRestore();
  });

  it('乐观更新会话卡片摘要、服务端 seq 跨时钟覆盖与硬失败回滚', () => {
    const baseTs = Date.parse('2026-11-19T01:00:00.000Z');
    useChatStore.setState({
      chats: [
        {
          id: 'u-top',
          title: 'Top Chat',
          lastMessage: 'older top',
          time: '09:00',
          lastMessageTimestamp: baseTs + 1000,
          lastMessageSeq: 5,
          unreadCount: 0,
          isGroup: false,
        },
        {
          id: 'u-target',
          title: 'Target Chat',
          lastMessage: 'old msg',
          time: '08:59',
          lastMessageTimestamp: baseTs,
          unreadCount: 0,
          isGroup: false,
        },
      ],
      contacts: [],
    });

    // 1. 乐观发送：立刻更新摘要并置顶
    const clientAheadTs = baseTs + 60_000;
    const optimisticMsg: Message = {
      id: 'temp-1',
      clientTempId: 'temp-1',
      chatId: 'p:me:u-target',
      chatType: 'private',
      content: '正在发送的内容',
      senderId: 'me',
      senderUsername: 'me',
      userId: 'me',
      username: 'me',
      receiverId: 'u-target',
      timestamp: new Date(clientAheadTs).toISOString(),
      type: 'text',
      isGroupChat: false,
      status: 'pending',
    };

    const snapshot = useChatStore.getState().applyOptimisticLastMessage('u-target', optimisticMsg);
    expect(useChatStore.getState().chats[0].id).toBe('u-target');
    expect(useChatStore.getState().chats[0].lastMessage).toBe('正在发送的内容');

    // 2. 硬失败回滚：恢复发送前的摘要与排序
    useChatStore.getState().restoreOptimisticLastMessage('u-target', snapshot, '正在发送的内容');
    expect(useChatStore.getState().chats[0].id).toBe('u-top');
    expect(useChatStore.getState().chats[1]).toMatchObject({ id: 'u-target', lastMessage: 'old msg' });

    // 3. 再次乐观发送，且服务端返回的时间戳早于客户端时钟（时钟偏差），带 seq 的权威消息仍可正常覆盖
    useChatStore.getState().applyOptimisticLastMessage('u-target', optimisticMsg);
    useChatStore.getState().applyChatMetaBatch({
      lastMessages: [
        {
          chatId: 'u-target',
          message: {
            ...optimisticMsg,
            id: 'srv-1',
            seq: 1,
            status: 'delivered',
            timestamp: new Date(baseTs + 10_000).toISOString(),
          },
        },
      ],
    });
    expect(useChatStore.getState().chats[0]).toMatchObject({
      id: 'u-target',
      lastMessage: '正在发送的内容',
      lastMessageSeq: 1,
    });
  });
});
