import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listReplayCandidates: vi.fn(),
  markReplayQueued: vi.fn(),
}));

vi.mock('../../src/services/chatDelivery/outboxService', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/chatDelivery/outboxService')>(
    '../../src/services/chatDelivery/outboxService',
  );
  return {
    ...actual,
    chatDeliveryOutboxService: {
      listReplayCandidates: mocks.listReplayCandidates,
      markReplayQueued: mocks.markReplayQueued,
    },
  };
});

describe('chat delivery replay service', () => {
  it('requeues failed and stalled chunks only', async () => {
    mocks.listReplayCandidates.mockResolvedValue([
      {
        id: 'outbox-1',
        messageId: 'msg-1',
        chatId: 'g:group-1',
        chatType: 'group',
        seq: 7,
        senderId: 'user-1',
        emittedAt: new Date().toISOString(),
        topology: 'eager',
        dispatchMode: 'queued',
        status: 'failed',
        totalRecipientCount: 3,
        chunkCountExpected: 2,
        queuedChunkCount: 0,
        completedChunkCount: 1,
        failedChunkCount: 1,
        projectedRecipientCount: 1,
        projectedChunkCount: 1,
        replayCount: 0,
        queuedJobIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chunks: [
          {
            chunkIndex: 0,
            recipientCount: 1,
            recipientIds: ['user-2'],
            status: 'completed',
            attemptCount: 1,
          },
          {
            chunkIndex: 1,
            recipientCount: 2,
            recipientIds: ['user-3', 'user-4'],
            status: 'failed',
            attemptCount: 5,
            lastErrorMessage: 'boom',
          },
        ],
      },
    ]);
    mocks.markReplayQueued.mockResolvedValue(undefined);

    const queuePublisher = {
      addFanoutJobs: vi.fn().mockResolvedValue([{ id: 'job-7' }]),
    };

    const { ChatDeliveryReplayService } = await import('../../src/services/chatDelivery/replayService');
    const service = new ChatDeliveryReplayService(queuePublisher);
    const result = await service.replayFailedDeliveries({ limit: 5, staleAfterMinutes: 10 });

    expect(result.replayedRecords).toBe(1);
    expect(result.replayedChunks).toBe(1);
    expect(queuePublisher.addFanoutJobs).toHaveBeenCalledWith([
      expect.objectContaining({
        recipientIds: ['user-3', 'user-4'],
        delivery: expect.objectContaining({
          outboxId: 'outbox-1',
          chunkIndex: 1,
          replayCount: 1,
        }),
      }),
    ]);
    expect(mocks.markReplayQueued).toHaveBeenCalledWith('outbox-1', [1], [{ id: 'job-7' }]);
  });
});
