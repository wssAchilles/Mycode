import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  replayFailedDeliveries: vi.fn(),
  replayPrimaryFallbacks: vi.fn(),
  fallbackSummary: vi.fn(),
  consistencyRepair: vi.fn(),
  consistencySummary: vi.fn(),
  queueStats: vi.fn(),
  eventBusSummary: vi.fn(),
  rolloutSummary: vi.fn(),
  rolloutAssessment: vi.fn(),
  consumerSummary: vi.fn(),
  canarySummary: vi.fn(),
}));

vi.mock('../../src/services/chatRuntimeMetrics', () => ({
  chatRuntimeMetrics: {
    snapshot: vi.fn().mockReturnValue({}),
    reset: vi.fn(),
  },
}));

vi.mock('../../src/services/controlPlane/runtimeControlPlane', () => ({
  runtimeControlPlane: {
    snapshot: vi.fn().mockReturnValue({}),
    summary: vi.fn().mockReturnValue('ok'),
  },
}));

vi.mock('../../src/services/controlPlane/taskPacket', () => ({
  validateTaskPacket: vi.fn().mockReturnValue({ ok: true, packet: {} }),
}));

vi.mock('../../src/services/chatDelivery/fanoutCommandBus', () => ({
  chatFanoutCommandBus: {
    buildOpsSnapshot: mocks.snapshot,
  },
}));

vi.mock('../../src/services/chatDelivery/replayService', () => ({
  createChatDeliveryReplayService: vi.fn().mockResolvedValue({
    replayFailedDeliveries: mocks.replayFailedDeliveries,
  }),
}));

vi.mock('../../src/services/chatDelivery/primaryFallbackService', () => ({
  createChatDeliveryPrimaryFallbackService: vi.fn().mockResolvedValue({
    buildSummary: mocks.fallbackSummary,
    replayPrimaryFallbacks: mocks.replayPrimaryFallbacks,
  }),
}));

vi.mock('../../src/services/chatDelivery/eventPublisher', () => ({
  chatDeliveryEventPublisher: {
    buildSummary: mocks.eventBusSummary,
  },
}));

vi.mock('../../src/services/chatDelivery/executionPolicy', () => ({
  getChatDeliveryExecutionPolicySummary: mocks.rolloutSummary,
}));

vi.mock('../../src/services/chatDelivery/deliveryConsumerOps', () => ({
  readDeliveryConsumerOpsSummary: mocks.consumerSummary,
}));

vi.mock('../../src/services/chatDelivery/deliveryCanaryOps', () => ({
  readDeliveryCanaryStreamSummary: mocks.canarySummary,
}));

vi.mock('../../src/services/chatDelivery/chatDeliveryConsistencyService', () => ({
  chatDeliveryConsistencyService: {
    buildSummary: mocks.consistencySummary,
    repair: mocks.consistencyRepair,
  },
}));

vi.mock('../../src/services/chatDelivery/rolloutAssessment', () => ({
  assessChatDeliveryRollout: mocks.rolloutAssessment,
}));

vi.mock('../../src/services/queueService', () => ({
  QUEUE_NAMES: {
    MESSAGE_FANOUT: 'message-fanout-queue',
  },
  queueService: {
    getQueueStats: mocks.queueStats,
  },
}));

