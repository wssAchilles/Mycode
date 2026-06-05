import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageHandler } from '../../src/services/socket/messageHandler';

vi.mock('../../src/config/db', () => ({
  waitForMongoReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/messageWriteService', () => ({
  createAndFanoutMessage: vi.fn().mockResolvedValue({
    message: {
      _id: { toString: () => 'msg-1' },
      chatId: 'g:group-1',
      chatType: 'group',
      seq: 7,
      content: 'hello',
      sender: 'user-1',
      receiver: 'group-1',
      timestamp: new Date(),
      type: 'text',
      status: 'delivered',
    },
  }),
}));

vi.mock('../../src/services/realtimeProtocol/displayPlaneContract', () => ({
  buildRoomMessageDisplayEnvelope: vi.fn().mockReturnValue({ type: 'text' }),
  publishRoomMessageDisplay: vi.fn(),
}));

vi.mock('../../src/services/chatRuntimeMetrics', () => ({
  chatRuntimeMetrics: {
    increment: vi.fn(),
    observeDuration: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const createSocket = () => ({
  data: { userId: 'user-1', username: 'sender' },
  emit: vi.fn(),
});

describe('MessageHandler send path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid normal messages instead of returning a false success', async () => {
    const handler = new MessageHandler({ handleAiMessage: vi.fn() });
    const socket = createSocket();

    await expect(handler.handleMessage(socket as any, {
      chatType: 'group',
      content: 'hello',
    })).rejects.toThrow('groupId 不能为空');
  });

  it('passes clientTempId and string message type to the write service', async () => {
    const { createAndFanoutMessage } = await import('../../src/services/messageWriteService');
    const handler = new MessageHandler({ handleAiMessage: vi.fn() });
    const socket = createSocket();

    const result = await handler.handleMessage(socket as any, {
      chatType: 'group',
      groupId: 'group-1',
      content: 'hello',
      type: 'text',
      clientTempId: '00000000-0000-4000-8000-000000000000',
    });

    expect(result?.seq).toBe(7);
    expect(createAndFanoutMessage).toHaveBeenCalledWith(expect.objectContaining({
      clientTempId: '00000000-0000-4000-8000-000000000000',
      type: 'text',
    }));
  });

  it('does not republish realtime display events for duplicate clientTempId writes', async () => {
    const { createAndFanoutMessage } = await import('../../src/services/messageWriteService');
    const { publishRoomMessageDisplay } = await import('../../src/services/realtimeProtocol/displayPlaneContract');
    (createAndFanoutMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      isDuplicate: true,
      message: {
        _id: { toString: () => 'msg-1' },
        chatId: 'g:group-1',
        chatType: 'group',
        seq: 7,
        content: 'hello',
        sender: 'user-1',
        receiver: 'group-1',
        timestamp: new Date(),
        type: 'text',
        status: 'delivered',
      },
    });
    const handler = new MessageHandler({ handleAiMessage: vi.fn() });
    const socket = createSocket();

    await handler.handleMessage(socket as any, {
      chatType: 'group',
      groupId: 'group-1',
      content: 'hello',
      type: 'text',
      clientTempId: '00000000-0000-4000-8000-000000000000',
    });

    expect(publishRoomMessageDisplay).not.toHaveBeenCalled();
  });
});
