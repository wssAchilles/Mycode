import { describe, expect, it } from 'vitest';

import {
  inspectOutboxConsistency,
  recomputeOutboxAggregates,
  type MinimalChatDeliveryOutbox,
} from '../../src/services/chatDelivery/outboxRecord';

function buildOutbox(overrides: Partial<MinimalChatDeliveryOutbox> = {}): MinimalChatDeliveryOutbox {
  return {
    _id: 'outbox-1',
    messageId: 'msg-1',
    chatId: 'chat-1',
    chatType: 'private',
    seq: 1,
    senderId: 'u1',
    emittedAt: new Date('2026-04-15T00:00:00Z'),
    topology: 'eager',
    dispatchMode: 'go_primary',
    status: 'queued',
    totalRecipientCount: 2,
    chunkCountExpected: 1,
    queuedChunkCount: 1,
    completedChunkCount: 0,
    failedChunkCount: 0,
    projectedRecipientCount: 0,
    projectedChunkCount: 0,
    replayCount: 0,
    queuedJobIds: ['job-1'],
    lastDispatchedAt: new Date('2026-04-15T00:00:00Z'),
    lastCompletedAt: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-04-15T00:00:00Z'),
    updatedAt: new Date('2026-04-15T00:20:00Z'),
    chunks: [
      {
        chunkIndex: 0,
        recipientIds: ['u1', 'u2'],
        status: 'completed',
        jobId: 'job-1',
        attemptCount: 1,
        lastAttemptAt: new Date('2026-04-15T00:10:00Z'),
        lastErrorMessage: null,
        projection: {
          recipientCount: 2,
          chunkCount: 1,
        },
      },
    ],
    ...overrides,
  };
}

describe('chat delivery outbox consistency', () => {
  it('detects aggregate/status drift and stale records', () => {
    const inspection = inspectOutboxConsistency(
      buildOutbox({
        status: 'queued',
        queuedChunkCount: 1,
        completedChunkCount: 0,
        projectedRecipientCount: 0,
        updatedAt: new Date('2026-04-14T23:00:00Z'),
      }),
      new Date('2026-04-15T00:00:00Z'),
    );

    expect(inspection.hasIssues).toBe(true);
    expect(inspection.issueKinds).toEqual(
      expect.arrayContaining(['aggregate_drift', 'status_drift', 'stale_record']),
    );
    expect(inspection.expectedStatus).toBe('completed');
    expect(inspection.repairable).toBe(true);
  });

  it('recomputes derived counters from chunk state', () => {
    const outbox = buildOutbox({
      status: 'queued',
      queuedChunkCount: 1,
      completedChunkCount: 0,
      projectedRecipientCount: 0,
    });

    recomputeOutboxAggregates(outbox);

    expect(outbox.status).toBe('completed');
    expect(outbox.queuedChunkCount).toBe(0);
    expect(outbox.completedChunkCount).toBe(1);
    expect(outbox.projectedRecipientCount).toBe(2);
    expect(outbox.projectedChunkCount).toBe(1);
  });
});
