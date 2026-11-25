import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostData } from '../components/space';

const spaceApiMock = vi.hoisted(() => ({
  getPost: vi.fn(),
  getComments: vi.fn(),
  createComment: vi.fn(),
  likePost: vi.fn(),
  unlikePost: vi.fn(),
  repostPost: vi.fn(),
  unrepostPost: vi.fn(),
  createPost: vi.fn(),
}));

vi.mock('../services/spaceApi', () => ({
  spaceAPI: spaceApiMock,
}));

vi.mock('../services/apiClient', () => ({
  authUtils: {
    getCurrentUser: () => ({ id: 'me-1', username: 'viewer', avatarUrl: null }),
  },
}));

vi.mock('../components/space', async () => {
  const actual = await vi.importActual<typeof import('../components/space')>('../components/space');
  return {
    ...actual,
    SpacePost: ({ post, onComment }: { post: PostData; onComment?: (postId: string) => void }) => (
      <div data-testid={`post-${post.id}`}>
        <span>{post.content}</span>
        <button type="button" onClick={() => onComment?.(post.id)}>
          聚焦评论框
        </button>
      </div>
    ),
  };
});

vi.mock('../components/ui/Toast', () => ({
  showToast: vi.fn(),
}));

import SpacePostDetailPage from '../pages/SpacePostDetailPage';

function makePost(commentCount: number = 1): PostData {
  return {
    id: 'post-100',
    author: {
      id: 'author-1',
      username: 'alice',
    },
    content: '这是一条测试动态正文',
    createdAt: new Date('2026-11-25T07:00:00.000Z'),
    likeCount: 12,
    commentCount,
    repostCount: 2,
  };
}

describe('SpacePostDetailPage 评论与回复布局', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spaceApiMock.getPost.mockResolvedValue(makePost(1));
  });

  it('渲染主贴、回复语境与评论列表，并支持点击回复按钮预填 @作者 并聚焦', async () => {
    spaceApiMock.getComments.mockResolvedValue({
      comments: [
        {
          id: 'c-1',
          postId: 'post-100',
          content: '很赞同这个优化方向',
          createdAt: new Date().toISOString(),
          likeCount: 0,
          author: { id: 'user-bob', username: 'bob' },
        },
      ],
      hasMore: false,
      nextCursor: undefined,
    });

    render(
      <MemoryRouter initialEntries={['/space/post/post-100']}>
        <Routes>
          <Route path="/space/post/:id" element={<SpacePostDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('这是一条测试动态正文')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('很赞同这个优化方向')).toBeInTheDocument();

    const replyBtn = screen.getByRole('button', { name: '回复 @bob' });
    fireEvent.click(replyBtn);

    const textarea = screen.getByLabelText('输入回复内容') as HTMLTextAreaElement;
    expect(textarea.value).toBe('@bob ');
    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
  });

  it('支持空评论引导态以及 Ctrl+Enter 与按钮提交评论后更新计数', async () => {
    spaceApiMock.getPost.mockResolvedValue(makePost(0));
    spaceApiMock.getComments.mockResolvedValue({
      comments: [],
      hasMore: false,
      nextCursor: undefined,
    });
    spaceApiMock.createComment
      .mockResolvedValueOnce({
        id: 'c-new-1',
        postId: 'post-100',
        content: '第一条快捷键回复',
        createdAt: new Date().toISOString(),
        likeCount: 0,
        author: { id: 'me-1', username: 'viewer' },
      })
      .mockResolvedValueOnce({
        id: 'c-new-2',
        postId: 'post-100',
        content: '第二条按钮回复',
        createdAt: new Date().toISOString(),
        likeCount: 0,
        author: { id: 'me-1', username: 'viewer' },
      });

    render(
      <MemoryRouter initialEntries={['/space/post/post-100']}>
        <Routes>
          <Route path="/space/post/:id" element={<SpacePostDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('还没有回复')).toBeInTheDocument();

    const textarea = screen.getByLabelText('输入回复内容');
    fireEvent.change(textarea, { target: { value: '第一条快捷键回复' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(await screen.findByText('第一条快捷键回复')).toBeInTheDocument();
    expect(spaceApiMock.createComment).toHaveBeenCalledWith('post-100', '第一条快捷键回复');
    expect(screen.getByText('1 条回复')).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: '第二条按钮回复' } });
    const submitButton = screen.getByRole('button', { name: '回复' });
    fireEvent.click(submitButton);

    expect(await screen.findByText('第二条按钮回复')).toBeInTheDocument();
    expect(spaceApiMock.createComment).toHaveBeenCalledWith('post-100', '第二条按钮回复');
    expect(screen.getByText('2 条回复')).toBeInTheDocument();
  });
});
