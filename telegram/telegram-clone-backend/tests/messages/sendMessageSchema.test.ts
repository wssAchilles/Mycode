import { describe, expect, it } from 'vitest';
import { sendMessageSchema } from '../../src/schemas/messageSchemas';

describe('sendMessageSchema', () => {
  it('accepts frontend string message types for HTTP send fallback', () => {
    const parsed = sendMessageSchema.parse({
      chatType: 'group',
      groupId: 'group-1',
      content: 'hello',
      type: 'text',
      clientTempId: '00000000-0000-4000-8000-000000000000',
    });

    expect(parsed.type).toBe('text');
  });

  it('rejects numeric message types because the message model stores type strings', () => {
    expect(() => sendMessageSchema.parse({
      chatType: 'private',
      receiverId: 'user-2',
      content: 'hello',
      type: 1,
    })).toThrow();
  });
});
