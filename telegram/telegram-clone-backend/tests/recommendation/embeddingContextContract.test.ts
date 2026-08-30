import { describe, expect, it } from 'vitest';

import {
  deserializeRecommendationQuery,
  deserializeRecommendationQueryPatch,
  recommendationQueryPayloadSchema,
  recommendationQueryPatchPayloadSchema,
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
      modelVersion: '2026-04-29_kuai_lite256',
      artifactVersion: '2026-04-29_kuai_lite256',
      modelProfile: 'serving-lite',
      embeddingDim: 256,
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

  it('preserves declared query context fields across the Node/Rust boundary', () => {
    const query = createFeedQuery('viewer-context', 20);
    query.userFeatures = {
      ...query.userFeatures!,
      mutedUserIds: ['muted-1'],
      mutedTopicIds: ['topic-muted'],
      subscribedUserIds: ['author-subscribed'],
      followerIds: ['follower-1'],
    };
    query.userSignalFeatures = {
      favoriteCount: 1,
      retweetCount: 2,
      replyCount: 3,
      quoteCount: 4,
      followCount: 5,
      clickCount: 6,
      videoViewCount: 7,
      dwellTimeMs: 800,
      engagementScore: 0.9,
      explicitScore: 0.7,
      implicitScore: 0.2,
    };
    query.mutualFollowIds = ['mutual-1'];
    query.interestedTopics = ['rust'];
    query.pastRequestTimestamps = [new Date('2026-04-22T00:00:00.000Z')];
    query.impressedPostIds = ['post-seen'];

    const payload = serializeRecommendationQuery(query);
    const parsed = recommendationQueryPayloadSchema.parse(payload);
    const roundtrip = deserializeRecommendationQuery(parsed);

    expect(parsed.userSignalFeatures).toEqual(query.userSignalFeatures);
    expect(parsed.mutualFollowIds).toEqual(query.mutualFollowIds);
    expect(parsed.interestedTopics).toEqual(query.interestedTopics);
    expect(parsed.pastRequestTimestamps).toEqual(['2026-04-22T00:00:00.000Z']);
    expect(parsed.impressedPostIds).toEqual(query.impressedPostIds);
    expect(parsed.subscribedUserIds).toEqual(['author-subscribed']);
    expect(parsed.userFeatures?.mutedUserIds).toEqual(['muted-1']);
    expect(roundtrip.userSignalFeatures).toEqual(query.userSignalFeatures);
    expect(roundtrip.mutualFollowIds).toEqual(query.mutualFollowIds);
    expect(roundtrip.interestedTopics).toEqual(query.interestedTopics);
    expect(roundtrip.pastRequestTimestamps).toEqual(query.pastRequestTimestamps);
    expect(roundtrip.impressedPostIds).toEqual(query.impressedPostIds);
    expect(roundtrip.userFeatures?.subscribedUserIds).toEqual(['author-subscribed']);

    const topLevelOnly = deserializeRecommendationQuery({
      ...parsed,
      userFeatures: undefined,
      subscribedUserIds: ['author-subscribed'],
    });
    expect(topLevelOnly.userFeatures).toBeUndefined();
  });

  it('preserves declared query patch fields after schema parsing', () => {
    const patch = {
      userSignalFeatures: {
        favoriteCount: 1,
        retweetCount: 2,
        replyCount: 3,
        quoteCount: 4,
        followCount: 5,
        clickCount: 6,
        videoViewCount: 7,
        dwellTimeMs: 800,
        engagementScore: 0.9,
        explicitScore: 0.7,
        implicitScore: 0.2,
      },
      mutualFollowIds: ['mutual-1'],
      interestedTopics: ['rust'],
      pastRequestTimestamps: ['2026-04-22T00:00:00.000Z'],
      impressedPostIds: ['post-seen'],
      subscribedUserIds: ['author-subscribed'],
    };

    const parsed = recommendationQueryPatchPayloadSchema.parse(patch);
    expect(deserializeRecommendationQueryPatch(parsed)).toEqual(parsed);
  });
});
