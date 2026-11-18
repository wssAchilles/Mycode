import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postFind: vi.fn(),
  postUpdateOne: vi.fn(),
  newsArticleFindAll: vi.fn(),
  userActionFind: vi.fn(),
}));

vi.mock('../../src/models/Post', () => ({
  default: {
    find: mocks.postFind,
    updateOne: mocks.postUpdateOne,
  },
  MediaType: {
    IMAGE: 'image',
  },
}));

vi.mock('../../src/models/NewsArticle', () => ({
  default: {
    findAll: mocks.newsArticleFindAll,
  },
}));

vi.mock('../../src/models/UserAction', () => ({
  default: {
    find: mocks.userActionFind,
  },
  ActionType: {
    LIKE: 'like',
  },
}));

describe('news brief dual-store bridge and freshness window', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to PostgreSQL NewsArticle when MongoDB news posts are empty', async () => {
    // 模拟 MongoDB Post 无近 24h 新闻记录，验证自动回退读取 PostgreSQL NewsArticle
    mocks.postFind.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    mocks.userActionFind.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const fetchedAt = new Date();
    mocks.newsArticleFindAll.mockResolvedValue([
      {
        id: 'pg-news-1',
        title: 'Global AI Summit Opens Today',
        summary: 'World leaders discuss frontier safety and compute governance.',
        lead: 'World leaders discuss frontier safety.',
        source: 'bbc_world',
        sourceUrl: 'https://example.com/news/ai-summit',
        canonicalUrl: 'https://example.com/news/ai-summit',
        coverImageUrl: 'https://example.com/images/ai-summit.jpg',
        clusterId: 2,
        keywords: ['global', 'summit', 'safety'],
        fetchedAt,
        publishedAt: fetchedAt,
      },
    ]);

    const { spaceService } = await import('../../src/services/spaceService');
    const items = await spaceService.getNewsBrief('6820904b-b2ce-4d16-bdfe-b8c1f29c3aef', 4, 24);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      postId: 'pg-news-1',
      title: 'Global AI Summit Opens Today',
      source: 'bbc_world',
      url: 'https://example.com/news/ai-summit',
      coverUrl: 'https://example.com/images/ai-summit.jpg',
      clusterId: 2,
    });
  });

  it('clamps stale RSS published timestamp to fetchedAt in createNewsPosts', async () => {
    // 模拟 RSS 原始发布时间早于 24h，验证入库时采用抓取时间以保证今日时事速递可见
    mocks.postUpdateOne.mockResolvedValue({ upsertedCount: 1 });

    const { createNewsPosts } = await import('../../src/services/space/news/newsQueries');
    const fetchedAtIso = '2026-11-18T08:00:00.000Z';
    const stalePublishedIso = '2026-11-16T01:00:00.000Z';

    const count = await createNewsPosts([
      {
        title: 'Stale RSS Timestamp Story',
        summary: 'Freshly crawled today despite older feed timestamp.',
        url: 'https://example.com/news/stale-ts',
        source: 'guardian_world',
        top_image: 'https://example.com/news/stale.jpg',
        published: stalePublishedIso,
        fetchedAt: fetchedAtIso,
      },
    ]);

    expect(count).toBe(1);
    expect(mocks.postUpdateOne).toHaveBeenCalledTimes(1);
    const [, updateDoc] = mocks.postUpdateOne.mock.calls[0];
    expect(updateDoc.$setOnInsert.createdAt.toISOString()).toBe(fetchedAtIso);
  });
});
