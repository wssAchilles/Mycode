import { describe, expect, it } from 'vitest';

import { newsTrendResponsePayloadSchema } from '../../src/services/newsTrends/contracts';
import { trendToSpaceTrend } from '../../src/services/newsTrends/service';

describe('news trends rust contract', () => {
  it('accepts natural display names and canonical keywords from rust', () => {
    const parsed = newsTrendResponsePayloadSchema.safeParse({
      requestId: 'req-1',
      mode: 'news_topics',
      generatedAt: new Date().toISOString(),
      cacheHit: false,
      trends: [
        {
          trendId: 'news_event:1',
          numericClusterId: 1,
          tag: 'donald_trump',
          displayName: 'Donald Trump court ruling',
          kind: 'news_event',
          count: 2,
          heat: 100,
          score: 12.3,
          latestAt: new Date().toISOString(),
          summary: 'Representative summary',
          coverImageUrl: null,
          representativeDocumentId: 'article-1',
          documentIds: ['article-1', 'article-2'],
          canonicalKeywords: ['donald_trump', 'court'],
          scoreBreakdown: { sum_doc_score: 10.2 },
        },
      ],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.trends[0].displayName).toBe('Donald Trump court ruling');
  });

  it('rejects out-of-range heat values before frontend usage', () => {
    const parsed = newsTrendResponsePayloadSchema.safeParse({
      requestId: 'req-1',
      mode: 'space_trends',
      generatedAt: new Date().toISOString(),
      cacheHit: false,
      trends: [
        {
          trendId: 'keyword:1',
          numericClusterId: 1,
          tag: 'ai',
          displayName: 'AI',
          kind: 'keyword',
          count: 1,
          heat: 120,
          score: 1,
          documentIds: ['post-1'],
          canonicalKeywords: ['ai'],
          scoreBreakdown: {},
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('reports space trend counts with tag support instead of cluster size only', () => {
    const trend = trendToSpaceTrend(
      {
        trendId: 'social_topic:1',
        numericClusterId: 1,
        tag: 'go',
        displayName: 'Go Delivery Fanout',
        kind: 'social_topic',
        count: 2,
        heat: 100,
        score: 10,
        documentIds: ['post-1', 'post-2'],
        canonicalKeywords: ['go', 'delivery'],
        scoreBreakdown: {},
      },
      [
        { _id: 'post-1', content: 'Go delivery fanout improved.', keywords: ['go'] },
        { _id: 'post-2', content: 'The replay path uses Go workers.', keywords: [] },
        { _id: 'post-3', content: 'Delivery queue note.', keywords: ['go', 'delivery'] },
        { _id: 'post-4', content: 'Frontend note.', keywords: ['frontend'] },
      ],
    );

    expect(trend.count).toBe(3);
  });
});
