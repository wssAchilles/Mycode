import { describe, expect, it } from 'vitest';
import { createClientTempId, shouldFallbackToHttpSend, toHttpSendPayload } from '../features/chat/store/messageUtils';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('message send fallback reasons', () => {
  it('falls back to HTTP when the worker send path is auth-blocked or token expired', () => {
    expect(shouldFallbackToHttpSend('AUTH_ERROR')).toBe(true);
    expect(shouldFallbackToHttpSend('NOT_INITED')).toBe(true);
    expect(shouldFallbackToHttpSend('NOT_AUTHENTICATED')).toBe(true);
    expect(shouldFallbackToHttpSend('SOCKET_NOT_AUTHENTICATED')).toBe(true);
    expect(shouldFallbackToHttpSend('USER_NOT_AUTHENTICATED')).toBe(true);
    expect(shouldFallbackToHttpSend('upstream /api/messages/send returned 401 unauthorized')).toBe(true);
    expect(shouldFallbackToHttpSend('GROUP_MUTED')).toBe(false);
  });

  it('generates backend-compatible UUID client temp ids for HTTP fallback', () => {
    expect(createClientTempId()).toMatch(UUID_PATTERN);
  });

  it('keeps HTTP fallback payload compatible with the backend send schema', () => {
    const clientTempId = createClientTempId();

    expect(toHttpSendPayload({
      clientTempId,
      chatType: 'group',
      groupId: 'group-1',
      content: 'hello',
      type: 'text',
    })).toEqual(expect.objectContaining({
      clientTempId,
      chatType: 'group',
      groupId: 'group-1',
      content: 'hello',
      type: 'text',
    }));
  });
});
