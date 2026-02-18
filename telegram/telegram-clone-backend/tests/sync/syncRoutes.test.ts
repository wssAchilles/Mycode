import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    updateService: {
      getUpdateId: vi.fn(),
      getUpdates: vi.fn(),
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
    mocks.messageFind.mockReset();
    mocks.messageFind.mockReturnValue(makeFindResult([]));
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

    const res = await fetch(`${baseUrl}/api/sync/state`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.pts).toBe(42);
    expect(body.data.updateId).toBe(42);
    expect(mocks.updateService.getUpdateId).toHaveBeenCalledWith('user-1');
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
    expect(mocks.updateService.getUpdates).not.toHaveBeenCalled();
    expect(mocks.messageFind).not.toHaveBeenCalled();
  });

  it('long-poll updates can recover gap after wait window', async () => {
    // First check: no new updates; second check (after timeout): updates available.
    mocks.updateService.getUpdateId
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(5);
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
    expect(mocks.updateService.getUpdateId).toHaveBeenCalledTimes(2);
    expect(mocks.updateService.getUpdates).toHaveBeenCalledWith('user-1', 3, 2);
  });
});

