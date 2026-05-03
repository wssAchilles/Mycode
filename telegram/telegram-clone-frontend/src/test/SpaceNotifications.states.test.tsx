import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceNotifications } from '../components/space/SpaceNotifications';
import { spaceAPI } from '../services/spaceApi';

vi.mock('../services/spaceApi', () => ({
  spaceAPI: {
    getNotifications: vi.fn(),
  },
}));

const mockedGetNotifications = vi.mocked(spaceAPI.getNotifications);

describe('SpaceNotifications states', () => {
  beforeEach(() => {
    mockedGetNotifications.mockReset();
  });

  it('shows a skeleton while the first notification page is loading', () => {
    mockedGetNotifications.mockReturnValue(new Promise(() => undefined));

    render(<SpaceNotifications onPostClick={vi.fn()} />);

    expect(screen.getByLabelText('通知加载中')).toBeInTheDocument();
  });

  it('shows a retryable error state when notifications fail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedGetNotifications
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ items: [], hasMore: false, nextCursor: undefined });

    render(<SpaceNotifications onPostClick={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('通知加载失败，请稍后重试');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(mockedGetNotifications).toHaveBeenCalledTimes(2));
    errorSpy.mockRestore();
  });
});
