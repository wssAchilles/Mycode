import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messageFind: vi.fn(),
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
  },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findAll: mocks.userFindAll,
    findByPk: vi.fn(),
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

const makeFindChain = (rows: any[]) => ({
  sort: vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(rows),
    }),
  }),
});

describe('chat cursor contract headers', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    process.env.LEGACY_MESSAGE_ROUTE_MODE = 'gone';
    const { default: messageRouter } = await import('../../src/routes/messageRoutes');

    mocks.waitForMongoReady.mockReset();
    mocks.waitForMongoReady.mockResolvedValue(undefined);
    mocks.userFindAll.mockReset();
    mocks.userFindAll.mockResolvedValue([
      { id: 'user-1', username: 'u1' },
      { id: 'user-2', username: 'u2' },
    ]);
    mocks.groupMemberIsMember.mockReset();
    mocks.groupFindByPk.mockReset();
    mocks.messageFind.mockReset();

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
  });

  it('returns strict cursor headers and canonical chatId for before mode', async () => {
    mocks.messageFind.mockReturnValue(
      makeFindChain([
        {
          _id: 'm2',
          id: 'm2',
          chatId: 'p:user-1:user-2',
          seq: 19,
          content: 'b',
          sender: 'user-2',
          receiver: 'user-1',
          timestamp: new Date('2026-02-22T00:00:02.000Z'),
          type: 'text',
          status: 'sent',
          isGroupChat: false,
          deletedAt: null,
        },
        {
          _id: 'm1',
          id: 'm1',
          chatId: 'p:user-1:user-2',
          seq: 18,
          content: 'a',
          sender: 'user-1',
          receiver: 'user-2',
          timestamp: new Date('2026-02-22T00:00:01.000Z'),
          type: 'text',
          status: 'sent',
          isGroupChat: false,
          deletedAt: null,
        },
      ]),
    );

    const res = await fetch(`${baseUrl}/api/messages/chat/p:user-2:user-1?beforeSeq=20&limit=2`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('x-message-cursor-only')).toBe('true');
    expect(res.headers.get('x-message-cursor-protocol-version')).toBe('1');
    expect(res.headers.get('x-message-cursor-mode')).toBe('before');
    expect(res.headers.get('x-message-cursor-canonical-chatid')).toBe('p:user-1:user-2');
    expect(res.headers.get('x-message-cursor-limit')).toBe('2');
    expect(body.protocolVersion).toBe(1);
    expect(body.canonicalChatId).toBe('p:user-1:user-2');
    expect(body.paging.mode).toBe('before');
    expect(body.messages.map((m: any) => m.seq)).toEqual([18, 19]);

    const query = mocks.messageFind.mock.calls[0]?.[0];
    expect(query.chatId).toBe('p:user-1:user-2');
    expect(query.seq?.$lt).toBe(20);
    expect(query.seq?.$type).toBe('number');
  });

  it('returns after mode contract when afterSeq is provided', async () => {
    mocks.messageFind.mockReturnValue(
      makeFindChain([
        {
          _id: 'm21',
          id: 'm21',
          chatId: 'p:user-1:user-2',
          seq: 21,
          content: 'x',
          sender: 'user-1',
          receiver: 'user-2',
          timestamp: new Date('2026-02-22T00:00:03.000Z'),
          type: 'text',
          status: 'sent',
          isGroupChat: false,
          deletedAt: null,
        },
        {
          _id: 'm22',
          id: 'm22',
          chatId: 'p:user-1:user-2',
          seq: 22,
          content: 'y',
          sender: 'user-2',
          receiver: 'user-1',
          timestamp: new Date('2026-02-22T00:00:04.000Z'),
          type: 'text',
          status: 'sent',
          isGroupChat: false,
          deletedAt: null,
        },
      ]),
    );

    const res = await fetch(`${baseUrl}/api/messages/chat/p:user-1:user-2?afterSeq=20&limit=2`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('x-message-cursor-mode')).toBe('after');
    expect(body.paging.mode).toBe('after');
    expect(body.messages.map((m: any) => m.seq)).toEqual([21, 22]);
    expect(body.paging.nextBeforeSeq).toBeNull();
  });
});

