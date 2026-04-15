import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registrySnapshot: vi.fn(),
  opsSnapshot: vi.fn(),
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
    snapshot: vi.fn().mockReturnValue({ totals: {}, recentEvents: [] }),
  },
}));

vi.mock('../../src/services/realtimeProtocol/realtimeSessionRegistry', () => ({
  realtimeSessionRegistry: {
    snapshot: mocks.registrySnapshot,
  },
}));

vi.mock('../../src/services/realtimeProtocol/realtimeOps', () => ({
  realtimeOps: {
    snapshot: mocks.opsSnapshot,
  },
}));

describe('realtime ops route', () => {
  const originalOpsToken = process.env.OPS_METRICS_TOKEN;
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    process.env.OPS_METRICS_TOKEN = 'phase4-test-token';
    mocks.registrySnapshot.mockReturnValue({
      totals: {
        connectedSockets: 2,
        authenticatedSockets: 1,
        onlineUsers: 1,
        roomSubscriptions: 3,
      },
      users: [],
      recentEvents: [],
    });
    mocks.opsSnapshot.mockReturnValue({
      counters: {
        socketConnected: 2,
        socketAuthenticated: 1,
        syncWakeEvent: 4,
      },
      recentEvents: [],
      updatedAt: '2026-04-15T00:00:00.000Z',
    });

    const { default: opsRoutes } = await import('../../src/routes/ops');
    const app = express();
    app.use('/api/ops', opsRoutes);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
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

  it('returns realtime registry and runtime ops snapshots behind the ops token', async () => {
    const response = await fetch(`${baseUrl}/api/ops/realtime`, {
      headers: {
        'x-ops-token': 'phase4-test-token',
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.protocolVersion).toBe(1);
    expect(payload.data.registry.totals.connectedSockets).toBe(2);
    expect(payload.data.registry.totals.roomSubscriptions).toBe(3);
    expect(payload.data.ops.counters.socketAuthenticated).toBe(1);
    expect(payload.data.ops.counters.syncWakeEvent).toBe(4);
  });
});
