import { describe, expect, it } from 'vitest';

import {
  deserializeRecommendationQuery,
  recommendationQueryPayloadSchema,
  serializeRecommendationQuery,
} from '../../src/services/recommendation/rust/contracts';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('Recommendation embedding context contract', () => {
  it('round-trips embeddingContext across Node/Rust payload serialization', () => {
    const query = createFeedQuery('viewer-1', 20);
    query.embeddingContext = {
      interestedInClusters: [
        { clusterId: 101, score: 0.7 },
        { clusterId: 202, score: 0.2 },
      ],
      producerEmbedding: [{ clusterId: 303, score: 0.4 }],
      knownForCluster: 101,
      knownForScore: 0.7,
      qualityScore: 0.82,
      computedAt: new Date('2026-04-22T00:00:00.000Z'),
      version: 4,
      usable: true,
      stale: false,
    };
    query.userStateContext = {
      state: 'warm',
      reason: 'stable_but_not_dense',
      followedCount: 12,
      recentActionCount: 18,
      recentPositiveActionCount: 11,
      usableEmbedding: true,
      accountAgeDays: 21,
    };

    const payload = serializeRecommendationQuery(query);
    expect(recommendationQueryPayloadSchema.safeParse(payload).success).toBe(true);

    const roundtrip = deserializeRecommendationQuery(payload);
    expect(roundtrip.embeddingContext).toEqual(query.embeddingContext);
    expect(roundtrip.userStateContext).toEqual(query.userStateContext);
  });
});
