import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsHomeSection } from '../components/space/NewsHomeSection';
import newsApi from '../services/newsApi';

vi.mock('../services/newsApi', () => ({
  default: {
    getFeed: vi.fn(),
    trackEvent: vi.fn(),
  },
}));

const mockedGetFeed = vi.mocked(newsApi.getFeed);

const renderSection = () => render(
  <MemoryRouter>
    <NewsHomeSection />
  </MemoryRouter>
);

type FeedResponse = Awaited<ReturnType<typeof newsApi.getFeed>>;
type LoadedNewsFeedItem = FeedResponse['items'][number];

const feedItem: LoadedNewsFeedItem = {
  id: 'n-1',
  title: 'A compact news card',
  summary: 'News summary',
  source: 'npr_world',
  publishedAt: '2026-05-01T08:00:00.000Z',
  coverImageUrl: null,
};

const feedResponse = (items: LoadedNewsFeedItem[]): FeedResponse => ({
  items,
  nextCursor: undefined,
  hasMore: false,
  window: undefined,
  windowStart: undefined,
  windowEnd: undefined,
  windowKey: undefined,
});

describe('NewsHomeSection states', () => {
  beforeEach(() => {
    mockedGetFeed.mockReset();
  });

  it('keeps a visible retry state when the daily news request fails', async () => {
    mockedGetFeed
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(feedResponse([feedItem]));

    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('新闻加载失败');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('button', { name: /打开新闻：A compact news card/ })).toBeInTheDocument();
    expect(mockedGetFeed).toHaveBeenCalledTimes(2);
  });

  it('renders loaded news as keyboard-focusable buttons', async () => {
    mockedGetFeed.mockResolvedValue(
      feedResponse([
        feedItem,
        { ...feedItem, id: 'n-2', title: 'Second compact card' },
      ])
    );

    renderSection();

    expect(await screen.findByRole('button', { name: /打开新闻：A compact news card/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开新闻：Second compact card/ })).toBeInTheDocument();
  });
});
