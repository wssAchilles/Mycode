import express from 'express';
import type { Server } from 'http';
import { Op } from 'sequelize';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindAll: vi.fn(),
  userFindByPk: vi.fn(),
  contactFindOne: vi.fn(),
  userSettingsFindOne: vi.fn(),
  getUserPosts: vi.fn(),
  getUserLikedPosts: vi.fn(),
  setUserCover: vi.fn(),
  searchPostsPage: vi.fn(),
  getTopicPosts: vi.fn(),
  getNewsPosts: vi.fn(),
  getNewsClusterPosts: vi.fn(),
  createNewsPosts: vi.fn(),
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findAll: mocks.userFindAll,
    findByPk: mocks.userFindByPk,
  },
}));

vi.mock('../../src/models/Contact', () => ({
  default: {
    findOne: mocks.contactFindOne,
  },
  ContactStatus: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    BLOCKED: 'blocked',
  },
}));

vi.mock('../../src/models/UserSettings', () => ({
  default: {
    findOne: mocks.userSettingsFindOne,
  },
}));

vi.mock('../../src/models/UserAction', () => ({
  default: { logActions: vi.fn().mockResolvedValue(undefined) },
  ActionType: {
    LIKE: 'like',
    REPLY: 'reply',
    REPOST: 'repost',
    QUOTE: 'quote',
    CLICK: 'click',
    DWELL: 'dwell',
    DISMISS: 'dismiss',
  },
}));

vi.mock('../../src/models/UserSignal', () => ({
  default: { logSignal: vi.fn().mockResolvedValue(undefined) },
  SignalType: {},
  TargetType: {},
  ProductSurface: { SPACE_FEED: 'space_feed', HOME_FEED: 'home_feed' },
}));

vi.mock('../../src/services/spaceService', () => ({
  spaceService: {
    getUserPosts: mocks.getUserPosts,
    getUserLikedPosts: mocks.getUserLikedPosts,
    setUserCover: mocks.setUserCover,
    searchPostsPage: mocks.searchPostsPage,
    getTopicPosts: mocks.getTopicPosts,
    getNewsPosts: mocks.getNewsPosts,
    getNewsClusterPosts: mocks.getNewsClusterPosts,
    createNewsPosts: mocks.createNewsPosts,
  },
}));

