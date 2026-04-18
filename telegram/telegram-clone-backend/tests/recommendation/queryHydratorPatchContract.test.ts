import { describe, expect, it } from 'vitest';

import { RecommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('RecommendationAdapterService query hydrator patch contract', () => {
  it('returns only the owned query patch fields for a valid hydrator', async () => {
    const service = new RecommendationAdapterService();
    (service as any).queryHydratorCatalog = {
      UserFeaturesQueryHydrator: {
        name: 'UserFeaturesQueryHydrator',
        enable: () => true,
        hydrate: async () => ({ ok: true }),
        update: (query: any) => ({
          ...query,
          userFeatures: {
            followedUserIds: ['author-1'],
            blockedUserIds: [],
            mutedKeywords: [],
            seenPostIds: [],
            followerCount: 7,
          },
        }),
      },
    };

    const result = await service.hydrateQueryPatch(
      'UserFeaturesQueryHydrator',
      createFeedQuery('viewer-1', 20),
    );

    expect(result.queryPatch).toEqual({
      userFeatures: {
        followedUserIds: ['author-1'],
        blockedUserIds: [],
        mutedKeywords: [],
        seenPostIds: [],
        followerCount: 7,
      },
    });
    expect(result.stage.enabled).toBe(true);
    expect(result.stage.detail?.ownedFields).toEqual(['userFeatures']);
  });

  it('marks unauthorized field writes as a contract violation', async () => {
    const service = new RecommendationAdapterService();
    (service as any).queryHydratorCatalog = {
      UserFeaturesQueryHydrator: {
        name: 'UserFeaturesQueryHydrator',
        enable: () => true,
        hydrate: async () => ({ ok: true }),
        update: (query: any) => ({
          ...query,
          userFeatures: {
            followedUserIds: ['author-1'],
            blockedUserIds: [],
            mutedKeywords: [],
            seenPostIds: [],
          },
          experimentContext: {
            userId: query.userId,
            assignments: [],
          },
        }),
      },
    };

    const result = await service.hydrateQueryPatch(
      'UserFeaturesQueryHydrator',
      createFeedQuery('viewer-2', 20),
    );

    expect(result.queryPatch).toEqual({});
    expect(result.stage.detail?.error).toContain(
      'query_hydrator_contract_violation:UserFeaturesQueryHydrator:experimentContext',
    );
  });
});
