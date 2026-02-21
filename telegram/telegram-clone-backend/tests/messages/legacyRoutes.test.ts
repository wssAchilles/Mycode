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

  beforeEach(async () => {
    vi.resetModules();
    process.env.ENABLE_LEGACY_MESSAGE_ENDPOINTS = 'true';
    process.env.LEGACY_MESSAGES_SUNSET = 'Sat, 01 Aug 2026 00:00:00 GMT';
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
});
