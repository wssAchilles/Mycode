import { describe, expect, it, vi } from 'vitest';

import { buildMessageFanoutCommand } from '../../src/services/chatDelivery/fanoutPlanner';
import { ChatFanoutCommandBus } from '../../src/services/chatDelivery/fanoutCommandBus';
import { publishMessagePersistedEvent } from '../../src/services/chatDelivery/messageLifecyclePublisher';

describe('chat delivery event bus', () => {
  it('publishes stable queue and projection envelopes for the fanout lifecycle', async () => {
    const queuePublisher = {
      enqueue: vi.fn().mockResolvedValue([{ id: 'job-1' }]),
    };
    const eventPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
      buildSummary: vi.fn().mockResolvedValue({
        transport: 'redis_stream',
        streamKey: 'chat:delivery:bus:v1',
        specVersion: 'chat.delivery.v1',
        streamLength: 1,
        countsByTopic: { fanout_requested: 1 },
        recentEvents: [],
        consumerGroups: [],
      }),
    };
    const outboxService = {
      beginDispatch: vi.fn(async (_command: any, chunkCommands: any[]) => ({
        outboxId: 'outbox-1',
        chunkCommands: chunkCommands.map((entry) => ({
          ...entry,
          delivery: { ...entry.delivery, outboxId: 'outbox-1' },
        })),
      })),
      markQueued: vi.fn().mockResolvedValue(undefined),
      markProjectionStarted: vi.fn().mockResolvedValue(undefined),
      markProjectionCompleted: vi.fn().mockResolvedValue(undefined),
      buildSummary: vi.fn().mockResolvedValue({ countsByStatus: {}, countsByDispatchMode: {}, recentRecords: [] }),
    };

    const bus = new ChatFanoutCommandBus({
      fanoutExecutor: queuePublisher as any,
      projector: vi.fn().mockResolvedValue({ recipientCount: 2, chunkCount: 1 }),
      mirror: vi.fn().mockResolvedValue(undefined),
      eventPublisher: eventPublisher as any,
      outboxService: outboxService as any,
    });

    const command = buildMessageFanoutCommand({
      messageId: 'msg-evt-1',
      chatId: 'g:group-1',
      chatType: 'group',
      seq: 8,
      senderId: 'user-1',
      recipientIds: ['user-2', 'user-3'],
    });

    const dispatch = await bus.dispatch(command);
    await bus.recordProjectionStarted(
      { ...command, delivery: { outboxId: dispatch.outboxId, chunkIndex: 0, chunkCount: 1, totalRecipientCount: 2 } },
      { chunkIndex: 0, jobId: 'job-1', attemptCount: 1 },
    );
    await bus.recordProjectionSuccess(
      { ...command, delivery: { outboxId: dispatch.outboxId, chunkIndex: 0, chunkCount: 1, totalRecipientCount: 2 } },
      { recipientCount: 2, chunkCount: 1 },
      { chunkIndex: 0, jobId: 'job-1', attemptCount: 1 },
    );

    const publishedTopics = eventPublisher.publish.mock.calls.flatMap((call) =>
      call[0].map((event: { topic: string }) => event.topic),
    );
    expect(publishedTopics).toEqual(
      expect.arrayContaining([
        'fanout_requested',
        'fanout_projection_started',
        'fanout_projection_completed',
      ]),
    );
  });

  it('publishes a message_written envelope for persisted messages', async () => {
    const eventPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    await publishMessagePersistedEvent(
      {
        messageId: 'msg-1',
        chatId: 'p:user-1:user-2',
        chatType: 'private',
        seq: 1,
        senderId: 'user-1',
        recipientIds: ['user-2'],
        dispatchPlanned: true,
        topology: 'eager',
        isLargeGroup: false,
      },
      eventPublisher as any,
    );

    expect(eventPublisher.publish).toHaveBeenCalledWith([
      expect.objectContaining({
        topic: 'message_written',
        payload: expect.objectContaining({
          messageId: 'msg-1',
          recipientCount: 1,
          dispatchPlanned: true,
        }),
      }),
    ]);
  });
});
