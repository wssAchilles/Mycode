import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    updateService: {
      getUpdateId: vi.fn(),
      getUpdates: vi.fn(),
      waitForUpdate: vi.fn(),
      saveAckPts: vi.fn(),
      getAckPts: vi.fn(),
    },
    messageFind: vi.fn(),
  };
});

vi.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  },
}));

vi.mock('../../src/services/updateService', () => ({
  updateService: mocks.updateService,
}));

vi.mock('../../src/models/Message', () => ({
  default: {
    find: mocks.messageFind,
  },
}));

import syncRouter from '../../src/routes/sync';

const makeFindResult = (rows: any[]) => ({
  lean: vi.fn().mockResolvedValue(rows),
});

describe('sync routes gap recovery', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/sync', syncRouter);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ success: false, error: { message: err?.message || 'INTERNAL_ERROR' } });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server?.address();
        if (addr && typeof addr !== 'string') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    mocks.updateService.getUpdateId.mockReset();
    mocks.updateService.getUpdates.mockReset();
    mocks.updateService.waitForUpdate.mockReset();
    mocks.updateService.saveAckPts.mockReset();
    mocks.updateService.getAckPts.mockReset();
    mocks.messageFind.mockReset();
    mocks.messageFind.mockReturnValue(makeFindResult([]));
    mocks.updateService.waitForUpdate.mockResolvedValue({ updateId: null, wakeSource: 'timeout' });
    mocks.updateService.saveAckPts.mockImplementation(async (_userId: string, pts: number) => pts);
    mocks.updateService.getAckPts.mockResolvedValue(0);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = null;
    baseUrl = '';
    vi.restoreAllMocks();
  });

  it('returns state pts from updateService', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(42);
    mocks.updateService.getAckPts.mockResolvedValue(40);

    const res = await fetch(`${baseUrl}/api/sync/state`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.pts).toBe(42);
    expect(body.data.updateId).toBe(42);
    expect(body.data.ackPts).toBe(40);
    expect(body.data.protocolVersion).toBe(2);
    expect(body.data.watermarkField).toBe('updateId');
    expect(res.headers.get('x-sync-protocol-version')).toBe('2');
    expect(res.headers.get('x-sync-watermark-field')).toBe('updateId');
    expect(mocks.updateService.getUpdateId).toHaveBeenCalledWith('user-1');
    expect(mocks.updateService.getAckPts).toHaveBeenCalledWith('user-1');
  });

  it('returns difference payload when client pts is stale', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(10);
    mocks.updateService.getUpdates.mockResolvedValue({
      updates: [{ updateId: 6, type: 'new_message', messageId: 'm1', chatId: 'p:a:b', seq: 12 }],
      lastUpdateId: 6,
    });
    mocks.messageFind.mockReturnValue(makeFindResult([{ _id: 'm1', content: 'hello' }]));

    const res = await fetch(`${baseUrl}/api/sync/difference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pts: 5 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.updates).toHaveLength(1);
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.state.pts).toBe(6);
    expect(body.data.isLatest).toBe(false);
    expect(body.data.protocolVersion).toBe(2);
    expect(body.data.watermarkField).toBe('updateId');
    expect(mocks.updateService.getUpdates).toHaveBeenCalledWith('user-1', 5, 100);
  });

  it('returns empty difference when client is up-to-date', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(8);

    const res = await fetch(`${baseUrl}/api/sync/difference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pts: 8 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.updates).toEqual([]);
    expect(body.data.messages).toEqual([]);
    expect(body.data.state.pts).toBe(8);
    expect(body.data.isLatest).toBe(true);
    expect(body.data.protocolVersion).toBe(2);
    expect(body.data.watermarkField).toBe('updateId');
    expect(mocks.updateService.getUpdates).not.toHaveBeenCalled();
    expect(mocks.messageFind).not.toHaveBeenCalled();
  });

  it('long-poll updates can recover gap after wait window', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(3);
    mocks.updateService.waitForUpdate.mockResolvedValue({ updateId: 5, wakeSource: 'event', eventSource: 'local' });
    mocks.updateService.getUpdates.mockResolvedValue({
      updates: [
        { updateId: 4, type: 'new_message', messageId: 'm4', chatId: 'p:a:b', seq: 20 },
        { updateId: 5, type: 'new_message', messageId: 'm5', chatId: 'p:a:b', seq: 21 },
      ],
      lastUpdateId: 5,
    });
    mocks.messageFind.mockReturnValue(makeFindResult([{ _id: 'm4' }, { _id: 'm5' }]));

    const res = await fetch(`${baseUrl}/api/sync/updates?pts=3&timeout=5`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.updates).toHaveLength(2);
    expect(body.data.state.pts).toBe(5);
    expect(body.data.wakeSource).toBe('event');
    expect(body.data.protocolVersion).toBe(2);
    expect(body.data.watermarkField).toBe('updateId');
    expect(res.headers.get('x-sync-wake-source')).toBe('event');
    expect(res.headers.get('x-sync-wake-event-source')).toBe('local');
    expect(mocks.updateService.waitForUpdate).toHaveBeenCalledWith('user-1', 3, 200);
    expect(mocks.updateService.getUpdateId).toHaveBeenCalledTimes(1);
    expect(mocks.updateService.getUpdates).toHaveBeenCalledWith('user-1', 3, 2);
  });

  it('sync updates immediate path bypasses wait and marks wake source', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(6);
    mocks.updateService.getUpdates.mockResolvedValue({
      updates: [{ updateId: 6, type: 'new_message', messageId: 'm6', chatId: 'p:a:b', seq: 33 }],
      lastUpdateId: 6,
    });
    mocks.messageFind.mockReturnValue(makeFindResult([{ _id: 'm6' }]));

    const res = await fetch(`${baseUrl}/api/sync/updates?pts=3&timeout=5`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.wakeSource).toBe('immediate');
    expect(res.headers.get('x-sync-wake-source')).toBe('immediate');
    expect(mocks.updateService.waitForUpdate).not.toHaveBeenCalled();
    expect(mocks.updateService.getUpdates).toHaveBeenCalledWith('user-1', 3, 3);
  });

  it('persists ack pts and returns lag against server watermark', async () => {
    mocks.updateService.saveAckPts.mockResolvedValue(120);
    mocks.updateService.getUpdateId.mockResolvedValue(128);

    const res = await fetch(`${baseUrl}/api/sync/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pts: 120 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.acknowledged).toBe(true);
    expect(body.data.pts).toBe(120);
    expect(body.data.serverPts).toBe(128);
    expect(body.data.lagPts).toBe(8);
    expect(mocks.updateService.saveAckPts).toHaveBeenCalledWith('user-1', 120);
  });

  it('clamps ack pts to server watermark when client overshoots', async () => {
    mocks.updateService.saveAckPts.mockImplementation(async (_userId: string, pts: number) => pts);
    mocks.updateService.getUpdateId.mockResolvedValue(80);

    const res = await fetch(`${baseUrl}/api/sync/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pts: 120 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.requestedPts).toBe(120);
    expect(body.data.acceptedPts).toBe(80);
    expect(body.data.pts).toBe(80);
    expect(body.data.clamped).toBe(true);
    expect(res.headers.get('x-sync-ack-clamped')).toBe('true');
    expect(mocks.updateService.saveAckPts).toHaveBeenCalledWith('user-1', 80);
  });

  it('normalizes lastUpdateId to monotonic state pts', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(12);
    mocks.updateService.getUpdates.mockResolvedValue({
      updates: [{ updateId: 11, type: 'message', messageId: 'm11', chatId: 'p:a:b', seq: 99 }],
      // stale/incorrect lastUpdateId from service should be corrected by route
      lastUpdateId: 7,
    });
    mocks.messageFind.mockReturnValue(makeFindResult([{ _id: 'm11', content: 'hello' }]));

    const res = await fetch(`${baseUrl}/api/sync/difference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pts: 10 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.state.pts).toBe(11);
    expect(body.data.isLatest).toBe(false);
  });

  it('returns 400 for invalid updates pts', async () => {
    const res = await fetch(`${baseUrl}/api/sync/updates?pts=-1`);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('caps sync limit from query/body to protect backend', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(999);
    mocks.updateService.getUpdates.mockResolvedValue({
      updates: [],
      lastUpdateId: 999,
    });

    const diffRes = await fetch(`${baseUrl}/api/sync/difference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pts: 1, limit: 99999 }),
    });
    expect(diffRes.status).toBe(200);
    expect(mocks.updateService.getUpdates).toHaveBeenCalledWith('user-1', 1, 200);
  });

  it('normalizes updates timeout query into guarded range', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(0);
    mocks.updateService.waitForUpdate.mockResolvedValue({ updateId: null, wakeSource: 'timeout' });

    const res = await fetch(`${baseUrl}/api/sync/updates?pts=0&timeout=999999`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.updateService.waitForUpdate).toHaveBeenCalledWith('user-1', 0, 60000);
  });

  it('sanitizes out-of-order duplicate updates and keeps messages aligned by updateId order', async () => {
    mocks.updateService.getUpdateId.mockResolvedValue(20);
    mocks.updateService.getUpdates.mockResolvedValue({
      updates: [
        { updateId: 12, type: 'new_message', messageId: 'm12', chatId: 'p:a:b', seq: 12 },
        { updateId: 11, type: 'new_message', messageId: 'm11', chatId: 'p:a:b', seq: 11 },
        { updateId: 11, type: 'new_message', messageId: 'm11', chatId: 'p:a:b', seq: 11 },
        { updateId: 10, type: 'new_message', messageId: 'm10', chatId: 'p:a:b', seq: 10 },
      ],
      lastUpdateId: 12,
    });
    // Return messages intentionally out-of-order to verify route reorders by update sequence.
    mocks.messageFind.mockReturnValue(makeFindResult([{ _id: 'm12' }, { _id: 'm11' }]));

    const res = await fetch(`${baseUrl}/api/sync/difference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pts: 10 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.updates.map((u: any) => u.updateId)).toEqual([11, 12]);
    expect(body.data.messages.map((m: any) => m._id)).toEqual(['m11', 'm12']);
    expect(body.data.state.pts).toBe(12);
  });
});
