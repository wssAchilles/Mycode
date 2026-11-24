import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeqGapGuard } from '../core/workers/chatCore/seqGapGuard';
import { ChatCoreStore } from '../core/chat/store/chatCoreStore';
import { useChatStore } from '../features/chat/store/chatStore';
import { applySelfReadSyncEvents } from '../features/realtime';
import { useSpaceStore } from '../stores/useSpaceStore';
import type { Message } from '../types/chat';

function makeMsg(overrides: Partial<Message> & { id: string; chatId: string }): Message {
  const isGroup = overrides.chatId.startsWith('g:');
  return {
    chatType: isGroup ? 'group' : 'private',
    content: '默认文本',
    senderId: 'u2',
    senderUsername: 'u2',
    userId: 'u2',
    username: 'u2',
    timestamp: '2026-11-24T12:00:00.000Z',
    type: 'text',
    isGroupChat: isGroup,
    status: 'delivered',
    ...overrides,
  };
}

describe('前端实时同步全域能力核心回归测试', () => {
  beforeEach(() => {
    useChatStore.setState({
      chats: [],
      contacts: [],
      pendingRequests: [],
      selectedContact: null,
      selectedGroup: null,
      selectedChatId: undefined,
      isGroupChatMode: false,
      presenceByUserId: {},
      error: null,
    });
    useSpaceStore.setState({
      unreadNotificationsCount: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SeqGapGuard 在 500ms 窗口内收齐乱序分片时免拉取闭合，超时仍缺洞时触发 afterSeq 补洞', async () => {
    vi.useFakeTimers();
    const onGapTimeout = vi.fn().mockResolvedValue(undefined);
    const guard = new SeqGapGuard({
      waitMs: 500,
      maxSpan: 200,
      onGapTimeout,
    });

    // 1. 收到 seq=12 出现空洞 [11]，400ms 内乱序补齐 seq=11，应撤除定时器零请求
    guard.observeIncoming('p:u1:u2', 10, [12]);
    expect(guard.hasPendingGap('p:u1:u2')).toBe(true);
    vi.advanceTimersByTime(400);
    guard.observeIncoming('p:u1:u2', 12, [11]);
    expect(guard.hasPendingGap('p:u1:u2')).toBe(false);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(onGapTimeout).not.toHaveBeenCalled();

    // 2. 本地 seq=20，直接跳到 seq=23，超过 500ms 未补齐则触发精确 afterSeq=20 补洞
    guard.observeIncoming('p:u1:u2', 20, [23]);
    expect(guard.hasPendingGap('p:u1:u2')).toBe(true);
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(onGapTimeout).toHaveBeenCalledTimes(1);
    expect(onGapTimeout).toHaveBeenCalledWith('p:u1:u2', 20, 22);
    expect(guard.hasPendingGap('p:u1:u2')).toBe(false);

    guard.clearAll();
  });

  it('ChatCoreStore 支持消息原地编辑与撤回删除，并准确维护序号范围和最新消息摘要', () => {
    const store = new ChatCoreStore(10);
    const chatId = 'p:u1:u2';
    store.replaceMessages(chatId, false, [
      makeMsg({ id: 'm1', chatId, seq: 1, content: '第一条' }),
      makeMsg({ id: 'm2', chatId, seq: 2, content: '第二条' }),
    ]);

    const edited = store.updateMessageContent(chatId, 'm1', '第一条（已改）', '2026-11-24T12:01:00.000Z');
    expect(edited?.content).toBe('第一条（已改）');
    expect(edited?.editedAt).toBe('2026-11-24T12:01:00.000Z');
    expect(store.getMessagesByIds(chatId, ['m1'])[0].content).toBe('第一条（已改）');

    const { removed, nextLastMessage } = store.removeMessage(chatId, 'm2');
    expect(removed).toBe(true);
    expect(nextLastMessage?.id).toBe('m1');
    expect(store.getChat(chatId)?.maxSeq).toBe(1);
    expect(store.getMessagesByIds(chatId, ['m2'])).toHaveLength(0);
  });

  it('chatStore 支持联系人申请/审批/拒绝/删改备注实时投影及新私聊首条消息自动建卡置顶', () => {
    const store = useChatStore.getState();

    // 收到好友申请
    store.applyContactRequestReceived({
      eventId: 'ev1',
      emittedAt: '2026-11-24T12:00:00.000Z',
      action: 'request_received',
      actorId: 'u2',
      requestId: 'req-2',
      request: {
        id: 'req-2',
        userId: 'u2',
        username: 'Alice',
        status: 'pending',
      },
    });
    expect(useChatStore.getState().pendingRequests).toHaveLength(1);
    expect(useChatStore.getState().pendingRequests[0].username).toBe('Alice');

    // 对方或自己同意申请 -> 从待处理清除、入列联系人并创建私聊卡片
    store.applyContactRequestAccepted({
      eventId: 'ev2',
      emittedAt: '2026-11-24T12:01:00.000Z',
      action: 'request_accepted',
      actorId: 'u2',
      requestId: 'req-2',
      contact: {
        id: 'c-2',
        userId: 'u2',
        contactId: 'u2',
        username: 'Alice',
        status: 'accepted',
        isOnline: true,
      },
    });
    expect(useChatStore.getState().pendingRequests).toHaveLength(0);
    expect(useChatStore.getState().contacts.some((c) => c.userId === 'u2')).toBe(true);
    expect(useChatStore.getState().chats.some((c) => !c.isGroup && c.id === 'u2')).toBe(true);

    // 备注修改实时更新私聊卡片标题
    useChatStore.setState({ selectedContact: useChatStore.getState().contacts[0] });
    store.applyContactAliasUpdated({
      eventId: 'ev3',
      emittedAt: '2026-11-24T12:02:00.000Z',
      action: 'alias_updated',
      actorId: 'u1',
      contactId: 'u2',
      alias: '产品 Alice',
    });
    expect(useChatStore.getState().chats.find((c) => c.id === 'u2')?.title).toBe('产品 Alice');
    expect(useChatStore.getState().selectedContact?.alias).toBe('产品 Alice');

    // 新私聊首次发消息时（列表尚无卡片）自动建卡置顶并累计未读数
    store.applyChatMetaBatch({
      unreadDeltas: [{ chatId: 'u_new', delta: 1 }],
      lastMessages: [
        {
          chatId: 'u_new',
          message: makeMsg({
            id: 'msg-new-1',
            chatId: 'p:u1:u_new',
            senderId: 'u_new',
            senderUsername: 'Bob',
            username: 'Bob',
            content: '你好，刚加上！',
            seq: 1,
            timestamp: '2026-11-24T12:03:00.000Z',
          }),
        },
      ],
    });
    const chatsAfterNew = useChatStore.getState().chats;
    expect(chatsAfterNew[0].id).toBe('u_new');
    expect(chatsAfterNew[0].title).toBe('Bob');
    expect(chatsAfterNew[0].unreadCount).toBe(1);
    expect(chatsAfterNew[0].lastMessage).toBe('你好，刚加上！');

    // 删除好友同步清掉联系人与私聊卡片并取消当前选中
    store.applyContactRemoved(
      {
        eventId: 'ev4',
        emittedAt: '2026-11-24T12:04:00.000Z',
        action: 'contact_removed',
        actorId: 'u2',
        userId: 'u2',
      },
      'u1',
    );
    expect(useChatStore.getState().contacts.some((c) => c.userId === 'u2')).toBe(false);
    expect(useChatStore.getState().chats.some((c) => c.id === 'u2')).toBe(false);
    expect(useChatStore.getState().selectedContact).toBeNull();
  });

  it('applySelfReadSyncEvents 在其余标签页推进已读后立即清零本端红点', () => {
    useChatStore.setState({
      chats: [
        { id: 'u2', title: 'Alice', time: '', unreadCount: 3, isGroup: false },
        { id: 'g9', title: '核心群', time: '', unreadCount: 5, isGroup: true },
        { id: 'u3', title: 'KeepUnread', time: '', unreadCount: 2, isGroup: false },
      ],
    });

    applySelfReadSyncEvents(
      [
        {
          eventId: 'sync1',
          emittedAt: '2026-11-24T12:05:00.000Z',
          action: 'chat_read',
          userId: 'u1',
          chatId: 'p:u1:u2',
          seq: 18,
        },
        {
          eventId: 'sync2',
          emittedAt: '2026-11-24T12:05:01.000Z',
          action: 'chat_read',
          userId: 'u1',
          chatId: 'g:g9',
          seq: 42,
        },
      ],
      'u1',
    );

    const chats = useChatStore.getState().chats;
    expect(chats.find((c) => c.id === 'u2')?.unreadCount).toBe(0);
    expect(chats.find((c) => c.id === 'g9')?.unreadCount).toBe(0);
    expect(chats.find((c) => c.id === 'u3')?.unreadCount).toBe(2);
  });

  it('useSpaceStore 对实时社交通知进行 eventId 幂等去重并支持清空红点', () => {
    const store = useSpaceStore.getState();

    store.receiveRealtimeNotification({
      eventId: 'n1',
      emittedAt: '2026-11-24T12:06:00.000Z',
      action: 'like',
      recipientId: 'u1',
      actor: { id: 'u2', username: 'Alice' },
      postId: 'p1',
    });
    // 相同 eventId 重复推送应去重
    store.receiveRealtimeNotification({
      eventId: 'n1',
      emittedAt: '2026-11-24T12:06:00.000Z',
      action: 'like',
      recipientId: 'u1',
      actor: { id: 'u2', username: 'Alice' },
      postId: 'p1',
    });
    store.receiveRealtimeNotification({
      eventId: 'n2',
      emittedAt: '2026-11-24T12:06:05.000Z',
      action: 'follow',
      recipientId: 'u1',
      actor: { id: 'u3', username: 'Bob' },
    });

    expect(useSpaceStore.getState().unreadNotificationsCount).toBe(2);
    store.clearUnreadNotifications();
    expect(useSpaceStore.getState().unreadNotificationsCount).toBe(0);
  });
});
