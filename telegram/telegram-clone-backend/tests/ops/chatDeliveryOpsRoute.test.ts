import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  replayFailedDeliveries: vi.fn(),
  queueStats: vi.fn(),
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
    mocks.replayFailedDeliveries.mockResolvedValue({
      scannedRecords: 1,
      replayedRecords: 1,
      replayedChunks: 1,
      skippedRecords: 0,
      queuedJobIds: ['job-9'],
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
});