vi.mock('../../src/controllers/uploadController', () => ({
  SPACE_PUBLIC_UPLOAD_BASE: '/api/public/space/uploads',
  spaceUpload: { single: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  saveSpaceUpload: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const USER_1 = '11111111-1111-4111-8111-111111111111';
const USER_2 = '22222222-2222-4222-8222-222222222222';
const VIEWER_ID = '33333333-3333-4333-8333-333333333333';

describe('Space security, batching, and pool config', () => {
  let server: Server;
  let baseUrl: string;
  let currentViewerId = VIEWER_ID;
  const origCronSecret = process.env.CRON_SECRET;
  const origOpsToken = process.env.OPS_METRICS_TOKEN;

  beforeAll(async () => {
    const { default: profilesRouter } = await import('../../src/routes/space/profiles');
    const { default: searchRouter } = await import('../../src/routes/space/search');
    const { default: newsRouter, spaceNewsIngestRouter } = await import('../../src/routes/space/news');

    const app = express();
    app.use(express.json());
    app.use('/api/space', spaceNewsIngestRouter);
    app.use((req, _res, next) => {
      (req as any).userId = currentViewerId;
      next();
    });
    app.use('/api/space', newsRouter);
    app.use('/api/space', profilesRouter);
    app.use('/api/space', searchRouter);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    currentViewerId = VIEWER_ID;
    vi.clearAllMocks();
    mocks.userSettingsFindOne.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    });
  });

  afterEach(() => {
    if (origCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = origCronSecret;
    if (origOpsToken === undefined) delete process.env.OPS_METRICS_TOKEN;
    else process.env.OPS_METRICS_TOKEN = origOpsToken;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('batch-resolves authors in transformPostsToResponse without N+1 findByPk calls', async () => {
    const { transformPostsToResponse } = await import('../../src/routes/space/shared');
    mocks.userFindAll.mockResolvedValueOnce([
      { id: USER_1, username: 'alice', avatarUrl: '/api/public/space/uploads/a.png' },
      { id: USER_2, username: 'bob', avatarUrl: null },
    ]);

    const posts = [
      { _id: 'p1', authorId: USER_1, content: 'post 1', createdAt: new Date('2026-11-17T00:00:00.000Z') },
      { _id: 'p2', authorId: USER_1, content: 'post 2', createdAt: new Date('2026-11-17T00:01:00.000Z') },
      { _id: 'p3', authorId: USER_2, content: 'post 3', createdAt: new Date('2026-11-17T00:02:00.000Z') },
      { _id: 'p4', authorId: 'news_bot_official', isNews: true, content: 'news', createdAt: new Date('2026-11-17T00:03:00.000Z') },
    ];

    const result = await transformPostsToResponse(posts);

    expect(mocks.userFindByPk).not.toHaveBeenCalled();
    expect(mocks.userFindAll).toHaveBeenCalledTimes(1);
    expect(mocks.userFindAll).toHaveBeenCalledWith({
      where: { id: { [Op.in]: [USER_1, USER_2] } },
      attributes: ['id', 'username', 'avatarUrl'],
    });
    expect(result.map((p) => p.authorUsername)).toEqual(['alice', 'alice', 'bob', 'NewsBot']);
  });

  it('uses single User.findAll on /users/:id/likes, /search, and /news/posts', async () => {
    mocks.userFindByPk.mockResolvedValueOnce({ id: USER_1 });
    mocks.contactFindOne.mockResolvedValueOnce(null);
    mocks.getUserLikedPosts.mockResolvedValueOnce({
      posts: [
        { _id: 'l1', authorId: USER_1, content: 'liked 1', createdAt: new Date() },
        { _id: 'l2', authorId: USER_2, content: 'liked 2', createdAt: new Date() },
      ],
      hasMore: false,
    });
    mocks.userFindAll.mockResolvedValue([
      { id: USER_1, username: 'alice', avatarUrl: null },
      { id: USER_2, username: 'bob', avatarUrl: null },
    ]);

    const likesRes = await fetch(`${baseUrl}/api/space/users/${USER_1}/likes`);
    expect(likesRes.status).toBe(200);
    // 仅目标用户存在性查询调一次 findByPk，不再对每条帖子 N+1 查作者
    expect(mocks.userFindByPk).toHaveBeenCalledTimes(1);
    expect(mocks.userFindAll).toHaveBeenCalledTimes(1);

    mocks.searchPostsPage.mockResolvedValueOnce({
      posts: [{ _id: 's1', authorId: USER_1, content: 'match', createdAt: new Date() }],
      totalCount: 1,
      hasMore: false,
      query: 'match',
    });
    const searchRes = await fetch(`${baseUrl}/api/space/search?query=match`);
    expect(searchRes.status).toBe(200);
    expect(mocks.userFindByPk).toHaveBeenCalledTimes(1);
    expect(mocks.userFindAll).toHaveBeenCalledTimes(2);

    mocks.getNewsPosts.mockResolvedValueOnce({
      posts: [{ _id: 'n1', authorId: 'news_bot_official', isNews: true, content: 'headline', createdAt: new Date() }],
      hasMore: false,
    });
    const newsRes = await fetch(`${baseUrl}/api/space/news/posts`);
    expect(newsRes.status).toBe(200);
    expect(mocks.userFindAll).toHaveBeenCalledTimes(2);
  });

  it('enforces likes endpoint UUID validation, 404, block check, and showLikes privacy', async () => {
    const badIdRes = await fetch(`${baseUrl}/api/space/users/not-a-uuid/likes`);
    expect(badIdRes.status).toBe(400);

    mocks.userFindByPk.mockResolvedValueOnce(null);
    const missingRes = await fetch(`${baseUrl}/api/space/users/${USER_1}/likes`);
    expect(missingRes.status).toBe(404);

    mocks.userFindByPk.mockResolvedValueOnce({ id: USER_1 });
    mocks.contactFindOne.mockResolvedValueOnce({ id: 'block-1' });
    const blockedRes = await fetch(`${baseUrl}/api/space/users/${USER_1}/likes`);
    expect(blockedRes.status).toBe(403);

    mocks.userFindByPk.mockResolvedValueOnce({ id: USER_1 });
    mocks.contactFindOne.mockResolvedValueOnce(null);
    mocks.userSettingsFindOne.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ privacySettings: { showLikes: false } }),
      }),
    });
    const hiddenRes = await fetch(`${baseUrl}/api/space/users/${USER_1}/likes`);
    expect(hiddenRes.status).toBe(403);
  });

  it('rejects dangerous coverUrl protocols and allows http/https or upload paths', async () => {
    currentViewerId = USER_1;
    for (const badUrl of ['javascript:alert(1)', 'data:text/html,<script>', '//evil.com/x.png', '/etc/passwd']) {
      const res = await fetch(`${baseUrl}/api/space/users/${USER_1}/cover`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl: badUrl }),
      });
      expect(res.status).toBe(400);
    }
    expect(mocks.setUserCover).not.toHaveBeenCalled();

    mocks.setUserCover.mockResolvedValueOnce('/api/uploads/cover.jpg');
    const okRel = await fetch(`${baseUrl}/api/space/users/${USER_1}/cover`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ coverUrl: '/api/uploads/cover.jpg' }),
    });
    expect(okRel.status).toBe(200);

    mocks.setUserCover.mockResolvedValueOnce('https://cdn.example.com/cover.jpg');
    const okHttps = await fetch(`${baseUrl}/api/space/users/${USER_1}/cover`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ coverUrl: 'https://cdn.example.com/cover.jpg' }),
    });
    expect(okHttps.status).toBe(200);
  });

  it('fails closed on /posts/batch-news and accepts valid x-cron-secret or x-ops-token', async () => {
    delete process.env.CRON_SECRET;
    delete process.env.OPS_METRICS_TOKEN;

    const unconfiguredRes = await fetch(`${baseUrl}/api/space/posts/batch-news`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articles: [] }),
    });
    expect(unconfiguredRes.status).toBe(401);

    process.env.CRON_SECRET = 'cron-secret-123';
    process.env.OPS_METRICS_TOKEN = 'ops-secret-456';

    // 普通用户未携带管理凭据时拒绝
    const noHeaderRes = await fetch(`${baseUrl}/api/space/posts/batch-news`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ordinary-user-jwt',
      },
      body: JSON.stringify({ articles: [] }),
    });
    expect(noHeaderRes.status).toBe(401);

    const badCronRes = await fetch(`${baseUrl}/api/space/posts/batch-news`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': 'wrong',
      },
      body: JSON.stringify({ articles: [] }),
    });
    expect(badCronRes.status).toBe(401);

    const badOpsRes = await fetch(`${baseUrl}/api/space/posts/batch-news`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ops-token': 'wrong',
      },
      body: JSON.stringify({ articles: [] }),
    });
    expect(badOpsRes.status).toBe(403);

    mocks.createNewsPosts.mockResolvedValue(2);
    const okCronRes = await fetch(`${baseUrl}/api/space/posts/batch-news`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': 'cron-secret-123',
      },
      body: JSON.stringify({ articles: [{ title: 'a' }, { title: 'b' }] }),
    });
    expect(okCronRes.status).toBe(200);

    const okOpsRes = await fetch(`${baseUrl}/api/space/posts/batch-news`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ops-token': 'ops-secret-456',
      },
      body: JSON.stringify({ articles: [{ title: 'c' }] }),
    });
    expect(okOpsRes.status).toBe(200);
    expect(mocks.createNewsPosts).toHaveBeenCalledTimes(2);
  });

  it('defaults sequelize PG pool max to 8 with min 1 and honors PG_POOL_MAX', async () => {
    const origPoolMax = process.env.PG_POOL_MAX;
    delete process.env.PG_POOL_MAX;
    vi.resetModules();
    const { sequelize: defaultSeq } = await import('../../src/config/sequelize');
    expect((defaultSeq as any).options.pool).toMatchObject({ max: 8, min: 1 });

    process.env.PG_POOL_MAX = '6';
    vi.resetModules();
    const { sequelize: customSeq } = await import('../../src/config/sequelize');
    expect((customSeq as any).options.pool).toMatchObject({ max: 6, min: 1 });

    if (origPoolMax === undefined) delete process.env.PG_POOL_MAX;
    else process.env.PG_POOL_MAX = origPoolMax;
  });
});
