import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AiConversationList from '../components/AiConversationList';

const storeMocks = vi.hoisted(() => ({
  loadConversations: vi.fn(),
  selectConversation: vi.fn(),
  createNewConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock('../features/chat/store/aiChatStore', () => ({
  useAiChatStore: () => ({
    conversations: [
      {
        conversationId: 'conv-1',
        title: 'Project Alpha',
        updatedAt: '2026-06-06T06:00:00.000Z',
        messages: [
          {
            id: 'm-1',
            role: 'user',
            content: 'hello',
            timestamp: '2026-06-06T06:00:00.000Z',
            type: 'text',
          },
        ],
      },
    ],
    activeConversationId: 'conv-1',
    isLoadingConversations: false,
    loadConversations: storeMocks.loadConversations,
    selectConversation: storeMocks.selectConversation,
    createNewConversation: storeMocks.createNewConversation,
    deleteConversation: storeMocks.deleteConversation,
  }),
}));

describe('AiConversationList accessibility', () => {
  beforeEach(() => {
    Object.values(storeMocks).forEach((mock) => mock.mockReset());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('uses list semantics with separate native buttons for open and delete', () => {
    render(<AiConversationList />);

    expect(screen.getByRole('list', { name: 'AI 对话历史' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(document.querySelector('[role="button"]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除会话 Project Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话 Project Alpha' })).toHaveAttribute('aria-current', 'true');
  });

  it('keeps delete action independent from conversation selection', async () => {
    render(<AiConversationList />);

    fireEvent.click(screen.getByRole('button', { name: '删除会话 Project Alpha' }));

    await waitFor(() => {
      expect(storeMocks.deleteConversation).toHaveBeenCalledWith('conv-1');
    });
    expect(storeMocks.selectConversation).not.toHaveBeenCalled();
  });

  it('opens a conversation through the native button', () => {
    render(<AiConversationList />);

    fireEvent.click(screen.getByRole('button', { name: '打开会话 Project Alpha' }));

    expect(storeMocks.selectConversation).toHaveBeenCalledWith('conv-1');
  });
});
