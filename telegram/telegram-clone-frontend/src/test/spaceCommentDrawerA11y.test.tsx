import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpaceCommentDrawer } from '../components/space/SpaceCommentDrawer';
import type { PostData } from '../components/space/SpacePost';

const spaceApiMocks = vi.hoisted(() => ({
  getComments: vi.fn(),
  createComment: vi.fn(),
}));

vi.mock('../services/spaceApi', () => ({
  spaceAPI: {
    getComments: spaceApiMocks.getComments,
    createComment: spaceApiMocks.createComment,
  },
}));

function mockReducedMotion(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function makePost(): PostData {
  return {
    id: 'post-1',
    author: {
      id: 'author-1',
      username: 'alice',
    },
    content: 'hello space',
    createdAt: new Date('2026-06-06T00:00:00.000Z'),
    likeCount: 0,
    commentCount: 0,
    repostCount: 0,
  };
}

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开评论
      </button>
      <a href="/outside">外部链接</a>
      <SpaceCommentDrawer open={open} post={open ? makePost() : null} onClose={() => setOpen(false)} />
    </>
  );
}

describe('SpaceCommentDrawer accessibility', () => {
  beforeEach(() => {
    mockReducedMotion(true);
    spaceApiMocks.getComments.mockResolvedValue({ comments: [], hasMore: false, nextCursor: undefined });
    spaceApiMocks.createComment.mockResolvedValue({
      id: 'comment-1',
      content: 'hello',
      createdAt: new Date().toISOString(),
      author: { id: 'user-1', username: 'bob' },
    });
  });

  it('renders a modal dialog and focuses the composer on open', async () => {
    render(<DrawerHarness />);

    fireEvent.click(screen.getByRole('button', { name: '打开评论' }));

    expect(await screen.findByRole('dialog', { name: '评论' })).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => {
      expect(screen.getByLabelText('输入评论内容')).toHaveFocus();
    });
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: '打开评论' });

    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: '评论' });

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '评论' })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('keeps Tab focus inside the drawer', async () => {
    render(<DrawerHarness />);

    fireEvent.click(screen.getByRole('button', { name: '打开评论' }));
    await screen.findByRole('dialog', { name: '评论' });

    const closeButton = screen.getByRole('button', { name: '关闭评论' });
    const textarea = screen.getByLabelText('输入评论内容');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    const submitButton = screen.getByRole('button', { name: '发送' });

    closeButton.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(submitButton).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    textarea.focus();
    expect(textarea).toHaveFocus();
  });
});
