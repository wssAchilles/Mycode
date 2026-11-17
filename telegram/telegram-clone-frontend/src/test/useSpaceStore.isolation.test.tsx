import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostData } from '../components/space';

const spaceApiMock = vi.hoisted(() => ({
  getFeed: vi.fn(),
  getTrends: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/spaceApi', () => ({
  spaceAPI: spaceApiMock,
}));

vi.mock('../services/newsApi', () => ({
  default: {
    getFeed: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

vi.mock('../hooks/useAnalytics', () => ({
  useAnalytics: () => ({
    trackSearchQuery: vi.fn(),
    trackHashtagClick: vi.fn(),
    trackImpression: vi.fn(),
    trackClick: vi.fn(),
    trackLike: vi.fn(),
    trackUnlike: vi.fn(),
    trackReply: vi.fn(),
    trackRepost: vi.fn(),
    trackUnrepost: vi.fn(),
    trackQuote: vi.fn(),
    trackShare: vi.fn(),
    trackProfileClick: vi.fn(),
    trackOpenLink: vi.fn(),
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
  }),
  useImpressionTracker: () => ({ current: null }),
  useDwellTracker: () => ({ current: null }),
}));

import { useSpaceStore } from '../stores/useSpaceStore';
import { SpaceExplore } from '../components/space/SpaceExplore';

function createMockPost(id: string, content: string): PostData {
  return {
    id,
    author: { id: `author-${id}`, username: `user_${id}` },
    content,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    likeCount: 0,
    commentCount: 0,
    repostCount: 0,
  };
}

function resetSpaceStore() {
  sessionStorage.clear();
  useSpaceStore.setState({
    posts: [],
    isLoadingFeed: false,
    hasMore: true,
    nextCursor: undefined,
    newPostsCount: 0,
    isMLEnhanced: false,
    inNetworkOnly: false,
    allFeed: {
      posts: [],
      isLoading: false,
      hasMore: true,
      nextCursor: undefined,
      error: null,
      hasLoaded: false,
      seenIds: [],
      servedIds: [],
    },
    friendsFeed: {
      posts: [],
      isLoading: false,
      hasMore: true,
      nextCursor: undefined,
      error: null,
      hasLoaded: false,
      seenIds: [],
      servedIds: [],
    },
    seenIds: [],
    servedIds: [],
    searchResults: [],
    isSearching: false,
    searchQuery: '',
    searchTotalCount: 0,
    searchHasMore: false,
    searchNextCursor: undefined,
    searchMode: 'search',
    searchTopicTag: undefined,
    isCreatingPost: false,
    error: null,
  });
}

describe('useSpaceStore feed scope caching & explore isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSpaceStore();
  });

  it('caches allFeed and friendsFeed separately without losing posts or duplicate fetching on tab switch', async () => {
    const allPosts = [createMockPost('all-1', '全站推荐动态')];
    const friendPosts = [createMockPost('friend-1', '好友专属动态')];

    spaceApiMock.getFeed.mockImplementation(async (_limit: number, _cursor?: string, opts?: { inNetworkOnly?: boolean }) => {
      if (opts?.inNetworkOnly) {
        return { posts: friendPosts, hasMore: false, nextCursor: undefined };
      }
      return { posts: allPosts, hasMore: false, nextCursor: undefined };
    });

    await useSpaceStore.getState().fetchFeed(true);
    expect(useSpaceStore.getState().posts).toEqual(allPosts);
    expect(spaceApiMock.getFeed).toHaveBeenCalledTimes(1);

    // 切换到“好友” Tab
    await useSpaceStore.getState().setInNetworkOnly(true);
    expect(useSpaceStore.getState().inNetworkOnly).toBe(true);
    expect(useSpaceStore.getState().posts).toEqual(friendPosts);
    expect(spaceApiMock.getFeed).toHaveBeenCalledTimes(2);
    expect(spaceApiMock.getFeed).toHaveBeenLastCalledWith(
      20,
      undefined,
      expect.objectContaining({ inNetworkOnly: true }),
    );

    // 切回“全部” Tab 时应直接复用缓存，不清空也不重复发起请求
    await useSpaceStore.getState().setInNetworkOnly(false);
    expect(useSpaceStore.getState().inNetworkOnly).toBe(false);
    expect(useSpaceStore.getState().posts).toEqual(allPosts);
    expect(spaceApiMock.getFeed).toHaveBeenCalledTimes(2);
  });

  it('keeps SpaceExplore recommend tab isolated from Home friends feed', async () => {
    const allPosts = [createMockPost('explore-1', '全站探索推荐帖')];
    const friendPosts = [createMockPost('friend-1', '好友动态帖')];

    spaceApiMock.getFeed.mockImplementation(async (_limit: number, _cursor?: string, opts?: { inNetworkOnly?: boolean }) => {
      if (opts?.inNetworkOnly) {
        return { posts: friendPosts, hasMore: false, nextCursor: undefined };
      }
      return { posts: allPosts, hasMore: false, nextCursor: undefined };
    });

    // 先在首页切换到“好友”（此时 allFeed 尚未加载）
    await useSpaceStore.getState().setInNetworkOnly(true);
    expect(useSpaceStore.getState().posts).toEqual(friendPosts);

    render(
      <MemoryRouter>
        <SpaceExplore
          onLike={vi.fn()}
          onUnlike={vi.fn()}
          onComment={vi.fn()}
          onRepost={vi.fn()}
          onUnrepost={vi.fn()}
          onQuote={vi.fn()}
          onShare={vi.fn()}
          onPostClick={vi.fn()}
        />
      </MemoryRouter>,
    );

    // 探索 -> 推荐应拉取 inNetworkOnly: false 的全站流，且不显示好友动态
    await waitFor(() => {
      expect(screen.getByText('全站探索推荐帖')).toBeInTheDocument();
    });
    expect(screen.queryByText('好友动态帖')).toBeNull();
    expect(useSpaceStore.getState().inNetworkOnly).toBe(true);
    expect(useSpaceStore.getState().posts).toEqual(friendPosts);
    expect(spaceApiMock.getFeed).toHaveBeenLastCalledWith(
      20,
      undefined,
      expect.objectContaining({ inNetworkOnly: false }),
    );
  });
});
