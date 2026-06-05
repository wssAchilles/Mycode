import { describe, expect, it } from 'vitest';
import { shouldFallbackToHttpSend } from '../features/chat/store/messageUtils';

describe('message send fallback reasons', () => {
  it('falls back to HTTP when the worker send path is auth-blocked', () => {
    expect(shouldFallbackToHttpSend('AUTH_ERROR')).toBe(true);
    expect(shouldFallbackToHttpSend('NOT_INITED')).toBe(true);
    expect(shouldFallbackToHttpSend('NOT_AUTHENTICATED')).toBe(true);
  });
});
