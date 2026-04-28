import { describe, expect, it } from 'vitest';

import { UserStateQueryHydrator } from '../../src/services/recommendation/hydrators/query/UserStateQueryHydrator';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('UserStateQueryHydrator', () => {
  it('classifies cold start users without follow graph and engagement', async () => {
    const hydrator = new UserStateQueryHydrator();
    const query = createFeedQuery('viewer-cold', 20);
    query.userFeatures = {
      followedUserIds: [],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
      accountCreatedAt: new Date('2026-04-20T00:00:00.000Z'),
    };
    query.embeddingContext = undefined;
    query.userActionSequence = [];

    const hydrated = await hydrator.hydrate(query);
    expect(hydrated.userStateContext).toMatchObject({
      state: 'cold_start',
      reason: 'no_follow_graph_low_recent_engagement',
      followedCount: 0,
      recentActionCount: 0,
      usableEmbedding: false,
    });
  });

  it('classifies dense active users as heavy', async () => {
    const hydrator = new UserStateQueryHydrator();
    const query = createFeedQuery('viewer-heavy', 20);
    query.userFeatures = {
      followedUserIds: ['a-1', 'a-2'],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
    };
    query.embeddingContext = {
      interestedInClusters: [{ clusterId: 10, score: 0.8 }],
      producerEmbedding: [{ clusterId: 12, score: 0.4 }],
      usable: true,
      stale: false,
      qualityScore: 0.8,
    };
    query.userActionSequence = Array.from({ length: 32 }, (_, index) => ({
      action: index % 3 === 0 ? 'like' : 'click',
      timestamp: new Date(Date.now() - index * 60 * 60 * 1000),
      targetPostId: `post-${index}`,
    })) as any;

    const hydrated = await hydrator.hydrate(query);
    expect(hydrated.userStateContext).toMatchObject({
      state: 'heavy',
      reason: 'dense_recent_activity',
      followedCount: 2,
      usableEmbedding: true,
    });
  });

  it('counts dwell and share as positive memory signals', async () => {
    const hydrator = new UserStateQueryHydrator();
    const query = createFeedQuery('viewer-dwell-share', 20);
    query.userFeatures = {
      followedUserIds: ['a-1'],
      blockedUserIds: [],
      mutedKeywords: [],
      seenPostIds: [],
    };
    query.embeddingContext = {
      interestedInClusters: [{ clusterId: 10, score: 0.8 }],
      producerEmbedding: [],
      usable: true,
      stale: false,
      qualityScore: 0.8,
    };
    query.userActionSequence = [
      'dwell',
      'share',
      'profile_click',
      'video_quality_view',
      'like',
      'click',
      'reply',
      'repost',
    ].map((action, index) => ({
      action,
      timestamp: new Date(Date.now() - index * 60 * 1000),
      targetPostId: `post-${index}`,
    })) as any;

    const hydrated = await hydrator.hydrate(query);
    expect(hydrated.userStateContext).toMatchObject({
      state: 'sparse',
      recentPositiveActionCount: 8,
      usableEmbedding: true,
    });
  });
});
