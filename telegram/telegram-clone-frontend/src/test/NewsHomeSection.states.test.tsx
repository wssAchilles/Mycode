import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsHomeSection } from '../components/space/NewsHomeSection';
import { spaceAPI, type NewsBriefItem } from '../services/spaceApi';

vi.mock('../hooks/useAnalytics', () => ({
  useAnalytics: () => ({
    trackImpression: vi.fn(),
    trackDwell: vi.fn(),
    trackClick: vi.fn(),
  }),
}));

vi.mock('../services/spaceApi', () => ({
  spaceAPI: {
    getNewsBrief: vi.fn(),
    getPost: vi.fn(),
  },
}));

const mockedGetNewsBrief = vi.mocked(spaceAPI.getNewsBrief);

const renderSection = () => render(
  <MemoryRouter>
    <NewsHomeSection />
  </MemoryRouter>
);

const feedItem: NewsBriefItem = {
  postId: 'p-1',
  title: 'A compact news card',
  summary: 'News summary',
  source: 'npr_world',
  createdAt: '2026-05-01T08:00:00.000Z',
  coverUrl: undefined,
};

describe('NewsHomeSection states', () => {
  beforeEach(() => {
    mockedGetNewsBrief.mockReset();
  });

  it('keeps a visible retry state when the daily news request fails', async () => {
    mockedGetNewsBrief
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([feedItem]);

    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('新闻加载失败');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('button', { name: /打开新闻：A compact news card/ })).toBeInTheDocument();
    expect(mockedGetNewsBrief).toHaveBeenCalledTimes(2);
  });

  it('renders loaded news as keyboard-focusable buttons', async () => {
    mockedGetNewsBrief.mockResolvedValue([
      feedItem,
      { ...feedItem, postId: 'p-2', title: 'Second compact card' },
    ]);

    renderSection();

    expect(await screen.findByRole('button', { name: /打开新闻：A compact news card/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开新闻：Second compact card/ })).toBeInTheDocument();
  });
});
