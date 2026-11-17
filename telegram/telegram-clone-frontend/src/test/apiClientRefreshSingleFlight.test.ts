import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

const authStorageMock = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => string | null>(),
  getRefreshToken: vi.fn<() => string | null>(),
  setTokens: vi.fn<(accessToken: string, refreshToken: string) => void>(),
  clear: vi.fn<() => void>(),
}));

vi.mock('../utils/authStorage', () => ({
  AUTH_TOKENS_UPDATED_EVENT: 'auth:tokens-updated',
  authStorage: authStorageMock,
}));

import apiClient from '../services/apiClient';

describe('apiClient 401 refresh single-flight lock', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    authStorageMock.getAccessToken.mockReturnValue('expired-access-token');
    authStorageMock.getRefreshToken.mockReturnValue('valid-refresh-token');

    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/space' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('deduplicates concurrent 401 refreshes, emits auth:tokens-updated, and retries all requests', async () => {
    let resolveRefresh!: (value: unknown) => void;
    const refreshDeferred = new Promise((resolve) => {
      resolveRefresh = resolve;
    });

    const postSpy = vi.spyOn(axios, 'post').mockReturnValue(refreshDeferred as never);

    // 模拟适配器：首次携带过期 token 返回 401，刷新后携带新 token 返回 200
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const authHeader = config.headers?.Authorization ?? config.headers?.get?.('Authorization');
      if (authHeader === 'Bearer fresh-access-token') {
        return {
          data: { ok: true, url: config.url },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }

      throw new AxiosError(
        'Unauthorized',
        'ERR_BAD_REQUEST',
        config,
        {},
        {
          data: { message: 'token expired' },
          status: 401,
          statusText: 'Unauthorized',
          headers: new AxiosHeaders(),
          config,
        },
      );
    };

    const tokensUpdatedListener = vi.fn();
    window.addEventListener('auth:tokens-updated', tokensUpdatedListener);

    const req1 = apiClient.get('/api/space/feed');
    const req2 = apiClient.get('/api/users/me');
    const req3 = apiClient.get('/api/contacts');

    // 等待三个请求都进入 401 响应拦截器
    await vi.waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    // 模拟刷新成功并轮换新 token
    authStorageMock.getAccessToken.mockReturnValue('fresh-access-token');
    resolveRefresh({
      data: {
        success: true,
        data: {
          tokens: {
            accessToken: 'fresh-access-token',
            refreshToken: 'fresh-refresh-token',
          },
        },
      },
    });

    const [res1, res2, res3] = await Promise.all([req1, req2, req3]);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(authStorageMock.setTokens).toHaveBeenCalledTimes(1);
    expect(authStorageMock.setTokens).toHaveBeenCalledWith('fresh-access-token', 'fresh-refresh-token');
    expect(tokensUpdatedListener).toHaveBeenCalledTimes(1);
    const dispatched = tokensUpdatedListener.mock.calls[0]?.[0] as CustomEvent;
    expect(dispatched.detail).toEqual({
      accessToken: 'fresh-access-token',
      refreshToken: 'fresh-refresh-token',
    });

    expect(res1.data).toEqual({ ok: true, url: '/api/space/feed' });
    expect(res2.data).toEqual({ ok: true, url: '/api/users/me' });
    expect(res3.data).toEqual({ ok: true, url: '/api/contacts' });
    expect(authStorageMock.clear).not.toHaveBeenCalled();

    window.removeEventListener('auth:tokens-updated', tokensUpdatedListener);
  });

  it('clears storage and redirects once when the shared refresh request fails', async () => {
    let rejectRefresh!: (reason?: unknown) => void;
    const refreshDeferred = new Promise((_, reject) => {
      rejectRefresh = reject;
    });

    const postSpy = vi.spyOn(axios, 'post').mockReturnValue(refreshDeferred as never);

    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      throw new AxiosError(
        'Unauthorized',
        'ERR_BAD_REQUEST',
        config,
        {},
        {
          data: { message: 'token expired' },
          status: 401,
          statusText: 'Unauthorized',
          headers: new AxiosHeaders(),
          config,
        },
      );
    };

    const req1 = apiClient.get('/api/space/feed');
    const req2 = apiClient.get('/api/users/me');

    await vi.waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    rejectRefresh(new Error('refresh token revoked'));

    await expect(req1).rejects.toThrow('refresh token revoked');
    await expect(req2).rejects.toThrow('refresh token revoked');

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(authStorageMock.clear).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/login');
  });
});
