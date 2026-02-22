import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toUtcClock = (offsetMinutes: number) => {
  const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

vi.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', username: 'u1' };
    next();
  },
}));

vi.mock('../../src/models/Message', () => ({
  MessageType: {
    TEXT: 'text',
    IMAGE: 'image',
    FILE: 'file',
    SYSTEM: 'system',
  },
  MessageStatus: {
    SENT: 'sent',
    DELIVERED: 'delivered',
    READ: 'read',
    FAILED: 'failed',
    PENDING: 'pending',
  },
  default: {
    find: vi.fn(() => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) })),
    countDocuments: vi.fn(async () => 0),
  },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findByPk: vi.fn(async () => ({ id: 'user-2', username: 'u2' })),
    findAll: vi.fn(async () => []),
  },
}));

vi.mock('../../src/models/Group', () => ({
  default: {
    findByPk: vi.fn(async () => ({ id: 'group-9', isActive: true })),
  },
}));

vi.mock('../../src/models/GroupMember', () => ({
  MemberStatus: {
    ACTIVE: 'active',
    MUTED: 'muted',
    PENDING: 'pending',
  },
  default: {
    isMember: vi.fn(async () => true),
  },
}));

vi.mock('../../src/models/ChatMemberState', () => ({
  default: {
    updateOne: vi.fn(),
    countDocuments: vi.fn(async () => 0),
  },
}));

vi.mock('../../src/models/ChatCounter', () => ({
  default: {
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('../../src/config/db', () => ({
  waitForMongoReady: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/messageWriteService', () => ({
  createAndFanoutMessage: vi.fn(),
}));

vi.mock('../../src/services/updateService', () => ({
  updateService: {
    appendUpdate: vi.fn(),
  },
}));

describe('legacy message routes auto cutover mode', () => {
  let server: Server | null = null;
  let baseUrl = '';

  const boot = async () => {
    vi.resetModules();
    const { default: messageRouter } = await import('../../src/routes/messageRoutes');
    const app = express();
    app.use(express.json());
    app.use('/api/messages', messageRouter);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err?.message || 'INTERNAL_ERROR' });
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
  };

  beforeEach(async () => {
    process.env.LEGACY_MESSAGE_ROUTE_MODE = 'auto';
    process.env.LEGACY_MESSAGES_SUNSET = 'Sat, 01 Aug 2026 00:00:00 GMT';
    delete process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC;
    delete process.env.LEGACY_DISABLE_QUIET_HOURS;
    delete process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR;
    delete process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H;
    delete process.env.LEGACY_FORCE_OFF_AFTER_UTC;
    await boot();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = null;
    baseUrl = '';
    delete process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC;
    delete process.env.LEGACY_DISABLE_QUIET_HOURS;
    delete process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR;
    delete process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H;
    delete process.env.LEGACY_FORCE_OFF_AFTER_UTC;
  });

  it('serves 404 when auto mode determines effective off', async () => {
    process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC = `${toUtcClock(-5)}-${toUtcClock(5)}`;
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR = '0';
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H = '0';

    const res = await fetch(`${baseUrl}/api/messages/conversation/user-2?limit=20`);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(res.headers.get('x-legacy-route-mode')).toBe('auto');
    expect(res.headers.get('x-legacy-route-effective-mode')).toBe('off');
    expect(res.headers.get('x-legacy-off-ready')).toBe('true');
    expect(String(body?.code || '')).toBe('LEGACY_ROUTE_AUTO_OFF');
  });

  it('keeps 410 migration behavior when switch window is closed', async () => {
    process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC = `${toUtcClock(90)}-${toUtcClock(120)}`;
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR = '0';
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H = '0';

    const res = await fetch(`${baseUrl}/api/messages/group/group-9?limit=20`);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(res.headers.get('x-legacy-route-mode')).toBe('auto');
    expect(res.headers.get('x-legacy-route-effective-mode')).toBe('gone');
    expect(String(body?.error || '')).toContain('/api/messages/group/:groupId');
  });

  it('reports configured and effective modes in legacy usage snapshot', async () => {
    process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC = `${toUtcClock(-5)}-${toUtcClock(5)}`;
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR = '0';
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H = '0';

    const res = await fetch(`${baseUrl}/api/messages/legacy-usage`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('x-legacy-off-effective-mode')).toBe('off');
    expect(body?.data?.legacyRouteMode).toBe('auto');
    expect(body?.data?.legacyRouteEffectiveMode).toBe('off');
    expect(body?.data?.legacyRoutesEnabled).toBe(true);
    expect(body?.data?.legacyRoutesEffectiveEnabled).toBe(false);
  });

  it('forces 404 cutover when force-off deadline has passed', async () => {
    process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC = `${toUtcClock(90)}-${toUtcClock(120)}`;
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR = '0';
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H = '0';
    process.env.LEGACY_FORCE_OFF_AFTER_UTC = '2000-01-01T00:00:00.000Z';

    const res = await fetch(`${baseUrl}/api/messages/group/group-9?limit=20`);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(res.headers.get('x-legacy-route-mode')).toBe('auto');
    expect(res.headers.get('x-legacy-route-effective-mode')).toBe('off');
    expect(res.headers.get('x-legacy-off-forced')).toBe('true');
    expect(res.headers.get('x-legacy-off-force-at')).toBe('2000-01-01T00:00:00.000Z');
    expect(String(body?.code || '')).toBe('LEGACY_ROUTE_FORCED_OFF');
  });
});
