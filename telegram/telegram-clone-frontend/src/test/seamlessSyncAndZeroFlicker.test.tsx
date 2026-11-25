import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddContactModal } from '../components/AddContactModal';
import { showToast } from '../components/ui/Toast';
import { SwUpdateBanner } from '../components/ui/SwUpdateBanner';
import ChatList from '../features/chat/components/ChatList';
import { useChatStore } from '../features/chat/store/chatStore';
import SpacePage from '../pages/SpacePage';
import { APP_SW_UPDATE_AVAILABLE_EVENT } from '../pwa/register';
import { contactAPI, groupAPI } from '../services/apiClient';
import { spaceAPI } from '../services/spaceApi';
import { useSpaceStore } from '../stores';
import type { ChatSummary } from '../features/chat/types';
import { formatChatListTimestamp } from '../utils/dateTime';

const TEST_TS = 1_764_000_000_000;

function makeChat(id: string, title = `会话 ${id}`): ChatSummary {
  return {
    id,
    title,
    avatarUrl: null,
    lastMessage: '最近一条消息',
    time: formatChatListTimestamp(TEST_TS),
    lastMessageTimestamp: TEST_TS,
    lastMessageSeq: undefined,
    unreadCount: 0,
    online: false,
    isGroup: false,
  };
}

