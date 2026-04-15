import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatHistory from '../features/chat/components/ChatHistory';
import { useChatStore, type Group } from '../features/chat/store/chatStore';
import { useMessageStore } from '../features/chat/store/messageStore';
import type { Message } from '../types/chat';

const originalChatState = useChatStore.getState();
const originalMessageState = useMessageStore.getState();

const makeGroup = (id: string, name: string, members: Group['members']): Group => ({
  id,
  name,
  description: '',
  ownerId: 'u1',
  type: 'private',
  avatarUrl: undefined,
  memberCount: members?.length || 0,
  maxMembers: 200,
  members,
  currentUserRole: 'owner',
  currentUserStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  isActive: true,
});

const makeMessage = (id: string, seq: number, userId: string, content: string): Message => ({
  id,
  seq,
  chatId: 'g:test',
  chatType: 'group',
  userId,
  username: userId === 'u1' ? '123' : '666',
  senderId: userId,
  senderUsername: userId === 'u1' ? '123' : '666',
  content,
  timestamp: `2026-01-01T00:00:0${seq}.000Z`,
  type: 'text',
  isGroupChat: true,
  status: 'sent',
  readCount: 0,
});

describe('ChatHistory group switching', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      cb(16);
      return 1;
    }) as typeof requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    useChatStore.setState({
      ...originalChatState,
      chats: [],
      contacts: [],
      pendingRequests: [],
      selectedContact: null,
      selectedChatId: 'g1',
      selectedGroup: makeGroup('g1', '测试群组A', [
        {
          id: 'm-1',
          userId: 'u1',
          username: '123',
          role: 'owner',
          joinedAt: '2026-01-01T00:00:00.000Z',
          status: 'active',
        },
        {
          id: 'm-2',
          userId: 'u2',
          username: '666',
          role: 'admin',
          joinedAt: '2026-01-01T00:00:00.000Z',
          status: 'active',
        },
      ]),
      isGroupChatMode: true,
    });

    const messages = [makeMessage('m1', 1, 'u2', '大家好'), makeMessage('m2', 2, 'u2', '线上复检')];
    useMessageStore.setState({
      ...originalMessageState,
      messageIds: ['m1', 'm2'],
      messageIdsVersion: 1,
      entities: new Map(messages.map((message) => [message.id, message])),
      visibleStart: -1,
      visibleEnd: -1,
      aiMessages: [],
      activeContactId: 'g1',
      activeChatId: 'g:g1',
      isGroupChat: true,
      isLoading: false,
      hasMore: false,
      nextBeforeSeq: null,
      error: null,
    });

    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useChatStore.setState(originalChatState);
    useMessageStore.setState(originalMessageState);
    consoleErrorSpy.mockClear();
  });

  it('does not trigger getSnapshot infinite loop warnings when switching to a single-member group', async () => {
    const onVisibleRangeChange = vi.fn();
    const view = render(
      <ChatHistory
        currentUserId="u1"
        messageIds={useMessageStore.getState().messageIds.slice()}
        messageIdsVersion={useMessageStore.getState().messageIdsVersion}
        isLoading={false}
        hasMore={false}
        onVisibleRangeChange={onVisibleRangeChange}
      />,
    );

    const nextMessages = [
      makeMessage('m3', 1, 'u2', '大家好'),
      makeMessage('m4', 2, 'u2', '线上复检-最后一轮'),
      makeMessage('m5', 3, 'u1', 'phase5 browser validation'),
    ];

    await act(async () => {
      useChatStore.setState({
        selectedChatId: 'g2',
        selectedGroup: makeGroup('g2', '666', [
          {
            id: 'm-3',
            userId: 'u1',
            username: '123',
            role: 'owner',
            joinedAt: '2026-01-01T00:00:00.000Z',
            status: 'active',
          },
        ]),
        isGroupChatMode: true,
      });

      useMessageStore.setState({
        messageIds: ['m3', 'm4', 'm5'],
        messageIdsVersion: 2,
        entities: new Map(nextMessages.map((message) => [message.id, message])),
        activeContactId: 'g2',
        activeChatId: 'g:g2',
        isGroupChat: true,
        visibleStart: -1,
        visibleEnd: -1,
      });

      view.rerender(
        <ChatHistory
          currentUserId="u1"
          messageIds={useMessageStore.getState().messageIds.slice()}
          messageIdsVersion={useMessageStore.getState().messageIdsVersion}
          isLoading={false}
          hasMore={false}
          onVisibleRangeChange={onVisibleRangeChange}
        />,
      );
    });

    const combinedErrors = consoleErrorSpy.mock.calls.flat().join('\n');
    expect(combinedErrors).not.toContain('getSnapshot should be cached');
    expect(combinedErrors).not.toContain('Maximum update depth exceeded');
  });
});
