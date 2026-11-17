import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostData } from '../components/space';

const spaceApiMock = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  getUserPosts: vi.fn(),
  getUserLikes: vi.fn(),
  getUserNegativeFeedback: vi.fn(),
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
  default: { put: vi.fn() },
  authUtils: {
    getCurrentUser: () => ({ id: 'user-1', username: 'alice' }),
  },
}));

vi.mock('../components/space', () => ({
  SpacePost: ({ post }: { post: PostData }) => <div data-testid={`post-${post.id}`}>{post.content}</div>,
  SpaceCommentDrawer: () => null,
}));

vi.mock('../components/space/NegativeFeedbackPanel', () => ({
  default: () => <div data-testid="negative-feedback-panel" />,
}));

vi.mock('../components/ui/Toast', () => ({
  showToast: vi.fn(),
}));

import SpaceProfilePage from '../pages/SpaceProfilePage';

describe('SpaceProfilePage likes error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spaceApiMock.getUserProfile.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      displayName: 'Alice',
      isFollowed: false,
      stats: { posts: 1, followers: 2, following: 3 },
      pinnedPost: null,
    });
    spaceApiMock.getUserPosts.mockResolvedValue({
      posts: [],
      hasMore: false,
      nextCursor: undefined,
    });
  });

  it('renders error state with retry button when likes fail to load and recovers on retry', async () => {
    const likedPost: PostData = {
      id: 'like-1',
      author: { id: 'author-2', username: 'bob' },
      content: '一条被点赞的精彩动态',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      likeCount: 5,
      commentCount: 0,
      repostCount: 0,
      isLiked: true,
    };

    spaceApiMock.getUserLikes
      .mockRejectedValueOnce(new Error('服务器 500 错误'))
      .mockResolvedValueOnce({
        posts: [likedPost],
        hasMore: false,
        nextCursor: undefined,
      });

    render(
      <MemoryRouter initialEntries={['/space/user/user-1']}>
        <Routes>
          <Route path="/space/user/:id" element={<SpaceProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );

    const likesTab = await screen.findByRole('button', { name: '喜欢' });
    fireEvent.click(likesTab);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('喜欢列表加载失败');
    expect(alert).toHaveTextContent('服务器 500 错误');
    expect(screen.queryByText('还没有喜欢内容')).toBeNull();

    const retryButton = screen.getByRole('button', { name: '点击重试' });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('一条被点赞的精彩动态')).toBeInTheDocument();
    });
    expect(spaceApiMock.getUserLikes).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
