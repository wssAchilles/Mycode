import { describe, expect, it, vi } from 'vitest';

import { buildMessageFanoutCommand } from '../../src/services/chatDelivery/fanoutPlanner';
import { ChatFanoutCommandBus } from '../../src/services/chatDelivery/fanoutCommandBus';
import { projectMessageFanoutCommand } from '../../src/services/chatDelivery/deliveryProjector';
import { planFanoutChunks } from '../../src/services/chatDelivery/fanoutChunkPlanner';

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
      addFanoutJobs: vi.fn().mockResolvedValue([{ id: 'job-1' }]),
    };
    const projector = vi.fn();
    const mirror = vi.fn().mockResolvedValue(undefined);
    const outboxService = {
      beginDispatch: vi.fn(async (_command: any, chunkCommands: any[]) => ({
        outboxId: 'outbox-1',
        chunkCommands: chunkCommands.map((entry) => ({
          ...entry,
          delivery: { ...entry.delivery, outboxId: 'outbox-1' },
        })),
      })),
      markQueued: vi.fn().mockResolvedValue(undefined),
      buildSummary: vi.fn().mockResolvedValue({ countsByStatus: {}, countsByDispatchMode: {}, recentRecords: [] }),
    };

    const bus = new ChatFanoutCommandBus({
      queuePublisher,
      projector,
      mirror,
      outboxService: outboxService as any,
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
    expect(result.jobCount).toBe(1);
    expect(projector).not.toHaveBeenCalled();
    expect(bus.snapshot().totals.dispatchQueued).toBe(1);
    expect(queuePublisher.addFanoutJobs).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          delivery: expect.objectContaining({ outboxId: 'outbox-1' }),
        }),
      ]),
    );
    expect(outboxService.markQueued).toHaveBeenCalledWith('outbox-1', [{ id: 'job-1' }]);
  });

  it('falls back to the projector when queueing fails', async () => {
    const queuePublisher = {
      addFanoutJobs: vi.fn().mockRejectedValue(new Error('queue down')),
    };
    const projector = vi.fn().mockResolvedValue({
      recipientCount: 2,
      chunkCount: 1,
    });
    const outboxService = {
      beginDispatch: vi.fn(async (_command: any, chunkCommands: any[]) => ({
        outboxId: 'outbox-2',
        chunkCommands: chunkCommands.map((entry) => ({
          ...entry,
          delivery: { ...entry.delivery, outboxId: 'outbox-2' },
        })),
      })),
      markSyncFallbackCompleted: vi.fn().mockResolvedValue(undefined),
      buildSummary: vi.fn().mockResolvedValue({ countsByStatus: {}, countsByDispatchMode: {}, recentRecords: [] }),
    };

    const bus = new ChatFanoutCommandBus({
      queuePublisher,
      projector,
      mirror: vi.fn().mockResolvedValue(undefined),
      outboxService: outboxService as any,
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
    expect(outboxService.markSyncFallbackCompleted).toHaveBeenCalledWith(
      'outbox-2',
      { recipientCount: 2, chunkCount: 1 },
      'queue down',
    );
  });

  it('routes eligible private fanout through go_primary without touching the legacy queue', async () => {
    const originalEnv = { ...process.env };
    process.env.DELIVERY_EXECUTION_MODE = 'go_primary';
    process.env.DELIVERY_GO_PRIMARY_READY = 'true';
    process.env.DELIVERY_GO_PRIMARY_PRIVATE_ENABLED = 'true';
    process.env.DELIVERY_GO_PRIMARY_GROUP_ENABLED = 'false';
    process.env.DELIVERY_GO_PRIMARY_MAX_RECIPIENTS = '2';

    try {
      const queuePublisher = {
        addFanoutJobs: vi.fn().mockResolvedValue([{ id: 'job-should-not-run' }]),
      };
      const projector = vi.fn();
      const outboxService = {
        beginDispatch: vi.fn(async (_command: any, chunkCommands: any[]) => ({
          outboxId: 'outbox-3',
          chunkCommands: chunkCommands.map((entry) => ({
            ...entry,
            delivery: { ...entry.delivery, outboxId: 'outbox-3' },
          })),
        })),
        markGoPrimaryQueued: vi.fn().mockResolvedValue(undefined),
        buildSummary: vi.fn().mockResolvedValue({
          countsByStatus: {},
          countsByDispatchMode: {},
          recentRecords: [],
        }),
      };

      const bus = new ChatFanoutCommandBus({
        queuePublisher,
        projector,
        mirror: vi.fn().mockResolvedValue(undefined),
        outboxService: outboxService as any,
      });

      const result = await bus.dispatch(
        buildMessageFanoutCommand({
          messageId: 'msg-5',
          chatId: 'p:user-1:user-2',
          chatType: 'private',
          seq: 12,
          senderId: 'user-1',
          recipientIds: ['user-2'],
        }),
      );

      expect(result.mode).toBe('go_primary');
      expect(result.jobCount).toBe(1);
      expect(result.outboxId).toBe('outbox-3');
      expect(queuePublisher.addFanoutJobs).not.toHaveBeenCalled();
      expect(projector).not.toHaveBeenCalled();
      expect(outboxService.markGoPrimaryQueued).toHaveBeenCalledWith('outbox-3', [
        { id: 'go-primary:outbox-3:0' },
      ]);
      expect(bus.snapshot().totals.dispatchQueued).toBe(1);
    } finally {
      process.env = { ...originalEnv };
    }
  });

  it('plans fanout chunks with delivery metadata for replay-safe job execution', () => {
    const chunks = planFanoutChunks(
      buildMessageFanoutCommand({
        messageId: 'msg-6',
        chatId: 'g:group-1',
        chatType: 'group',
        seq: 7,
        senderId: 'user-1',
        recipientIds: ['user-2', 'user-3', 'user-4', 'user-5'],
      }),
      { maxRecipientsPerChunk: 2 },
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].delivery).toEqual({
      chunkIndex: 0,
      chunkCount: 2,
      totalRecipientCount: 4,
    });
    expect(chunks[1].delivery).toEqual({
      chunkIndex: 1,
      chunkCount: 2,
      totalRecipientCount: 4,
    });
  });
});
