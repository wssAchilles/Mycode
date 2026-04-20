import { describe, expect, it } from 'vitest';

import { RecommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('RecommendationAdapterService source batch contract', () => {
  it('returns batched source candidates in requested order', async () => {
    const service = new RecommendationAdapterService();
    (service as any).sourceCatalog = {
      PopularSource: {
        name: 'PopularSource',
        enable: () => true,
        getCandidates: async () => [
          {
            postId: 'post-popular',
            authorId: 'author-popular',
            content: 'popular',
            createdAt: new Date('2026-04-20T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
          },
        ],
      },
      ColdStartSource: {
        name: 'ColdStartSource',
        enable: () => true,
        getCandidates: async () => [
          {
            postId: 'post-cold',
            authorId: 'author-cold',
            content: 'cold',
            createdAt: new Date('2026-04-19T00:00:00.000Z'),
            isReply: false,
            isRepost: false,
          },
        ],
      },
    };

    const result = await service.getSourceCandidatesBatch(
      ['PopularSource', 'ColdStartSource'],
      createFeedQuery('viewer-batch', 20),
    );

    expect(result.items.map((item) => item.sourceName)).toEqual([
      'PopularSource',
      'ColdStartSource',
    ]);
    expect(result.items[0]?.candidates[0]?.postId).toBe('post-popular');
    expect(result.items[1]?.candidates[0]?.postId).toBe('post-cold');
  });
});