describe('无感同步、零闪刷、乐观回滚与 Top Layer 提示回归测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatStore.setState({
      chats: [],
      contacts: [],
      pendingRequests: [],
      selectedContact: null,
      selectedGroup: null,
      selectedChatId: undefined,
      isGroupChatMode: false,
      presenceByUserId: {},
      isLoading: false,
      hasLoadedChats: false,
      isRevalidatingChats: false,
      isLoadingContacts: false,
      isLoadingPendingRequests: false,
      isLoadingGroupDetails: false,
      groupDetailsSeq: 0,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.tg-toast-container').forEach((node) => node.remove());
  });

  it('已有会话数据时后台刷新不触发 isLoading、不卸载 ChatList DOM，且未变对象保持结构共享', async () => {
    const initialChat = makeChat('u1', '张三');
    useChatStore.setState({
      chats: [initialChat],
      hasLoadedChats: true,
    });

    const contactSpy = vi.spyOn(contactAPI, 'getContacts').mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              contacts: [
                {
                  id: 'c1',
                  contactId: 'u1',
                  userId: 'u1',
                  status: 'accepted',
                  isOnline: false,
                  unreadCount: 0,
                  contact: { username: '张三' },
                  lastMessage: {
                    id: 'm1',
                    chatId: 'p:me:u1',
                    chatType: 'private',
                    content: '最近一条消息',
                    senderId: 'u1',
                    senderUsername: '张三',
                    userId: 'u1',
                    username: '张三',
                    timestamp: new Date(1_764_000_000_000).toISOString(),
                    type: 'text',
                    isGroupChat: false,
                  },
                },
              ],
            } as any);
          }, 30);
        }),
    );
    vi.spyOn(groupAPI, 'getUserGroups').mockResolvedValue({ groups: [] } as any);

    const view = render(
      <ChatList
        chats={useChatStore.getState().chats}
        onSelectChat={vi.fn()}
        isLoading={useChatStore.getState().isLoading}
      />,
    );

    const loadingStatesDuringRevalidate: boolean[] = [];
    const unsubscribe = useChatStore.subscribe((state) => {
      loadingStatesDuringRevalidate.push(state.isLoading);
    });

    // 并发连续触发两次 loadChats 应单飞合并为 1 次后端请求
    await Promise.all([
      useChatStore.getState().loadChats(),
      useChatStore.getState().loadChats(),
    ]);
    unsubscribe();

    expect(contactSpy).toHaveBeenCalledTimes(1);
    expect(loadingStatesDuringRevalidate.every((flag) => flag === false)).toBe(true);
    // 验证未变化会话项引用被结构共享复用，且列表 DOM 始终保留未曾卸载
    expect(useChatStore.getState().chats[0]).toBe(initialChat);
    expect(view.container.querySelector('.tg-chat-list-loading')).toBeNull();
    expect(screen.getByRole('heading', { name: '张三' })).toBeInTheDocument();
  });

  it('handleContactRequest 支持 0ms 乐观更新并在服务端失败时精准回滚快照', async () => {
    const req = {
      id: 'req-99',
      userId: 'u-99',
      username: '李四',
      status: 'pending' as const,
      isOnline: false,
      unreadCount: 0,
    };
    useChatStore.setState({ pendingRequests: [req] });

    let rejectReq!: (err: Error) => void;
    vi.spyOn(contactAPI, 'handleRequest').mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectReq = reject;
        }),
    );

    const promise = useChatStore.getState().handleContactRequest('req-99', 'accept');

    // 请求尚未返回前已完成 0ms 乐观删除申请并置入联系人与会话列表
    expect(useChatStore.getState().pendingRequests).toHaveLength(0);
    expect(useChatStore.getState().contacts.some((c) => c.userId === 'u-99')).toBe(true);
    expect(useChatStore.getState().chats.some((c) => c.id === 'u-99')).toBe(true);

    rejectReq(new Error('网络错误'));
    await expect(promise).rejects.toThrow('网络错误');

    // 失败后自动精准回滚到操作前快照
    expect(useChatStore.getState().pendingRequests).toHaveLength(1);
    expect(useChatStore.getState().pendingRequests[0].id).toBe('req-99');
    expect(useChatStore.getState().contacts).toHaveLength(0);
    expect(useChatStore.getState().chats).toHaveLength(0);
  });

  it('AddContactModal 发送好友申请 0ms 乐观切态并显示提示，失败时回滚按钮状态且不触发全量列表刷新', async () => {
    vi.spyOn(contactAPI, 'getContacts').mockResolvedValue({ contacts: [] } as any);
    vi.spyOn(contactAPI, 'getPendingRequests').mockResolvedValue({ pendingRequests: [] } as any);
    vi.spyOn(contactAPI, 'searchUsers').mockResolvedValue({
      users: [{ id: 'u-88', username: '王五', contactStatus: null }],
      meta: { total: 1 },
    } as any);

    let rejectAdd!: (err: Error) => void;
    vi.spyOn(contactAPI, 'addContact').mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectAdd = reject;
        }),
    );

    const onContactAdded = vi.fn();
    render(
      <AddContactModal
        isOpen
        initialTab="search"
        onClose={vi.fn()}
        onContactAdded={onContactAdded}
      />,
    );

    const searchInput = screen.getByLabelText('输入用户名或邮箱搜索联系人');
    fireEvent.change(searchInput, { target: { value: '王五' } });
    fireEvent.submit(searchInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '添加联系人 王五' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '添加联系人 王五' }));

    // 无需等 HTTP 返回，立即乐观变为「等待确认」且显示反馈文案
    expect(screen.getByText('等待确认')).toBeInTheDocument();
    expect(screen.getAllByText('已向 王五 发送好友申请').length).toBeGreaterThanOrEqual(1);
    expect(onContactAdded).not.toHaveBeenCalled();

    // 模拟服务端拒绝，自动回滚回可再次点击添加状态
    await act(async () => {
      rejectAdd(new Error('服务繁忙'));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '添加联系人 王五' })).toBeInTheDocument();
    });
    expect(screen.getByText(/添加失败: 服务繁忙/)).toBeInTheDocument();
  });

  it('Toast 支持自动提升至 Top Layer Popover 且不触发异常', async () => {
    const showPopoverSpy = vi.fn();
    const hidePopoverSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'div') {
        Object.assign(el, {
          showPopover: showPopoverSpy,
          hidePopover: hidePopoverSpy,
        });
      }
      return el;
    });

    showToast('已发送好友申请', 'success', 100);

    const container = document.querySelector('.tg-toast-container');
    expect(container).not.toBeNull();
    expect(container?.getAttribute('popover')).toBe('manual');
    expect(showPopoverSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('已发送好友申请')).toBeInTheDocument();
  });

  it('SwUpdateBanner 监听到新版本广播时仅展示非阻塞更新胶囊，不主动强刷页面', () => {
    render(<SwUpdateBanner />);
    expect(screen.queryByText('发现新版本已就绪')).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_SW_UPDATE_AVAILABLE_EVENT));
    });

    expect(screen.getByText('发现新版本已就绪')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /立即更新/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '稍后提醒更新' }));
    expect(screen.queryByText('发现新版本已就绪')).toBeNull();
  });

  it('SpacePage 正常挂载渲染且在消息入口展示未读数与好友申请合计角标，无 TDZ 报错', async () => {
    vi.spyOn(spaceAPI, 'getTrends').mockResolvedValue([]);
    vi.spyOn(spaceAPI, 'getRecommendedUsers').mockResolvedValue([]);
    vi.spyOn(spaceAPI, 'getRecommendationDailyRefresh').mockRejectedValue(new Error('skip'));

    useSpaceStore.setState({
      posts: [
        {
          id: 'p1',
          content: '测试动态',
          author: { id: 'u1', username: 'alice' },
          createdAt: new Date(),
          likesCount: 0,
          commentsCount: 0,
          repostsCount: 0,
          isLiked: false,
          isReposted: false,
        } as any,
      ],
      unreadNotificationsCount: 2,
    });
    useChatStore.setState({
      chats: [{ ...makeChat('u2'), unreadCount: 3 }],
      pendingRequests: [
        {
          id: 'req-1',
          userId: 'u3',
          username: 'bob',
          status: 'pending',
          isOnline: false,
          unreadCount: 0,
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/space']}>
        <SpacePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('测试动态')).toBeInTheDocument();
    expect(screen.getAllByLabelText('未读消息 4').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('未读通知 2').length).toBeGreaterThan(0);
  });
});
