import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', username: 'u1' };
    next();
  },
}));

vi.mock('../../src/controllers/messageController', () => {
  const ok = (_req: any, res: any) => res.status(200).json({ ok: true });
  return {
    getConversation: ok,
    getChatMessages: ok,
    getGroupMessages: ok,
    sendMessage: ok,
    markMessagesAsRead: ok,
    markChatAsRead: ok,
    deleteMessage: ok,
    editMessage: ok,
    getUnreadCount: ok,
    searchMessages: ok,
    getMessageContext: ok,
  };
});

describe('legacy message routes disabled', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    process.env.ENABLE_LEGACY_MESSAGE_ENDPOINTS = 'false';

    const { default: messageRouter } = await import('../../src/routes/messageRoutes');

    const app = express();
    app.use(express.json());
    app.use('/api/messages', messageRouter);

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

  it('does not mount /conversation and /group legacy routes', async () => {
    const [privateRes, groupRes] = await Promise.all([
      fetch(`${baseUrl}/api/messages/conversation/user-2?limit=20`),
      fetch(`${baseUrl}/api/messages/group/group-9?limit=20`),
    ]);

    expect(privateRes.status).toBe(404);
    expect(groupRes.status).toBe(404);
  });
});
