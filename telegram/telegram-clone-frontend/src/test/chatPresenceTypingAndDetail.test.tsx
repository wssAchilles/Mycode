import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatDetailPanel from '../pages/chat/ChatDetailPanel';
import { formatTypingSummary, useTypingStore } from '../features/chat/state/typingStore';
import { contactAPI } from '../services/apiClient';
import type { Message } from '../types/chat';
import { formatLastSeen } from '../utils/dateTime';

const mockNavigate = vi.fn();
const mockShowToast = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../components/ui/Toast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

describe('Phase 3 最后上线时间、正在输入与联系人详情面板', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTypingStore.getState().clearAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formatLastSeen 按时间差输出人性化离线文案', () => {
    const now = new Date('2026-11-25T15:30:00');
    expect(formatLastSeen(undefined, now)).toBe('离线');
    expect(formatLastSeen(new Date('2026-11-25T15:29:40'), now)).toBe('刚刚在线');
    expect(formatLastSeen(new Date('2026-11-25T15:12:00'), now)).toBe('18 分钟前在线');
    expect(formatLastSeen(new Date('2026-11-25T09:05:00'), now)).toBe('今天 09:05 在线');
    expect(formatLastSeen(new Date('2026-11-24T22:15:00'), now)).toBe('昨天 22:15 在线');
    expect(formatLastSeen(new Date('2026-11-18T10:00:00'), now)).toBe('11月18日 在线');
  });

  it('typingStore 支持单聊/群聊正在输入状态更新及 5 秒自动过期', () => {
    vi.useFakeTimers();
    const base = new Date('2026-11-25T15:00:00Z').getTime();
    vi.setSystemTime(base);

    const store = useTypingStore.getState();
    store.setTyping('u2', 'u2', 'Bob', true, base);
    expect(formatTypingSummary(useTypingStore.getState().byChatId.u2, false)).toBe('对方正在输入…');

    store.setTyping('g1', 'u2', 'Bob', true, base);
    store.setTyping('g1', 'u3', 'Alice', true, base);
    expect(formatTypingSummary(useTypingStore.getState().byChatId.g1, true)).toBe('Bob 等 2 人正在输入…');

    store.setTyping('u2', 'u2', 'Bob', false, base + 500);
    expect(useTypingStore.getState().byChatId.u2).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(5200);
    });
    expect(useTypingStore.getState().byChatId.g1).toBeUndefined();
  });

  it('ChatDetailPanel 支持跳转 Space 主页、修改备注、点击共享大图与删除二次确认', async () => {
    const updateAliasSpy = vi.spyOn(contactAPI, 'updateAlias').mockResolvedValue(undefined);
    const removeContactSpy = vi.spyOn(contactAPI, 'removeContact').mockResolvedValue(undefined);
    const onPreviewImage = vi.fn();
    const onContactUpdated = vi.fn();
    const onContactRemoved = vi.fn();
    const onClose = vi.fn();

    const sharedMedia: Message[] = [
      {
        id: 'img1',
        chatId: 'p:u1:u2',
        chatType: 'private',
        content: '[图片]',
        senderId: 'u2',
        senderUsername: 'bob',
        userId: 'u2',
        username: 'bob',
        timestamp: '2026-11-25T10:00:00Z',
        type: 'image',
        isGroupChat: false,
        fileUrl: '/uploads/photo1.jpg',
        fileName: 'photo1.jpg',
      },
    ];

    render(
      <MemoryRouter>
        <ChatDetailPanel
          isOpen
          onClose={onClose}
          selectedContact={{
            userId: 'u2',
            username: 'bob',
            alias: '老张',
            isOnline: false,
            lastSeen: new Date(Date.now() - 10 * 60_000).toISOString(),
          }}
          sharedMediaMessages={sharedMedia}
          onPreviewImage={onPreviewImage}
          onContactUpdated={onContactUpdated}
          onContactRemoved={onContactRemoved}
        />
      </MemoryRouter>,
    );

    // 查看动态主页
    fireEvent.click(screen.getByRole('button', { name: /查看动态主页/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/space/user/u2');

    // 修改备注
    fireEvent.click(screen.getByRole('button', { name: /修改备注/i }));
    const aliasInput = screen.getByLabelText('联系人备注名');
    fireEvent.change(aliasInput, { target: { value: '产品老张' } });
    fireEvent.click(screen.getByRole('button', { name: '保存备注名' }));
    await waitFor(() => {
      expect(updateAliasSpy).toHaveBeenCalledWith('u2', '产品老张');
    });
    expect(onContactUpdated).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('联系人备注已更新', 'info');

    // 共享图片点击
    fireEvent.click(screen.getByRole('button', { name: /预览共享图片 photo1\.jpg/i }));
    expect(onPreviewImage).toHaveBeenCalledWith(
      expect.objectContaining({
        src: expect.stringContaining('/uploads/photo1.jpg'),
        fileName: 'photo1.jpg',
      }),
    );

    // 删除联系人内联二次确认
    fireEvent.click(screen.getByRole('button', { name: /删除联系人/i }));
    expect(screen.getByRole('alertdialog', { name: '联系人操作二次确认' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(removeContactSpy).toHaveBeenCalledWith('u2');
    });
    expect(onContactRemoved).toHaveBeenCalledWith('u2');
    expect(onClose).toHaveBeenCalled();
  });
});
