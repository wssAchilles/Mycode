import { describe, expect, it, vi } from 'vitest';

import { buildMessageFanoutCommand } from '../../src/services/chatDelivery/fanoutPlanner';
import { ChatFanoutCommandBus } from '../../src/services/chatDelivery/fanoutCommandBus';
import { projectMessageFanoutCommand } from '../../src/services/chatDelivery/deliveryProjector';

describe('chat delivery pipeline', () => {
  it('builds a deduped fanout command and removes the sender from recipients', () => {
    const command = buildMessageFanoutCommand({
      messageId: 'msg-1',
      chatId: 'p:user-1:user-2',
      chatType: 'private',
      seq: 42,
      senderId: 'user-1',
      recipientIds: ['user-1', 'user-2', 'user-2', 'user-3'],
      topology: 'eager',
    });

    expect(command.recipientIds).toEqual(['user-2', 'user-3']);
    expect(command.metadata.topology).toBe('eager');
  });

  it('projects member-state and sync updates in bounded chunks', async () => {
    const bulkWrite = vi.fn().mockResolvedValue(undefined);
    const appendUpdates = vi.fn().mockResolvedValue(undefined);

    const result = await projectMessageFanoutCommand(
      buildMessageFanoutCommand({
        messageId: 'msg-2',
        chatId: 'g:group-1',
        chatType: 'group',
        seq: 9,
        senderId: 'user-1',
        recipientIds: ['user-2', 'user-3', 'user-4'],
      }),
      {
        chunkSize: 2,
        memberStateStore: { bulkWrite },
        syncAppender: { appendUpdates },
      },
    );

    expect(result.recipientCount).toBe(3);
    expect(result.chunkCount).toBe(2);
    expect(bulkWrite).toHaveBeenCalledTimes(2);
    expect(appendUpdates).toHaveBeenCalledTimes(2);
    expect(appendUpdates).toHaveBeenNthCalledWith(
      1,
      ['user-2', 'user-3'],
      expect.objectContaining({
        type: 'message',
        chatId: 'g:group-1',
        seq: 9,
        messageId: 'msg-2',
      }),
    );
  });

  it('dispatches through the queue publisher when queueing succeeds', async () => {
    const queuePublisher = {
      addFanoutJobs: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]),
    };
    const projector = vi.fn();
    const mirror = vi.fn().mockResolvedValue(undefined);

    const bus = new ChatFanoutCommandBus({
      queuePublisher,
      projector,
      mirror,
    });

    const result = await bus.dispatch(
      buildMessageFanoutCommand({
        messageId: 'msg-3',
        chatId: 'p:user-1:user-2',
        chatType: 'private',
        seq: 1,
        senderId: 'user-1',
        recipientIds: ['user-2'],
      }),
    );

    expect(result.mode).toBe('queued');
    expect(result.jobCount).toBe(2);
    expect(projector).not.toHaveBeenCalled();
    expect(bus.snapshot().totals.dispatchQueued).toBe(1);
  });

  it('falls back to the projector when queueing fails', async () => {
    const queuePublisher = {
      addFanoutJobs: vi.fn().mockRejectedValue(new Error('queue down')),
    };
    const projector = vi.fn().mockResolvedValue({
      recipientCount: 2,
      chunkCount: 1,
    });

    const bus = new ChatFanoutCommandBus({
      queuePublisher,
      projector,
      mirror: vi.fn().mockResolvedValue(undefined),
    });

    const result = await bus.dispatch(
      buildMessageFanoutCommand({
        messageId: 'msg-4',
        chatId: 'g:group-1',
        chatType: 'group',
        seq: 11,
        senderId: 'user-1',
        recipientIds: ['user-2', 'user-3'],
      }),
    );

    expect(result.mode).toBe('sync_fallback');
    expect(result.projection).toEqual({
      recipientCount: 2,
      chunkCount: 1,
    });
    expect(bus.snapshot().totals.dispatchFallback).toBe(1);
  });
});
