import { describe, expect, it, vi } from 'vitest';

import { flushOfflineQueue, type QueuedMessage } from '../core/chat/offlineQueue';

function makeMsg(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: 'offline_1',
    chatId: 'chat-1',
    content: 'hello',
    senderId: 'u1',
    clientTempId: 'temp-1',
    chatType: 'private',
    receiverId: 'u2',
    vectorClock: { userId: 'u1', timestamp: 1 },
    createdAt: 1,
    retryCount: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('flushOfflineQueue', () => {
  it('sends pending messages and removes them on success', async () => {
    const pending = [makeMsg({ id: 'a' }), makeMsg({ id: 'b', clientTempId: 'temp-2' })];
    const markSent = vi.fn().mockResolvedValue(undefined);
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const markSending = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({ success: true, messageId: 'm1' });

    const result = await flushOfflineQueue(send, {
      list: async () => pending,
      markSending,
      markSent,
      markFailed,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(markSending).toHaveBeenCalledWith('a');
    expect(markSending).toHaveBeenCalledWith('b');
    expect(markSent).toHaveBeenCalledWith('a');
    expect(markSent).toHaveBeenCalledWith('b');
    expect(markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 2, sent: 2, failed: 0, remaining: 0 });
  });

  it('marks failure and continues with remaining messages', async () => {
    const pending = [
      makeMsg({ id: 'fail-1' }),
      makeMsg({ id: 'ok-1', clientTempId: 'temp-ok' }),
    ];
    const markSent = vi.fn().mockResolvedValue(undefined);
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockImplementation(async (msg: QueuedMessage) => {
      if (msg.id === 'fail-1') {
        return { success: false, error: 'NETWORK' };
      }
      return { success: true };
    });

    const result = await flushOfflineQueue(send, {
      list: async () => pending,
      markSending: async () => undefined,
      markSent,
      markFailed,
    });

    expect(markFailed).toHaveBeenCalledWith('fail-1');
    expect(markSent).toHaveBeenCalledWith('ok-1');
    expect(result).toEqual({ attempted: 2, sent: 1, failed: 1, remaining: 1 });
  });

  it('skips messages that exceeded maxRetryCount', async () => {
    const pending = [
      makeMsg({ id: 'exhausted', retryCount: 5, status: 'failed' }),
      makeMsg({ id: 'fresh', clientTempId: 'temp-fresh' }),
    ];
    const send = vi.fn().mockResolvedValue({ success: true });

    const result = await flushOfflineQueue(send, {
      list: async () => pending,
      markSending: async () => undefined,
      markSent: async () => undefined,
      markFailed: async () => undefined,
      maxRetryCount: 3,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].id).toBe('fresh');
    expect(result.attempted).toBe(1);
    expect(result.sent).toBe(1);
  });

  it('stops after maxMessages in one flush', async () => {
    const pending = Array.from({ length: 5 }, (_, i) =>
      makeMsg({ id: `m${i}`, clientTempId: `t${i}` }),
    );
    const send = vi.fn().mockResolvedValue({ success: true });

    const result = await flushOfflineQueue(send, {
      list: async () => pending,
      markSending: async () => undefined,
      markSent: async () => undefined,
      markFailed: async () => undefined,
      maxMessages: 2,
    });

    expect(result.attempted).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('treats thrown send errors as failures', async () => {
    const pending = [makeMsg({ id: 'throw' })];
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(new Error('boom'));

    const result = await flushOfflineQueue(send, {
      list: async () => pending,
      markSending: async () => undefined,
      markSent: async () => undefined,
      markFailed,
    });

    expect(markFailed).toHaveBeenCalledWith('throw');
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('is a no-op when the queue is empty', async () => {
    const send = vi.fn();
    const result = await flushOfflineQueue(send, {
      list: async () => [],
      markSending: async () => undefined,
      markSent: async () => undefined,
      markFailed: async () => undefined,
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, sent: 0, failed: 0, remaining: 0 });
  });
});
