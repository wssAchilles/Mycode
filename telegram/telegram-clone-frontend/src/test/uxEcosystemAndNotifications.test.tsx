import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notifyIncomingMessage,
  resetNotifierThrottleForTests,
  syncDocumentTitle,
} from '../features/realtime/browserNotifier';
import ChatSidebar from '../pages/chat/ChatSidebar';
import { authAPI } from '../services/apiClient';
import { useChatUiPrefsStore } from '../features/chat/state/chatUiPrefsStore';
import { useSpaceStore } from '../stores';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../components/ui/Toast', () => ({
  showToast: vi.fn(),
}));

describe('Phase 4 双端未读互通、标题同步与防误触退出', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNotifierThrottleForTests();
    document.title = 'Telegram Clone';
    useChatUiPrefsStore.getState().hydrateForUser('u1');
    useSpaceStore.setState({ unreadNotificationsCount: 0 });
  });

  it('syncDocumentTitle 根据未读总数更新和还原标签页标题', () => {
    syncDocumentTitle(0);
    expect(document.title).toBe('Telegram Clone');

    syncDocumentTitle(5);
    expect(document.title).toBe('(5) Telegram Clone');

    syncDocumentTitle(128);
    expect(document.title).toBe('(99+) Telegram Clone');

    syncDocumentTitle(0);
    expect(document.title).toBe('Telegram Clone');
  });

  it('notifyIncomingMessage 遵循免打扰静音与 1500ms 节流窗口', () => {
    const notificationMock = vi.fn();
    vi.stubGlobal('Notification', Object.assign(notificationMock, {
      permission: 'granted',
      requestPermission: vi.fn(),
    }));

    const mutedResult = notifyIncomingMessage({
      chatId: 'c1',
      title: 'Alice',
      body: '你好',
      muted: true,
      desktopEnabled: true,
      soundEnabled: false,
      now: 1000,
    });
    expect(mutedResult).toBe(false);
    expect(notificationMock).not.toHaveBeenCalled();

    const first = notifyIncomingMessage({
      chatId: 'c1',
      title: 'Alice',
      body: '你好',
      muted: false,
      desktopEnabled: true,
      soundEnabled: false,
      now: 2000,
    });
    expect(first).toBe(true);
    expect(notificationMock).toHaveBeenCalledTimes(1);

    const throttled = notifyIncomingMessage({
      chatId: 'c1',
      title: 'Alice',
      body: '第二条',
      muted: false,
      desktopEnabled: true,
      soundEnabled: false,
      now: 2800,
    });
    expect(throttled).toBe(false);
    expect(notificationMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('ChatSidebar 显示 Space 未读通知徽标，并在点击退出时弹出二次确认防止误触', async () => {
    const logoutSpy = vi.spyOn(authAPI, 'logout').mockResolvedValue(undefined);
    useSpaceStore.setState({ unreadNotificationsCount: 4 });

    render(
      <MemoryRouter>
        <ChatSidebar
          currentUser={{ id: 'u1', username: 'achilles', email: 'a@example.com' }}
          isConnected
          isAiChatMode={false}
          pendingRequests={[]}
          onSelectAiChat={vi.fn()}
          onOpenGroupModal={vi.fn()}
          onOpenAddContactModal={vi.fn()}
        />
      </MemoryRouter>,
    );

    const backBtn = screen.getByRole('button', { name: '返回 Space 首页（4 条未读动态通知）' });
    expect(backBtn).toHaveTextContent('4');

    // 点击退出按钮不应直接退出，而应展示确认框
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '确认退出当前账号？' })).toBeInTheDocument();

    // 取消可关闭弹窗且不登出
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '确认退出当前账号？' })).not.toBeInTheDocument();
    expect(logoutSpy).not.toHaveBeenCalled();

    // 再次打开并确认退出
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
    fireEvent.click(screen.getByRole('button', { name: '确认退出' }));
    await waitFor(() => {
      expect(logoutSpy).toHaveBeenCalledTimes(1);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });
});
