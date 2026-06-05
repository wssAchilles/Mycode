import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChatList from '../features/chat/components/ChatList';
import type { ChatSummary } from '../features/chat/types';

const makeChat = (id: string): ChatSummary => ({
  id,
  title: `chat-${id}`,
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
});
