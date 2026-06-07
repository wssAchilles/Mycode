import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpacePost, type PostData } from '../components/space/SpacePost';
import { SpaceExplore } from '../components/space/SpaceExplore';

const analyticsMocks = vi.hoisted(() => ({
  trackProfileClick: vi.fn(),
  trackOpenLink: vi.fn(),
  trackSearchQuery: vi.fn(),
  trackHashtagClick: vi.fn(),
  trackImpression: vi.fn(),
  trackClick: vi.fn(),
  trackLike: vi.fn(),
  trackUnlike: vi.fn(),
  trackReply: vi.fn(),
  trackRepost: vi.fn(),
  trackUnrepost: vi.fn(),
  trackShare: vi.fn(),
  trackDismiss: vi.fn(),
  trackHide: vi.fn(),
  trackReport: vi.fn(),
  trackBlock: vi.fn(),
  trackMute: vi.fn(),
  trackFollow: vi.fn(),
  trackUnfollow: vi.fn(),
  trackDwell: vi.fn(),
  trackScroll: vi.fn(),
  flush: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  markSeen: vi.fn(),
  searchPosts: vi.fn(),
  searchTopicPosts: vi.fn(),
  fetchFeed: vi.fn(),
  clearSearch: vi.fn(),
  loadMoreSearchResults: vi.fn(),
}));

vi.mock('../hooks/useAnalytics', () => ({
  useAnalytics: () => analyticsMocks,
  useImpressionTracker: () => ({ current: null }),
  useDwellTracker: () => ({ current: null }),
}));

vi.mock('../stores', () => ({
  useSpaceStore: (selector: any) => selector({
    markSeen: storeMocks.markSeen,
    searchResults: [],
    isSearching: false,
    searchQuery: '',
    searchTotalCount: 0,
    searchHasMore: false,
    searchMode: 'search',
    searchTopicTag: undefined,
    searchPosts: storeMocks.searchPosts,
    searchTopicPosts: storeMocks.searchTopicPosts,
    loadMoreSearchResults: storeMocks.loadMoreSearchResults,
    clearSearch: storeMocks.clearSearch,
    posts: [],
    isLoadingFeed: false,
    fetchFeed: storeMocks.fetchFeed,
    error: null,
  }),
}));

vi.mock('../services/spaceApi', () => ({
  spaceAPI: {
    getTrends: vi.fn().mockResolvedValue([{ tag: 'Growth', count: 7 }]),
  },
}));

vi.mock('../services/newsApi', () => ({
  default: {
    getFeed: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

function makePost(overrides: Partial<PostData> = {}): PostData {
  return {
    id: '65f000000000000000000001',
    author: {
      id: 'author-1',
      username: 'demo_author',
    },
    content: 'Read [the docs](https://example.com/recsys).',
    createdAt: new Date('2026-06-06T00:00:00.000Z'),
    likeCount: 0,
    commentCount: 0,
    repostCount: 0,
    recommendationRequestId: 'req-1',
    recommendationRank: 2,
    recommendationScore: 0.42,
    ...overrides,
  };
}

describe('Space behavior analytics entrypoints', () => {
  beforeEach(() => {
    for (const value of Object.values(analyticsMocks)) {
      if (typeof value === 'function') value.mockClear();
    }
    for (const value of Object.values(storeMocks)) {
      value.mockClear();
    }
  });

  const renderExplore = () => render(
    <MemoryRouter>
      <SpaceExplore
        onLike={vi.fn()}
        onUnlike={vi.fn()}
        onComment={vi.fn()}
        onRepost={vi.fn()}
        onShare={vi.fn()}
        onPostClick={vi.fn()}
      />
    </MemoryRouter>,
  );

  it('tracks profile clicks from SpacePost author controls', () => {
    render(<SpacePost post={makePost()} />);

    fireEvent.click(screen.getByRole('button', { name: /查看 demo_author 的主页/i }));

    expect(analyticsMocks.trackProfileClick).toHaveBeenCalledWith(
      '65f000000000000000000001',
      'author-1',
      expect.objectContaining({
        requestId: 'req-1',
        position: 1,
        recommendationScore: 0.42,
      }),
    );
  });

  it('tracks external link opens from SpacePost markdown content', () => {
    render(<SpacePost post={makePost()} />);

    fireEvent.click(screen.getByRole('link', { name: 'the docs' }));

    expect(analyticsMocks.trackOpenLink).toHaveBeenCalledWith(
      '65f000000000000000000001',
      'https://example.com/recsys',
      expect.objectContaining({
        authorId: 'author-1',
        requestId: 'req-1',
      }),
    );
  });

  it('tracks search queries from SpaceExplore submit', () => {
    renderExplore();

    fireEvent.change(screen.getByLabelText('搜索 Space 动态'), {
      target: { value: 'recsys ranking' },
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(analyticsMocks.trackSearchQuery).toHaveBeenCalledWith(
      'recsys ranking',
      { productSurface: 'explore' },
    );
    expect(storeMocks.searchPosts).toHaveBeenCalledWith('recsys ranking');
  });

  it('tracks topic chip clicks from SpaceExplore trends', async () => {
    renderExplore();

    fireEvent.click(screen.getByRole('tab', { name: '话题' }));
    const chip = await screen.findByRole('button', { name: /Growth/i });
    fireEvent.click(chip);

    await waitFor(() => {
      expect(analyticsMocks.trackHashtagClick).toHaveBeenCalledWith(
        'Growth',
        { productSurface: 'explore' },
      );
    });
    expect(storeMocks.searchTopicPosts).toHaveBeenCalledWith('Growth');
  });
});
