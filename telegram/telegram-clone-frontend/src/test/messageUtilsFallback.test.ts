import { describe, expect, it } from 'vitest';
import { createClientTempId, shouldFallbackToHttpSend, toHttpSendPayload } from '../features/chat/store/messageUtils';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('message send fallback reasons', () => {
  it('falls back to HTTP when the worker send path is auth-blocked', () => {
    expect(shouldFallbackToHttpSend('AUTH_ERROR')).toBe(true);
    expect(shouldFallbackToHttpSend('NOT_INITED')).toBe(true);
    expect(shouldFallbackToHttpSend('NOT_AUTHENTICATED')).toBe(true);
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
