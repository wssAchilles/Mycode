import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChatList from '../features/chat/components/ChatList';
import type { ChatSummary } from '../features/chat/types';

const makeChat = (id: string, avatarUrl?: string): ChatSummary => ({
  id,
  title: `chat-${id}`,
  avatarUrl,
  lastMessage: 'Done. The latest line now hints...',
  time: '08:13',
  unreadCount: 1,
  isGroup: false,
  online: false,
  lastMessageTimestamp: Date.parse('2026-06-05T00:00:00.000Z'),
});

describe('ChatList initial render motion boundary', () => {
  it('does not mark the initial batch as new, but marks later inserted chats', () => {
    const initialChats = [makeChat('u1'), makeChat('u2'), makeChat('u3')];
    const view = render(
      <ChatList
        chats={initialChats}
        onSelectChat={() => undefined}
        isLoading={false}
      />,
    );

    expect(view.container.querySelectorAll('.tg-chat-item')).toHaveLength(3);
    expect(view.container.querySelectorAll('.tg-chat-item.is-new')).toHaveLength(0);

    view.rerender(
      <ChatList
        chats={[makeChat('u4'), ...initialChats]}
        onSelectChat={() => undefined}
        isLoading={false}
      />,
    );

    const newItems = view.container.querySelectorAll('.tg-chat-item.is-new');
    expect(newItems).toHaveLength(1);
    expect(newItems[0]).toHaveAccessibleName('打开会话 chat-u4');
  });

  it('virtualizes large 192-chat lists and marks avatars with lazy loading', () => {
    const chats = Array.from({ length: 192 }, (_, idx) =>
      makeChat(`u-${idx}`, `https://example.com/avatar-${idx}.png`),
    );

    const view = render(
      <ChatList
        chats={chats}
        onSelectChat={() => undefined}
        isLoading={false}
      />,
    );

    const renderedItems = view.container.querySelectorAll('.tg-chat-item');
    expect(renderedItems.length).toBeGreaterThan(0);
    expect(renderedItems.length).toBeLessThan(30);

    const firstAvatarImg = view.container.querySelector('.tg-avatar-img') as HTMLImageElement | null;
    expect(firstAvatarImg).not.toBeNull();
    expect(firstAvatarImg?.getAttribute('loading')).toBe('lazy');
    expect(firstAvatarImg?.getAttribute('decoding')).toBe('async');
  });

  it('切换选中会话时仅唯一激活当前项指示条且不残留内联样式', () => {
    const chats = [makeChat('u1'), makeChat('u2'), makeChat('u3')];
    const view = render(
      <ChatList
        chats={chats}
        selectedChatId="u1"
        onSelectChat={() => undefined}
        isLoading={false}
      />,
    );

    const getItems = () => Array.from(view.container.querySelectorAll<HTMLButtonElement>('.tg-chat-item'));
    expect(view.container.querySelectorAll('.tg-chat-item.is-selected')).toHaveLength(1);
    expect(getItems()[0]).toHaveAttribute('aria-current', 'true');

    // 从 u1 切换至 u3，验证 u1 不残留 inline style，且全局仅有 u3 处于选中态
    view.rerender(
      <ChatList
        chats={chats}
        selectedChatId="u3"
        onSelectChat={() => undefined}
        isLoading={false}
      />,
    );

    const itemsAfter = getItems();
    expect(view.container.querySelectorAll('.tg-chat-item.is-selected')).toHaveLength(1);
    expect(itemsAfter[0].classList.contains('is-selected')).toBe(false);
    expect(itemsAfter[0]).not.toHaveAttribute('aria-current');
    expect(itemsAfter[0].querySelector('.tg-chat-item-selected-indicator')?.getAttribute('style')).toBeNull();
    expect(itemsAfter[2].classList.contains('is-selected')).toBe(true);
    expect(itemsAfter[2]).toHaveAttribute('aria-current', 'true');
  });
});
