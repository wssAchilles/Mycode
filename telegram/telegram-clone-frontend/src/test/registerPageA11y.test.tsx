import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RegisterPage from '../pages/RegisterPage';

const authMocks = vi.hoisted(() => ({
  register: vi.fn(),
}));

vi.mock('../services/apiClient', () => ({
  authAPI: {
    register: authMocks.register,
  },
  authUtils: {
    isAuthenticated: () => false,
    getAccessToken: () => null,
    setAuth: vi.fn(),
  },
}));

describe('RegisterPage accessibility', () => {
  beforeEach(() => {
    authMocks.register.mockReset();
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

  it('announces validation errors through alert semantics', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请输入用户名');
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it('relies on native form submit for Enter key submission', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    fireEvent.keyPress(screen.getByLabelText('用户名 *'), { key: 'Enter', code: 'Enter', charCode: 13 });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(authMocks.register).not.toHaveBeenCalled();
  });
});
