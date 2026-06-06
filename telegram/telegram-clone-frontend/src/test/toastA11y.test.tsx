import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showToast } from '../components/ui/Toast';

describe('Toast accessibility', () => {
  beforeEach(() => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    document.querySelector('.tg-toast-container')?.remove();
  });

  it('announces success and info toasts politely', async () => {
    act(() => {
      showToast('保存成功', 'success', 20);
    });

    const toast = await screen.findByRole('status');
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast).toHaveAttribute('aria-atomic', 'true');
    expect(toast).toHaveTextContent('保存成功');

    await waitFor(() => {
      expect(screen.queryByText('保存成功')).not.toBeInTheDocument();
    });
  });

  it('announces error toasts assertively', async () => {
    act(() => {
      showToast('发送失败', 'error', 1000);
    });

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
    expect(toast).toHaveAttribute('aria-atomic', 'true');
    expect(toast).toHaveTextContent('发送失败');
  });
});
