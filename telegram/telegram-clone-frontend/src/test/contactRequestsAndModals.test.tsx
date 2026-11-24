import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddContactModal } from '../components/AddContactModal';
import CreateGroupModal from '../features/chat/components/CreateGroupModal';
import { useChatStore } from '../features/chat/store/chatStore';
import { contactAPI, groupAPI } from '../services/apiClient';

vi.mock('../components/ui/Toast', () => ({
  showToast: vi.fn(),
}));

describe('好友申请解析、AddContactModal 与 CreateGroupModal 体验验证', () => {
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
      isLoadingContacts: false,
      isLoadingPendingRequests: false,
      isLoadingGroupDetails: false,
      groupDetailsSeq: 0,
      error: null,
    });
  });

  it('chatStore.loadPendingRequests 能正确解析后端 data 数组并完整保留头像与时间', async () => {
    vi.spyOn(contactAPI, 'getPendingRequests').mockResolvedValueOnce({
      success: true,
      pendingRequests: [
        {
          id: 'req-666',
          userId: 'user-666',
          status: 'pending',
          addedAt: '2026-11-24T07:20:50.054Z',
          user: {
            id: 'user-666',
            username: '666',
            avatarUrl: 'https://cdn.example.com/666.png',
          },
        },
      ],
      data: [
        {
          id: 'req-666',
          userId: 'user-666',
          status: 'pending',
          addedAt: '2026-11-24T07:20:50.054Z',
          user: {
            id: 'user-666',
            username: '666',
            avatarUrl: 'https://cdn.example.com/666.png',
          },
        },
      ],
    });

    await useChatStore.getState().loadPendingRequests();
    const list = useChatStore.getState().pendingRequests;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'req-666',
      userId: 'user-666',
      username: '666',
      avatarUrl: 'https://cdn.example.com/666.png',
      addedAt: '2026-11-24T07:20:50.054Z',
    });
  });

  it('chatStore.loadPendingRequests 在未规范化仅含 data 字段时也能兼容解析', async () => {
    vi.spyOn(contactAPI, 'getPendingRequests').mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'req-raw',
          userId: 'user-raw',
          status: 'pending',
          addedAt: '2026-11-24T08:00:00.000Z',
          user: { username: 'raw-user' },
        },
      ],
    });

    await useChatStore.getState().loadPendingRequests();
    const list = useChatStore.getState().pendingRequests;
    expect(list).toHaveLength(1);
    expect(list[0].username).toBe('raw-user');
  });

  it('AddContactModal 展示三标签页、好友申请同意及搜索反向命中同意申请', async () => {
    vi.spyOn(contactAPI, 'getContacts').mockResolvedValue({ contacts: [] });
    vi.spyOn(contactAPI, 'getPendingRequests').mockResolvedValue({
      pendingRequests: [
        {
          id: 'req-666',
          userId: 'user-666',
          status: 'pending',
          addedAt: '2026-11-24T07:20:50.054Z',
          user: { username: '666' },
        },
      ],
    });
    vi.spyOn(contactAPI, 'searchUsers').mockResolvedValue({
      users: [
        { id: 'user-666', username: '666', email: '666@example.com', contactStatus: null },
        { id: 'user-777', username: '777', email: '777@example.com', contactStatus: null },
      ],
      meta: { total: 2 },
    });
    const addSpy = vi.spyOn(contactAPI, 'addContact').mockResolvedValue({ success: true });
    const handleReqSpy = vi.spyOn(contactAPI, 'handleRequest').mockResolvedValue({ success: true });
    vi.spyOn(groupAPI, 'getUserGroups').mockResolvedValue({ groups: [] } as any);

    const onClose = vi.fn();
    const onContactAdded = vi.fn();

    render(
      <AddContactModal
        isOpen
        initialTab="requests"
        onClose={onClose}
        onContactAdded={onContactAdded}
      />,
    );

    // 默认停留在好友申请页并看到 666 的申请
    await waitFor(() => {
      expect(screen.getByText('666')).toBeTruthy();
    });
    expect(screen.getByRole('tab', { name: /找人添加/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /好友申请/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /已发出/ })).toBeTruthy();

    // 切到找人添加搜索，666 应反向识别为「同意申请」，777 为「添加好友」
    fireEvent.click(screen.getByRole('tab', { name: /找人添加/ }));
    const searchInput = screen.getByLabelText('输入用户名或邮箱搜索联系人');
    fireEvent.change(searchInput, { target: { value: '6' } });
    fireEvent.submit(searchInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('777')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /同意申请/ })).toBeTruthy();

    // 发送好友申请后保持弹窗开启并切换为「等待确认」
    fireEvent.click(screen.getByRole('button', { name: '添加联系人 777' }));
    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledWith('user-777');
      expect(screen.getByText('等待确认')).toBeTruthy();
    });
    expect(onClose).not.toHaveBeenCalled();

    // 点击「同意申请」可直接处理入站请求
    fireEvent.click(screen.getByRole('button', { name: /同意申请/ }));
    await waitFor(() => {
      expect(handleReqSpy).toHaveBeenCalledWith('req-666', 'accept');
    });
  });

  it('CreateGroupModal 第一步支持仅看在线筛选、全选清空与底部两步切换', async () => {
    vi.spyOn(contactAPI, 'getContacts').mockResolvedValue({
      contacts: [
        {
          id: 'c-1',
          contactId: 'u-1',
          userId: 'u-1',
          status: 'accepted',
          isOnline: true,
          contact: { username: 'alice' },
        },
        {
          id: 'c-2',
          contactId: 'u-2',
          userId: 'u-2',
          status: 'accepted',
          isOnline: false,
          contact: { username: 'bob' },
        },
      ],
    } as any);

    render(
      <CreateGroupModal
        isOpen
        onClose={vi.fn()}
        onGroupCreated={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
      expect(screen.getByText('bob')).toBeTruthy();
    });

    // 仅看在线过滤应隐藏离线的 bob
    fireEvent.click(screen.getByRole('button', { name: '仅看在线 (1)' }));
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.queryByText('bob')).toBeNull();

    // 全选当前并切回全部，再清空
    fireEvent.click(screen.getByRole('button', { name: '全选当前' }));
    expect(screen.getByRole('button', { name: '进入群组信息配置' }).textContent).toContain('下一步 (1)');

    fireEvent.click(screen.getByRole('button', { name: '进入群组信息配置' }));
    await waitFor(() => {
      expect(screen.getByText('完善群组信息')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /上一步/ }));
    await waitFor(() => {
      expect(screen.getByText('新建群组')).toBeTruthy();
    });
  });
});
