import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpaceTimeline } from '../components/space/SpaceTimeline';
import type { SpaceTimelineProps } from '../components/space/SpaceTimeline';

vi.mock('../services/mlService', () => ({
  mlService: {
    vfCheckContent: vi.fn(),
  },
}));

vi.mock('../components/space/PostComposer', () => ({
  PostComposer: () => <div data-testid="post-composer" />,
}));

vi.mock('../components/space/NewsHomeSection', () => ({
  NewsHomeSection: () => <div data-testid="news-home-section" />,
}));

const baseProps = (overrides: Partial<SpaceTimelineProps> = {}): SpaceTimelineProps => ({
  posts: [],
  isLoading: false,
  hasMore: false,
  currentUser: { username: 'designer' },
  inNetworkOnly: true,
  onLoadMore: vi.fn(),
  onCreatePost: vi.fn(),
  onLike: vi.fn(),
  onUnlike: vi.fn(),
  onComment: vi.fn(),
  onRepost: vi.fn(),
  onShare: vi.fn(),
  onPostClick: vi.fn(),
  ...overrides,
});

describe('SpaceTimeline state handling', () => {
  it('shows a retryable error state when the feed request fails', () => {
    const onRetry = vi.fn();

    render(
      <SpaceTimeline
        {...baseProps({
          error: '网络不可用',
          onRetry,
        })}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('动态加载失败');
    expect(screen.getByRole('alert')).toHaveTextContent('网络不可用');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lets the empty following feed switch back to all posts', () => {
    const onInNetworkOnlyChange = vi.fn();

    render(
      <SpaceTimeline
        {...baseProps({
          onInNetworkOnlyChange,
        })}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('还没有好友动态');

    fireEvent.click(screen.getByRole('button', { name: '切回全部动态' }));

    expect(onInNetworkOnlyChange).toHaveBeenCalledWith(false);
  });
});
