import { describe, expect, it, vi } from 'vitest';

const {
  buildRecommendationHydratorsMock,
  buildRecommendationPostSelectionHydratorsMock,
} = vi.hoisted(() => ({
  buildRecommendationHydratorsMock: vi.fn(),
  buildRecommendationPostSelectionHydratorsMock: vi.fn(),
}));

vi.mock('../../src/services/recommendation/internal/componentCatalog', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/recommendation/internal/componentCatalog')>(
    '../../src/services/recommendation/internal/componentCatalog',
  );
  return {
    ...actual,
    buildRecommendationHydrators: buildRecommendationHydratorsMock,
    buildRecommendationPostSelectionHydrators: buildRecommendationPostSelectionHydratorsMock,
  };
});

import { RecommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('RecommendationAdapterService candidate hydrator batch contract', () => {
  it('starts candidate hydrators in parallel and merges in stable order', async () => {
    const service = new RecommendationAdapterService();
    let releaseSlowHydrator = () => {};
    const slowHydratorGate = new Promise<void>((resolve) => {
      releaseSlowHydrator = resolve;
    });
    let slowStarted = false;
    let fastStarted = false;

    buildRecommendationHydratorsMock.mockReturnValue([
      {
        name: 'AuthorInfoHydrator',
        enable: () => true,
        hydrate: async (_query: any, candidates: any[]) => {
          slowStarted = true;
          await slowHydratorGate;
          return candidates.map((candidate) => ({
            ...candidate,
            authorUsername: `author:${candidate.authorId}`,
          }));
        },
        update: (candidate: any, hydrated: any) => ({
          ...candidate,
          authorUsername: hydrated.authorUsername,
        }),
      },
      {
        name: 'UserInteractionHydrator',
        enable: () => true,
        hydrate: async (_query: any, candidates: any[]) => {
          fastStarted = true;
          return candidates.map((candidate) => ({
            ...candidate,
            isLikedByUser: candidate.postId === 'post-1',
          }));
        },
        update: (candidate: any, hydrated: any) => ({
          ...candidate,
          isLikedByUser: hydrated.isLikedByUser,
        }),
      },
    ]);

    const pending = service.hydrateCandidates(createFeedQuery('viewer-hydrate', 20), [
      {
        postId: 'post-1',
        authorId: 'author-1',
        content: 'one',
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
      },
      {
        postId: 'post-2',
        authorId: 'author-2',
        content: 'two',
        createdAt: new Date('2026-04-20T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slowStarted).toBe(true);
    expect(fastStarted).toBe(true);

    releaseSlowHydrator();
    const result = await pending;

    expect(result.candidates.map((candidate) => candidate.postId)).toEqual(['post-1', 'post-2']);
    expect(result.candidates[0]).toMatchObject({
      authorUsername: 'author:author-1',
      isLikedByUser: true,
    });
    expect(result.candidates[1]).toMatchObject({
      authorUsername: 'author:author-2',
      isLikedByUser: false,
    });
    expect(result.stages.map((stage) => stage.name)).toEqual([
      'AuthorInfoHydrator',
      'UserInteractionHydrator',
    ]);
    expect(result.stages.every((stage) => stage.detail?.executionMode === 'parallel_bounded')).toBe(true);
    expect(result.stages.every((stage) => stage.detail?.mergeMode === 'stable_order')).toBe(true);
  });

  it('fails open on hydrator length mismatch and surfaces provider contract error', async () => {
    const service = new RecommendationAdapterService();

    buildRecommendationHydratorsMock.mockReturnValue([
      {
        name: 'AuthorInfoHydrator',
        enable: () => true,
        hydrate: async (_query: any, candidates: any[]) =>
          candidates.slice(0, 1).map((candidate) => ({
            ...candidate,
            authorUsername: `author:${candidate.authorId}`,
          })),
        update: (candidate: any, hydrated: any) => ({
          ...candidate,
          authorUsername: hydrated.authorUsername,
        }),
      },
      {
        name: 'UserInteractionHydrator',
        enable: () => true,
        hydrate: async (_query: any, candidates: any[]) =>
          candidates.map((candidate) => ({
            ...candidate,
            isLikedByUser: true,
          })),
        update: (candidate: any, hydrated: any) => ({
          ...candidate,
          isLikedByUser: hydrated.isLikedByUser,
        }),
      },
    ]);

    const result = await service.hydrateCandidates(createFeedQuery('viewer-contract', 20), [
      {
        postId: 'post-3',
        authorId: 'author-3',
        content: 'three',
        createdAt: new Date('2026-04-21T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
      },
      {
        postId: 'post-4',
        authorId: 'author-4',
        content: 'four',
        createdAt: new Date('2026-04-20T00:00:00.000Z'),
        isReply: false,
        isRepost: false,
      },
    ]);

    expect(result.candidates.every((candidate) => candidate.isLikedByUser === true)).toBe(true);
    expect(result.candidates.every((candidate) => candidate.authorUsername === undefined)).toBe(true);
    expect(result.stages[0]?.detail?.errorClass).toBe('provider_contract_error');
    expect(result.stages[0]?.detail?.error).toContain(
      'hydrator_contract_violation:AuthorInfoHydrator:length_mismatch:2:1',
    );
    expect(result.stages[1]?.detail?.error).toBeUndefined();
  });
});