describe('chat delivery ops route', () => {
  const originalOpsToken = process.env.OPS_METRICS_TOKEN;
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    process.env.OPS_METRICS_TOKEN = 'phase3-test-token';
    mocks.snapshot.mockReturnValue({
      totals: {
        dispatchQueued: 1,
        dispatchQueuedLegacy: 1,
        dispatchQueuedGoPrimary: 0,
        dispatchQueuedGoGroupCanary: 0,
        dispatchFallback: 0,
        dispatchSkipped: 0,
        projectionSuccess: 1,
        projectionErrors: 0,
      },
      recentEvents: [],
      outbox: {
        countsByStatus: { queued: 1 },
        countsByDispatchMode: { queued: 1 },
        recentRecords: [],
      },
    });
    mocks.queueStats.mockResolvedValue({
      waiting: 1,
      active: 0,
      completed: 2,
      failed: 0,
    });
    mocks.eventBusSummary.mockResolvedValue({
      transport: 'redis_stream',
      streamKey: 'chat:delivery:bus:v1',
      specVersion: 'chat.delivery.v1',
      streamLength: 3,
      countsByTopic: { message_written: 1, fanout_requested: 1, fanout_projection_completed: 1 },
      recentEvents: [],
      consumerGroups: [],
    });
    mocks.rolloutSummary.mockReturnValue({
      mode: 'go_canary',
      takeoverStage: 'go_canary',
      requestedMode: 'go_canary',
      nodePrimary: true,
      nodeFallbackOnly: false,
      goShadow: true,
      goCanary: true,
      goPrimary: false,
      goPrimaryReady: false,
      rollbackActive: false,
      streamKey: 'chat:delivery:bus:v1',
      dlqStreamKey: 'chat:delivery:bus:dlq:v1',
      maxRecipientsPerChunk: 800,
      primary: {
        privateEnabled: true,
        groupEnabled: false,
        maxRecipients: 2,
        privateMaxRecipients: 2,
        groupMaxRecipients: 32,
      },
      rollout: {
        bucketStrategy: 'chat_id_hash_mod_100',
        privatePercent: 25,
        groupPercent: 0,
        chatAllowlistCount: 0,
        senderAllowlistCount: 0,
        groupChatAllowlistCount: 0,
        groupSenderAllowlistCount: 0,
      },
      canary: {
        enabled: true,
        segment: 'projection_bookkeeping',
        mismatchThreshold: 3,
        deadLetterThreshold: 2,
        fallbackMode: 'shadow_go',
      },
    });
    mocks.consumerSummary.mockResolvedValue({
      available: true,
      summary: {
        executionMode: 'canary',
        shadowCompared: 3,
        shadowMismatches: 0,
        canaryExecutions: 3,
        canaryFailed: 0,
        deadLetters: 0,
      },
    });
    mocks.canarySummary.mockResolvedValue({
      transport: 'redis_stream',
      streamKey: 'chat:delivery:canary:v1',
      available: true,
      streamLength: 3,
      lastResult: 'matched',
      lastSegment: 'projection_bookkeeping',
    });
    mocks.consistencySummary.mockResolvedValue({
      scannedRecords: 10,
      staleThresholdMinutes: 15,
      aggregateDriftCount: 0,
      staleRecordCount: 0,
      repairableCount: 0,
      countsByIssueKind: {},
      countsByChatType: {},
      countsByDispatchMode: {},
      recentIssues: [],
      lastScannedAt: '2026-04-15T00:00:00.000Z',
    });
    mocks.fallbackSummary.mockResolvedValue({
      scannedRecords: 0,
      staleThresholdMinutes: 15,
      eligibleCount: 0,
      failedEligibleCount: 0,
      staleEligibleCount: 0,
      eligiblePrivateCount: 0,
      eligibleGroupCount: 0,
      countsByDispatchMode: {},
      blockedCount: 0,
      recentCandidates: [],
      lastScannedAt: '2026-04-15T00:00:00.000Z',
    });
    mocks.rolloutAssessment.mockReturnValue({
      overallStatus: 'healthy',
      recommendations: [
        {
          action: 'promote_private_primary',
          priority: 20,
          reason: 'canary stable',
        },
      ],
      summary: '- canary stable',
      facts: {
        rolloutMode: 'go_canary',
      },
    });
    mocks.replayFailedDeliveries.mockResolvedValue({
      scannedRecords: 1,
      replayedRecords: 1,
      replayedChunks: 1,
      skippedRecords: 0,
      queuedJobIds: ['job-9'],
    });
    mocks.replayPrimaryFallbacks.mockResolvedValue({
      scannedRecords: 1,
      staleThresholdMinutes: 15,
      eligibleCount: 1,
      failedEligibleCount: 1,
      staleEligibleCount: 0,
      eligiblePrivateCount: 1,
      eligibleGroupCount: 0,
      countsByDispatchMode: {
        go_primary: 1,
      },
      blockedCount: 0,
      recentCandidates: [],
      replayedRecords: 1,
      replayedChunks: 1,
      skippedRecords: 0,
      queuedJobIds: ['job-fallback-1'],
      lastScannedAt: '2026-04-15T00:00:00.000Z',
    });

    const { default: opsRoutes } = await import('../../src/routes/ops');
    const app = express();
    app.use(express.json());
    app.use('/api/ops', opsRoutes);

    server = app.listen(0);
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    process.env.OPS_METRICS_TOKEN = originalOpsToken;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it('returns chat delivery snapshot and queue stats behind the ops token', async () => {
    const response = await fetch(`${baseUrl}/api/ops/chat-delivery`, {
      headers: {
        'x-ops-token': 'phase3-test-token',
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.snapshot.totals.dispatchQueued).toBe(1);
    expect(payload.data.queue.stats.completed).toBe(2);
    expect(payload.data.snapshot.outbox.countsByStatus.queued).toBe(1);
    expect(payload.data.eventBus.streamLength).toBe(3);
    expect(payload.data.eventBus.countsByTopic.message_written).toBe(1);
    expect(payload.data.rollout.mode).toBe('go_canary');
    expect(payload.data.consumer.summary.executionMode).toBe('canary');
    expect(payload.data.consumer.summary.canaryExecutions).toBe(3);
    expect(payload.data.canary.streamLength).toBe(3);
    expect(payload.data.canary.lastSegment).toBe('projection_bookkeeping');
    expect(payload.data.consistency.aggregateDriftCount).toBe(0);
    expect(payload.data.fallback.eligibleCount).toBe(0);
    expect(payload.data.policy.overallStatus).toBe('healthy');
    expect(payload.data.policy.recommendations[0].action).toBe('promote_private_primary');
  });

  it('replays failed chat delivery records behind the ops token', async () => {
    const response = await fetch(`${baseUrl}/api/ops/chat-delivery/replay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ops-token': 'phase3-test-token',
      },
      body: JSON.stringify({
        limit: 5,
        staleAfterMinutes: 10,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.replay.replayedRecords).toBe(1);
    expect(mocks.replayFailedDeliveries).toHaveBeenCalledWith({
      limit: 5,
      staleAfterMinutes: 10,
    });
  });

  it('replays go_primary fallback candidates behind the ops token', async () => {
    const response = await fetch(`${baseUrl}/api/ops/chat-delivery/fallback/replay`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ops-token': 'phase3-test-token',
      },
      body: JSON.stringify({
        limit: 4,
        staleAfterMinutes: 12,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.fallback.replayedRecords).toBe(1);
    expect(mocks.replayPrimaryFallbacks).toHaveBeenCalledWith({
      limit: 4,
      staleAfterMinutes: 12,
      chatType: undefined,
    });
  });

  it('filters fallback summary by chat type when requested', async () => {
    const response = await fetch(`${baseUrl}/api/ops/chat-delivery/fallback?chatType=group`, {
      headers: {
        'x-ops-token': 'phase3-test-token',
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.fallbackSummary).toHaveBeenCalledWith({
      limit: undefined,
      staleAfterMinutes: undefined,
      chatType: 'group',
    });
  });

  it('repairs consistency drift behind the ops token', async () => {
    mocks.consistencyRepair.mockResolvedValue({
      scannedRecords: 2,
      repairedRecords: 1,
      repairedOutboxIds: ['outbox-1'],
      staleThresholdMinutes: 15,
      aggregateDriftCount: 1,
      staleRecordCount: 0,
      repairableCount: 1,
      countsByIssueKind: {
        aggregate_drift: 1,
      },
      countsByChatType: {
        private: 1,
      },
      countsByDispatchMode: {
        go_primary: 1,
      },
      recentIssues: [],
      lastScannedAt: '2026-04-15T00:00:00.000Z',
    });

    const response = await fetch(`${baseUrl}/api/ops/chat-delivery/consistency/repair`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ops-token': 'phase3-test-token',
      },
      body: JSON.stringify({
        limit: 8,
        staleAfterMinutes: 25,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.consistency.repairedRecords).toBe(1);
    expect(mocks.consistencyRepair).toHaveBeenCalledWith({
      limit: 8,
      staleAfterMinutes: 25,
    });
  });
});
