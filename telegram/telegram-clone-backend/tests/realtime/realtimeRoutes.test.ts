import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUpdateId: vi.fn(),
  getAckPts: vi.fn(),
  getUserSnapshot: vi.fn(),
}));

vi.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', username: 'phase4-user' };
    req.userId = 'user-1';
    next();
  },
}));

vi.mock('../../src/services/updateService', () => ({
  updateService: {
    getUpdateId: mocks.getUpdateId,
    getAckPts: mocks.getAckPts,
  },
}));

vi.mock('../../src/services/realtimeProtocol/realtimeSessionRegistry', () => ({
  realtimeSessionRegistry: {
    getUserSnapshot: mocks.getUserSnapshot,
  },
}));

describe('realtime routes', () => {
  let server: Server;
  let baseUrl = '';
  const previousStage = process.env.GATEWAY_REALTIME_ROLLOUT_STAGE;

  beforeAll(async () => {
    process.env.GATEWAY_REALTIME_ROLLOUT_STAGE = 'rust_edge_primary';
    mocks.getUpdateId.mockResolvedValue(42);
    mocks.getAckPts.mockResolvedValue(38);
    mocks.getUserSnapshot.mockReturnValue({
      userId: 'user-1',
      username: 'phase4-user',
      online: true,
      connectedSockets: 2,
      authenticatedSockets: 2,
      roomSubscriptions: 3,
      socketIds: ['socket-a', 'socket-b'],
      rooms: ['room:g1', 'room:g2', 'room:g3'],
    });

    const { default: realtimeRoutes } = await import('../../src/routes/realtime');
    const app = express();
    app.use('/api/realtime', realtimeRoutes);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (previousStage === undefined) {
      delete process.env.GATEWAY_REALTIME_ROLLOUT_STAGE;
    } else {
      process.env.GATEWAY_REALTIME_ROLLOUT_STAGE = previousStage;
    }
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

  it('returns public realtime health metadata without auth', async () => {
    const response = await fetch(`${baseUrl}/api/realtime/health`);
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.protocolVersion).toBe(1);
    expect(payload.data.transport.preferred).toBe('rust_socket_io_compat');
    expect(payload.data.transport.fallback).toBe('node_socket_io_compat');
    expect(payload.data.transport.socketIoCompat.enabled).toBe(true);
    expect(payload.data.transport.socketIoCompat.owner).toBe('rust');
    expect(payload.data.transport.syncLongPoll.protocolVersion).toBe(2);
    expect(payload.data.transport.syncLongPoll.watermarkField).toBe('updateId');
    expect(payload.data.capabilities.realtimeBatch).toBe(true);
  });

  it('returns authenticated realtime bootstrap with sync and session metadata', async () => {
    const response = await fetch(`${baseUrl}/api/realtime/bootstrap`, {
      headers: {
        authorization: 'Bearer phase4-token',
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.protocolVersion).toBe(1);
    expect(payload.data.session.userId).toBe('user-1');
    expect(payload.data.session.authenticatedSockets).toBe(2);
    expect(payload.data.session.roomSubscriptions).toBe(3);
    expect(payload.data.sync.serverPts).toBe(42);
    expect(payload.data.sync.ackPts).toBe(38);
    expect(payload.data.sync.lagPts).toBe(4);
    expect(payload.data.transport.preferred).toBe('rust_socket_io_compat');
    expect(payload.data.transport.fallback).toBe('node_socket_io_compat');
    expect(payload.data.transport.available).toEqual([
      'rust_socket_io_compat',
      'node_socket_io_compat',
      'sync_v2_long_poll',
    ]);
    expect(mocks.getUpdateId).toHaveBeenCalledWith('user-1');
    expect(mocks.getAckPts).toHaveBeenCalledWith('user-1');
    expect(mocks.getUserSnapshot).toHaveBeenCalledWith('user-1');
  });
});
