import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postFind: vi.fn(),
  newsGetTopics: vi.fn(),
}));

vi.mock('../../src/models/Post', () => ({
  default: {
    find: mocks.postFind,
  },
  MediaType: {},
}));

vi.mock('../../src/services/newsService', () => ({
  newsService: {
    getTopics: mocks.newsGetTopics,
  },
}));

vi.mock('../../src/services/newsTrends', () => ({
  getNewsTrendsRustMode: () => 'off',
  newsTrendService: {},
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { spaceService } from '../../src/services/spaceService';

function mockPostFindQuery(posts: unknown[]) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(posts),
  };
}

describe('spaceService.getTrendingTags fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('falls back to recent active posts when default 168h window and newsTrends are empty', async () => {
    mocks.postFind
      .mockReturnValueOnce(mockPostFindQuery([])) // 72h
      .mockReturnValueOnce(mockPostFindQuery([])) // 168h
      .mockReturnValueOnce(mockPostFindQuery([
        {
          content: 'Historical active post #TypeScript #Rust',
          keywords: ['typescript', 'rust'],
          stats: { likeCount: 5, commentCount: 1, repostCount: 0 },
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ]));
    mocks.newsGetTopics.mockResolvedValueOnce([]);

    const trends = await spaceService.getTrendingTags(6);

    expect(trends.length).toBeGreaterThan(0);
    expect(trends.map((t) => t.tag)).toEqual(expect.arrayContaining(['typescript', 'rust']));
  });

  it('preserves explicit sinceHours window semantics without historical fallback', async () => {
    mocks.postFind
      .mockReturnValueOnce(mockPostFindQuery([])) // explicit 24h
      .mockReturnValueOnce(mockPostFindQuery([])); // expanded 168h
    mocks.newsGetTopics.mockResolvedValueOnce([]);

    const trends = await spaceService.getTrendingTags(6, 24);

    expect(trends).toEqual([]);
    // 不应触发无时间限制的兜底扫描（仅 24h 与 168h 两次带 createdAt 过滤的查询）
    expect(mocks.postFind).toHaveBeenCalledTimes(2);
    for (const call of mocks.postFind.mock.calls) {
      expect(call[0]).toHaveProperty('createdAt');
    }
  });
});
