import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ingestArticles: vi.fn(),
}));

vi.mock('../../src/services/newsService', () => ({
  newsService: {
    ingestArticles: mocks.ingestArticles,
  },
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// 路由层聚焦 ingest 鉴权；authenticateToken 仅作透传占位（真实 JWT 行为由 middleware 单测覆盖）
vi.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (
    _req: unknown,
    _res: unknown,
    next: () => void
  ) => next(),
}));

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const SECRET = 'ingest-cron-secret';

describe('POST /api/news/ingest cron secret auth', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.CRON_SECRET = SECRET;

    const { newsIngestRouter } = await import('../../src/routes/newsRoutes');
    const { default: newsRoutes } = await import('../../src/routes/newsRoutes');
    const { authenticateToken } = await import('../../src/middleware/authMiddleware');

    const app = express();
    app.use(express.json());
    // mirror bootstrap mount: ingest is cron-only; remaining news routes stay JWT
    app.use('/api/news', newsIngestRouter);
    app.use('/api/news', authenticateToken, newsRoutes);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it('rejects ingest without x-cron-secret', async () => {
    const response = await fetch(`${baseUrl}/api/news/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articles: [] }),
    });

    expect(response.status).toBe(401);
    expect(mocks.ingestArticles).not.toHaveBeenCalled();
  });

  it('rejects ingest with Authorization Bearer CRON_SECRET (legacy path)', async () => {
    const response = await fetch(`${baseUrl}/api/news/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ articles: [] }),
    });

    expect(response.status).toBe(401);
    expect(mocks.ingestArticles).not.toHaveBeenCalled();
  });

  it('rejects ingest with wrong x-cron-secret', async () => {
    const response = await fetch(`${baseUrl}/api/news/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': 'not-the-secret',
      },
      body: JSON.stringify({ articles: [] }),
    });

    expect(response.status).toBe(401);
    expect(mocks.ingestArticles).not.toHaveBeenCalled();
  });

  it('accepts ingest with correct x-cron-secret', async () => {
    mocks.ingestArticles.mockResolvedValue(2);

    const response = await fetch(`${baseUrl}/api/news/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': SECRET,
      },
      body: JSON.stringify({ articles: [{ title: 'a' }, { title: 'b' }] }),
    });

    expect(response.status).toBe(200);
    expect(mocks.ingestArticles).toHaveBeenCalledTimes(1);
    expect(mocks.ingestArticles).toHaveBeenCalledWith([
      { title: 'a' },
      { title: 'b' },
    ]);
  });
});
