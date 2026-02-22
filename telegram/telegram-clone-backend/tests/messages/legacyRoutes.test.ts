import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messageFind: vi.fn(),
  messageCountDocuments: vi.fn(),
  userFindByPk: vi.fn(),
  userFindAll: vi.fn(),
  groupFindByPk: vi.fn(),
  groupMemberIsMember: vi.fn(),
  waitForMongoReady: vi.fn(),
}));

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
    find: mocks.messageFind,
    countDocuments: mocks.messageCountDocuments,
  },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findByPk: mocks.userFindByPk,
    findAll: mocks.userFindAll,
  },
}));

vi.mock('../../src/models/Group', () => ({
  default: {
    findByPk: mocks.groupFindByPk,
  },
}));

vi.mock('../../src/models/GroupMember', () => ({
  MemberStatus: {
    ACTIVE: 'active',
    MUTED: 'muted',
    PENDING: 'pending',
  },
  default: {
    isMember: mocks.groupMemberIsMember,
  },
}));

vi.mock('../../src/models/ChatMemberState', () => ({
  default: {
    updateOne: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock('../../src/models/ChatCounter', () => ({
  default: {
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('../../src/config/db', () => ({
  waitForMongoReady: mocks.waitForMongoReady,
}));

vi.mock('../../src/services/messageWriteService', () => ({
  createAndFanoutMessage: vi.fn(),
}));

vi.mock('../../src/services/updateService', () => ({
  updateService: {
    appendUpdate: vi.fn(),
  },
}));

describe('legacy message routes deprecation', () => {
  let server: Server | null = null;
  let baseUrl = '';
  const toUtcClock = (offsetMinutes: number) => {
    const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  beforeEach(async () => {
    vi.resetModules();
    process.env.LEGACY_MESSAGE_ROUTE_MODE = 'gone';
    process.env.LEGACY_MESSAGES_SUNSET = 'Sat, 01 Aug 2026 00:00:00 GMT';
    delete process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC;
    delete process.env.LEGACY_DISABLE_QUIET_HOURS;
    delete process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR;
    delete process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H;
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
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = null;
    baseUrl = '';
    vi.clearAllMocks();
    delete process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC;
    delete process.env.LEGACY_DISABLE_QUIET_HOURS;
    delete process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR;
    delete process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H;
  });

  it('returns 410 and successor headers for legacy private conversation route', async () => {
    const res = await fetch(`${baseUrl}/api/messages/conversation/user-2?limit=20`);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(res.headers.get('deprecation')).toBe('true');
    expect(res.headers.get('sunset')).toBe('Sat, 01 Aug 2026 00:00:00 GMT');
    expect(res.headers.get('x-legacy-endpoint')).toBe('true');
    expect(res.headers.get('link') || '').toContain('/api/messages/chat/p%3Auser-1%3Auser-2');
    expect(String(body.error || '')).toContain('/api/messages/conversation/:receiverId');
  });

  it('returns 410 and successor headers for legacy group route', async () => {
    const res = await fetch(`${baseUrl}/api/messages/group/group-9?limit=20`);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(res.headers.get('deprecation')).toBe('true');
    expect(res.headers.get('sunset')).toBe('Sat, 01 Aug 2026 00:00:00 GMT');
    expect(res.headers.get('x-legacy-endpoint')).toBe('true');
    expect(res.headers.get('link') || '').toContain('/api/messages/chat/g%3Agroup-9');
    expect(String(body.error || '')).toContain('/api/messages/group/:groupId');
  });

  it('reports legacy usage counters for migration observation', async () => {
    await fetch(`${baseUrl}/api/messages/conversation/user-2?limit=20`);
    await fetch(`${baseUrl}/api/messages/group/group-9?limit=20`);

    const res = await fetch(`${baseUrl}/api/messages/legacy-usage`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body?.success).toBe(true);
    expect(body?.data?.legacyRoutesEnabled).toBe(true);
    expect(res.headers.get('x-legacy-off-ready')).toBe('false');
    expect(res.headers.get('x-legacy-off-candidate-mode')).toBe('gone');
    expect(res.headers.get('x-legacy-off-window-open')).toBe('true');
    expect(Number(body?.data?.callsLastHour || 0)).toBeGreaterThan(0);
    expect(Number(body?.data?.callsLast24h || 0)).toBeGreaterThan(0);
    expect(Number(body?.data?.maxCallsLastHour ?? -1)).toBeGreaterThanOrEqual(0);
    expect(Number(body?.data?.maxCallsLast24h ?? -1)).toBeGreaterThanOrEqual(0);
    expect(body?.data?.readyToDisableLegacyRoutes).toBe(false);
    expect(Array.isArray(body?.data?.blockers)).toBe(true);
    expect(body?.data?.switchWindow?.configured).toBe(false);
    expect(Number(body?.data?.suggestedDisableAt || 0)).toBeGreaterThan(0);
    expect(Number(body?.data?.usage?.conversation?.totalCalls || 0)).toBeGreaterThan(0);
    expect(Number(body?.data?.usage?.group?.totalCalls || 0)).toBeGreaterThan(0);
  });

  it('blocks legacy off when UTC switch window is configured but currently closed', async () => {
    process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC = `${toUtcClock(120)}-${toUtcClock(150)}`;

    const res = await fetch(`${baseUrl}/api/messages/legacy-usage`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('x-legacy-off-window-open')).toBe('false');
    expect(body?.data?.switchWindow?.configured).toBe(true);
    expect(body?.data?.switchWindow?.valid).toBe(true);
    expect(body?.data?.readyToDisableLegacyRoutes).toBe(false);
    expect(body?.data?.candidateRouteMode).toBe('gone');
    expect(Array.isArray(body?.data?.blockers)).toBe(true);
    expect(body?.data?.blockers).toContain('switchWindowClosed');
  });

  it('marks candidate off when traffic is quiet and UTC switch window is open', async () => {
    process.env.LEGACY_DISABLE_SWITCH_WINDOW_UTC = `${toUtcClock(-5)}-${toUtcClock(5)}`;
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_HOUR = '0';
    process.env.LEGACY_DISABLE_MAX_CALLS_LAST_24H = '0';

    const res = await fetch(`${baseUrl}/api/messages/legacy-usage`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('x-legacy-off-window-open')).toBe('true');
    expect(res.headers.get('x-legacy-off-ready')).toBe('true');
    expect(res.headers.get('x-legacy-off-candidate-mode')).toBe('off');
    expect(body?.data?.readyToDisableLegacyRoutes).toBe(true);
    expect(body?.data?.candidateRouteMode).toBe('off');
    expect(Array.isArray(body?.data?.blockers)).toBe(true);
    expect(body?.data?.blockers).toHaveLength(0);
  });
});
