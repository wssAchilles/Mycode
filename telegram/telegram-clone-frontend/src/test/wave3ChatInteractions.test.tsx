import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderChatRichText } from '../features/chat/components/history/richTextRender';
import GroupDetailPanel from '../pages/chat/GroupDetailPanel';
import { useChatUiPrefsStore } from '../features/chat/state/chatUiPrefsStore';
import { useChatStore, type Group } from '../features/chat/store/chatStore';

vi.mock('../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/apiClient')>();
  return {
    ...actual,
    authUtils: {
      ...actual.authUtils,
      getCurrentUser: () => ({ id: 'u-1', username: 'alice', email: 'alice@example.com' }),
    },
    groupAPI: {
      ...actual.groupAPI,
      getGroupDetails: vi.fn().mockResolvedValue(null),
    },
  };
});

describe('Wave 3 聊天富文本与群免打扰同步', () => {
  beforeEach(() => {
    localStorage.clear();
    useChatUiPrefsStore.setState({
      activeUserId: 'u-1',
      draftByChatId: {},
      pinnedChatIds: [],
      mutedChatIds: [],
      desktopNotifyEnabled: false,
      soundEnabled: true,
    });
  });

  it('支持 URL、行内代码、代码块、@self 提及与搜索词高亮共存', () => {
    const content = '请 @alice 查看 https://example.com/docs?q=1 和 `npm test` 以及\n```ts\nconst ok = true;\n```';
    const node = renderChatRichText(content, {
      messageId: 'm-1',
      currentUsername: 'alice',
      highlightConfig: {
        termLower: 'test',
        regex: /(test)/gi,
      },
    });

    const { container } = render(<div>{node}</div>);
    const link = container.querySelector('a.tg-chat-link') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.href).toBe('https://example.com/docs?q=1');
    expect(link?.target).toBe('_blank');

    const mention = container.querySelector('.tg-chat-mention.is-self');
    expect(mention?.textContent).toBe('@alice');

    const inlineCode = container.querySelector('code.tg-chat-inline-code');
    expect(inlineCode?.textContent).toBe('npm test');
    expect(inlineCode?.querySelector('mark.tg-highlight')?.textContent).toBe('test');

    const codeBlock = container.querySelector('pre.tg-chat-code-block code');
    expect(codeBlock?.textContent).toContain('const ok = true;');
  });

  it('GroupDetailPanel 的免打扰开关直接同步 useChatUiPrefsStore', () => {
    const group: Group = {
      id: 'g-100',
      name: '核心研发群',
      ownerId: 'u-1',
      type: 'public',
      maxMembers: 200,
      memberCount: 2,
      members: [
        { userId: 'u-1', username: 'alice', role: 'owner', isOnline: true },
        { userId: 'u-2', username: 'bob', role: 'member', isOnline: false },
      ],
      createdAt: '2026-01-01T00:00:00Z',
    };

    useChatStore.setState({ contacts: [] });

    render(
      <GroupDetailPanel
        isOpen
        onClose={vi.fn()}
        group={group}
      />,
    );

    const muteBtn = screen.getByRole('button', { name: '消息通知' });
    fireEvent.click(muteBtn);

    expect(useChatUiPrefsStore.getState().mutedChatIds).toContain('g-100');
    expect(screen.getByRole('button', { name: '已静音' })).toBeInTheDocument();
  });
});
