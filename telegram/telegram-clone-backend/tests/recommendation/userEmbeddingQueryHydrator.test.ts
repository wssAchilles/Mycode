import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeatureStore } from '../../src/services/recommendation/featureStore';
import { UserEmbeddingQueryHydrator } from '../../src/services/recommendation/hydrators/UserEmbeddingQueryHydrator';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

describe('UserEmbeddingQueryHydrator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates a usable embedding context when vector is fresh and high quality', async () => {
    vi.spyOn(FeatureStore, 'getUserEmbedding').mockResolvedValue({
      interestedInClusters: [
        { clusterId: 101, score: 0.7 },
        { clusterId: 202, score: 0.2 },
      ],
      producerEmbedding: [{ clusterId: 101, score: 0.5 }],
      knownForCluster: 101,
      knownForScore: 0.5,
      qualityScore: 0.8,
      computedAt: new Date().toISOString(),
      version: 3,
    } as any);

    const hydrator = new UserEmbeddingQueryHydrator();
    const query = createFeedQuery('viewer-1', 20);
    const hydrated = await hydrator.hydrate(query);

    expect(hydrated.embeddingContext?.usable).toBe(true);
    expect(hydrated.embeddingContext?.stale).toBe(false);
    expect(hydrated.embeddingContext?.interestedInClusters).toEqual([
      { clusterId: 101, score: 0.7 },
      { clusterId: 202, score: 0.2 },
    ]);
  });

  it('marks embedding as unusable when vector is stale', async () => {
    vi.spyOn(FeatureStore, 'getUserEmbedding').mockResolvedValue({
      interestedInClusters: [{ clusterId: 101, score: 0.7 }],
      producerEmbedding: [{ clusterId: 101, score: 0.5 }],
      qualityScore: 0.8,
      computedAt: '2025-01-01T00:00:00.000Z',
      version: 2,
    } as any);

    const hydrator = new UserEmbeddingQueryHydrator();
    const hydrated = await hydrator.hydrate(createFeedQuery('viewer-2', 20));

    expect(hydrated.embeddingContext?.stale).toBe(true);
    expect(hydrated.embeddingContext?.usable).toBe(false);
  });

  it('marks embedding as unusable when quality is below threshold', async () => {
    vi.spyOn(FeatureStore, 'getUserEmbedding').mockResolvedValue({
      interestedInClusters: [{ clusterId: 101, score: 0.7 }],
      producerEmbedding: [{ clusterId: 101, score: 0.5 }],
      qualityScore: 0.01,
      computedAt: new Date().toISOString(),
      version: 1,
    } as any);

    const hydrator = new UserEmbeddingQueryHydrator();
    const hydrated = await hydrator.hydrate(createFeedQuery('viewer-3', 20));

    expect(hydrated.embeddingContext?.stale).toBe(false);
    expect(hydrated.embeddingContext?.usable).toBe(false);
  });

  it('returns undefined embedding context when nothing is stored', async () => {
    vi.spyOn(FeatureStore, 'getUserEmbedding').mockResolvedValue(null);

    const hydrator = new UserEmbeddingQueryHydrator();
    const hydrated = await hydrator.hydrate(createFeedQuery('viewer-4', 20));

    expect(hydrated.embeddingContext).toBeUndefined();
  });
});
