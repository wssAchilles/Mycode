import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_TOKENS_UPDATED_EVENT,
  authStorage,
  type AuthTokensUpdatedDetail,
} from '../utils/authStorage';

describe('authStorage token refresh events', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('emits a browser event when refreshed tokens are stored', () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_TOKENS_UPDATED_EVENT, listener);

    authStorage.setTokens('next-access', 'next-refresh');

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<AuthTokensUpdatedDetail>;
    expect(event.detail).toEqual({
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
    });

    window.removeEventListener(AUTH_TOKENS_UPDATED_EVENT, listener);
  });
});
