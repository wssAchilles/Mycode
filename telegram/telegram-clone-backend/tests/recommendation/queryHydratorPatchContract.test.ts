import { describe, expect, it } from 'vitest';

import { RecommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('RecommendationAdapterService query hydrator patch contract', () => {
  it('returns the real UserSignal hydrator owned patch from the internal batch', async () => {
    const service = new RecommendationAdapterService();
    const hydrator = (service as any).queryHydratorCatalog.UserSignalQueryHydrator;
    hydrator.hydrate = async (query: any) => ({
      ...query,
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
    });

    const result = await service.hydrateQueryPatches(
      ['UserSignalQueryHydrator'],
      createFeedQuery('viewer-user-signal', 20),
    );

    expect(result.items[0]?.queryPatch.userSignalFeatures).toMatchObject({
      favoriteCount: 1,
      engagementScore: 0.9,
    });
    expect(result.items[0]?.stage.detail?.ownedFields).toEqual(['userSignalFeatures']);
  });

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

  it('returns an explicit UserFeatures error stage for Rust fail-closed handling', async () => {
    const service = new RecommendationAdapterService();
    (service as any).queryHydratorCatalog = {
      UserFeaturesQueryHydrator: {
        name: 'UserFeaturesQueryHydrator',
        enable: () => true,
        hydrate: async () => {
          throw new Error('blocked_store_unavailable');
        },
        update: (query: any) => query,
      },
    };

    const result = await service.hydrateQueryPatch(
      'UserFeaturesQueryHydrator',
      createFeedQuery('viewer-safety-failure', 20),
    );

    expect(result.queryPatch).toEqual({});
    expect(result.stage.name).toBe('UserFeaturesQueryHydrator');
    expect(result.stage.detail?.error).toBe('blocked_store_unavailable');
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
    expect(result.errorClass).toBe('provider_contract_error');
    expect(result.stage.detail?.errorClass).toBe('provider_contract_error');
    expect(result.stage.detail?.error).toContain(
      'query_hydrator_contract_violation:UserFeaturesQueryHydrator:experimentContext',
    );
  });

  it('returns batch query hydrator patches in requested order', async () => {
    const service = new RecommendationAdapterService();
    (service as any).queryHydratorCatalog = {
      ExperimentQueryHydrator: {
        name: 'ExperimentQueryHydrator',
        enable: () => true,
        hydrate: async () => ({ ok: true }),
        update: (query: any) => ({
          ...query,
          experimentContext: {
            userId: query.userId,
            assignments: [],
          },
        }),
      },
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
        }),
      },
    };

    const result = await service.hydrateQueryPatches(
      ['ExperimentQueryHydrator', 'UserFeaturesQueryHydrator'],
      createFeedQuery('viewer-3', 20),
    );

    expect(result.items.map((item) => item.hydratorName)).toEqual([
      'ExperimentQueryHydrator',
      'UserFeaturesQueryHydrator',
    ]);
    expect(result.items[0]?.queryPatch.experimentContext?.userId).toBe('viewer-3');
    expect(result.items[1]?.queryPatch.userFeatures?.followedUserIds).toEqual(['author-1']);
  });

  it('computes user state after dependent query feature patches are merged', async () => {
    const service = new RecommendationAdapterService();
    const dependentInputs: Record<string, any> = {};
    (service as any).queryHydratorCatalog = {
      MutualFollowQueryHydrator: {
        name: 'MutualFollowQueryHydrator',
        enable: (query: any) => Boolean(query.userFeatures),
        hydrate: async (query: any) => {
          dependentInputs.mutual = query;
          return { mutualFollowIds: ['author-2'] };
        },
        update: (query: any, hydrated: any) => ({ ...query, ...hydrated }),
      },
      ExperimentQueryHydrator: {
        name: 'ExperimentQueryHydrator',
        enable: () => true,
        hydrate: async (query: any) => {
          dependentInputs.experiment = query;
          return {
            experimentContext: { userId: query.userId, assignments: [] },
          };
        },
        update: (query: any, hydrated: any) => ({ ...query, ...hydrated }),
      },
      UserStateQueryHydrator: {
        name: 'UserStateQueryHydrator',
        enable: () => true,
        hydrate: async (query: any) => {
          dependentInputs.userState = query;
          return { ok: true };
        },
        update: (query: any) => ({
          ...query,
          userStateContext: {
            state: query.userFeatures?.followedUserIds?.length >= 3 ? 'sparse' : 'cold_start',
            reason: 'test',
            followedCount: query.userFeatures?.followedUserIds?.length ?? 0,
            recentActionCount: query.userActionSequence?.length ?? 0,
            recentPositiveActionCount: query.userActionSequence?.length ?? 0,
            usableEmbedding: Boolean(query.embeddingContext?.usable),
          },
        }),
      },
      UserFeaturesQueryHydrator: {
        name: 'UserFeaturesQueryHydrator',
        enable: () => true,
        hydrate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { ok: true };
        },
        update: (query: any) => ({
          ...query,
          userFeatures: {
            followedUserIds: ['author-1', 'author-2', 'author-3'],
            followerIds: ['author-2', 'author-4'],
            blockedUserIds: [],
            mutedKeywords: [],
            seenPostIds: [],
            followerCount: 7,
          },
        }),
      },
      UserActionSeqQueryHydrator: {
        name: 'UserActionSeqQueryHydrator',
        enable: () => true,
        hydrate: async () => ({ ok: true }),
        update: (query: any) => ({
          ...query,
          userActionSequence: [
            { action: 'like', timestamp: '2026-04-23T00:00:00.000Z' },
            { action: 'reply', timestamp: '2026-04-23T00:00:00.000Z' },
          ],
        }),
      },
      UserEmbeddingQueryHydrator: {
        name: 'UserEmbeddingQueryHydrator',
        enable: () => true,
        hydrate: async () => ({ ok: true }),
        update: (query: any) => ({
          ...query,
          embeddingContext: {
            interestedInClusters: [{ clusterId: 101, score: 0.8 }],
            producerEmbedding: [],
            usable: true,
          },
        }),
      },
      DemographicsQueryHydrator: {
        name: 'DemographicsQueryHydrator',
        enable: () => true,
        hydrate: async () => ({ ok: true }),
        update: (query: any) => ({
          ...query,
          demographics: { region: 'CN', language: 'zh' },
        }),
      },
    };

    const result = await service.hydrateQueryPatches(
      [
        'MutualFollowQueryHydrator',
        'UserStateQueryHydrator',
        'UserFeaturesQueryHydrator',
        'ExperimentQueryHydrator',
        'UserActionSeqQueryHydrator',
        'UserEmbeddingQueryHydrator',
        'DemographicsQueryHydrator',
      ],
      createFeedQuery('viewer-dependent', 20),
    );

    expect(result.items.map((item) => item.hydratorName)).toEqual([
      'MutualFollowQueryHydrator',
      'UserStateQueryHydrator',
      'UserFeaturesQueryHydrator',
      'ExperimentQueryHydrator',
      'UserActionSeqQueryHydrator',
      'UserEmbeddingQueryHydrator',
      'DemographicsQueryHydrator',
    ]);
    for (const input of Object.values(dependentInputs)) {
      expect(input.userFeatures.followedUserIds).toHaveLength(3);
      expect(input.userActionSequence).toHaveLength(2);
      expect(input.embeddingContext.usable).toBe(true);
      expect(input.demographics).toEqual({ region: 'CN', language: 'zh' });
    }
    expect(result.items[0]?.queryPatch.mutualFollowIds).toEqual(['author-2']);
    expect(result.items[1]?.queryPatch.userStateContext).toMatchObject({
      state: 'sparse',
      followedCount: 3,
      recentActionCount: 2,
      usableEmbedding: true,
    });
    expect(result.items[3]?.queryPatch.experimentContext?.userId).toBe('viewer-dependent');
    expect(result.items[0]?.stage.detail?.dependencyMode).toBe('after_base_query_patches');
    expect(result.items[1]?.stage.detail?.dependencyMode).toBe('after_base_query_patches');
    expect(result.items[3]?.stage.detail?.dependencyMode).toBe('after_base_query_patches');
  });

  it('allows embedding hydrator to own only embeddingContext', async () => {
    const service = new RecommendationAdapterService();
    const computedAt = new Date('2026-04-22T00:00:00.000Z');
    (service as any).queryHydratorCatalog = {
      UserEmbeddingQueryHydrator: {
        name: 'UserEmbeddingQueryHydrator',
        enable: () => true,
        hydrate: async () => ({ ok: true }),
        update: (query: any) => ({
          ...query,
          embeddingContext: {
            interestedInClusters: [{ clusterId: 101, score: 0.7 }],
            producerEmbedding: [{ clusterId: 202, score: 0.5 }],
            qualityScore: 0.8,
            computedAt,
            usable: true,
            stale: false,
          },
        }),
      },
    };

    const result = await service.hydrateQueryPatch(
      'UserEmbeddingQueryHydrator',
      createFeedQuery('viewer-4', 20),
    );

    expect(result.queryPatch).toEqual({
      embeddingContext: {
        interestedInClusters: [{ clusterId: 101, score: 0.7 }],
        producerEmbedding: [{ clusterId: 202, score: 0.5 }],
        qualityScore: 0.8,
        computedAt,
        usable: true,
        stale: false,
      },
    });
    expect(result.stage.detail?.ownedFields).toEqual(['embeddingContext']);
  });

  it('allows user state hydrator to own only userStateContext', async () => {
    const service = new RecommendationAdapterService();
    (service as any).queryHydratorCatalog = {
      UserStateQueryHydrator: {
        name: 'UserStateQueryHydrator',
        enable: () => true,
        hydrate: async () => ({ ok: true }),
        update: (query: any) => ({
          ...query,
          userStateContext: {
            state: 'sparse',
            reason: 'embedding_unusable',
            followedCount: 2,
            recentActionCount: 6,
            recentPositiveActionCount: 3,
            usableEmbedding: false,
            accountAgeDays: 4,
          },
        }),
      },
    };

    const result = await service.hydrateQueryPatch(
      'UserStateQueryHydrator',
      createFeedQuery('viewer-5', 20),
    );

    expect(result.queryPatch).toEqual({
      userStateContext: {
        state: 'sparse',
        reason: 'embedding_unusable',
        followedCount: 2,
        recentActionCount: 6,
        recentPositiveActionCount: 3,
        usableEmbedding: false,
        accountAgeDays: 4,
      },
    });
    expect(result.stage.detail?.ownedFields).toEqual(['userStateContext']);
  });
});
