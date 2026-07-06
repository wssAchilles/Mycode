import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import Post from '../../src/models/Post';
import {
  CRAWLER_TFIDF_EMBEDDING_CONTRACT,
  DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
  HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
  assertEmbeddingContractCompatible,
  buildEmbeddingContract,
} from '../../src/services/recommendation/contracts/embeddingContract';
import { buildDensePostEmbedding } from '../../src/services/recommendation/contentFeatures/denseEmbedding';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { NewsAnnSource } from '../../src/services/recommendation/sources/NewsAnnSource';
import { TwoTowerSource } from '../../src/services/recommendation/sources/TwoTowerSource';
import { postFeatureSnapshotService } from '../../src/services/recommendation/contentFeatures';
import { shouldStoreSemanticNewsEmbedding } from '../../src/services/newsService';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);

describe('embedding provenance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('marks heuristic embeddings as non-semantic and blocks semantic ANN use', () => {
    const embedding = buildDensePostEmbedding({
      title: 'market rally',
      content: 'stocks rise',
    } as any);
    const contract = buildEmbeddingContract(CRAWLER_TFIDF_EMBEDDING_CONTRACT, embedding.length);

    expect(contract.semantic).toBe(false);
    expect(() =>
      assertEmbeddingContractCompatible(contract, {
        ...DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        embeddingSpace: 'semantic_news_v1',
        retrievalEmbeddingDim: embedding.length,
        dimensions: embedding.length,
        semantic: true,
      }),
    ).toThrow(/embedding_contract_mismatch/);
  });

  it('falls back to keyword candidates when TwoTower semantic ANN lacks compatible user provenance', async () => {
    const query = createFeedQuery('viewer-1', 20);
    query.experimentContext = {
      getConfig: (_experimentId: string, key: string, defaultValue: unknown) => {
        if (key === 'enable_embedding_retrieval') return false;
        return defaultValue;
      },
    } as any;
    query.embeddingContext = {
      interestedInClusters: [{ clusterId: 101, score: 0.8 }],
      producerEmbedding: [],
      qualityScore: 0.9,
      embeddingContract: buildEmbeddingContract(HEURISTIC_POST_HASH_EMBEDDING_CONTRACT, 48),
      usable: true,
      stale: false,
    };

    const post = {
      _id: oid('507f191e810c19729de8b001'),
      authorId: 'author-1',
      content: 'market rally',
      keywords: ['market', 'stocks'],
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      isReply: false,
      isRepost: false,
      isNews: false,
      stats: { likeCount: 10, commentCount: 1, repostCount: 0, viewCount: 100 },
      media: [],
      isNsfw: false,
      isPinned: false,
    };

    const annClient = { retrieve: vi.fn().mockResolvedValue([{ postId: post._id.toString(), score: 0.99 }]) };

    const source = new TwoTowerSource(annClient as any);
    vi.spyOn(source as any, 'loadCandidatePools').mockResolvedValue([
      {
        entries: [{ post }],
        poolKind: 'legacy_pool',
        priorityScore: 0,
      },
    ]);
    const out = await source.getCandidates(query as any);

    expect(annClient.retrieve).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].interestPoolKind).toBe('keyword_fallback');
    expect(out[0]._scoreBreakdown).toMatchObject({
      retrievalPoolKeywordFallback: 1,
    });
  });

  it('falls back to recent news when News ANN semantic provenance is not enabled', async () => {
    const query = createFeedQuery('viewer-2', 20);
    query.newsHistoryExternalIds = ['N0'];
    const annClient = { retrieve: vi.fn().mockResolvedValue([{ postId: 'N2', score: 0.9 }]) };
    const fallbackPost = {
      _id: oid('507f191e810c19729de8b002'),
      authorId: 'news_bot_official',
      content: 'fallback news',
      createdAt: new Date('2026-03-02T00:00:00.000Z'),
      isReply: false,
      isRepost: false,
      isNews: true,
      newsMetadata: { externalId: 'N1', source: 'news', url: 'news://N1' },
      stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
      media: [],
      isNsfw: false,
      isPinned: false,
    };

    const mockLean = vi.fn().mockResolvedValue([fallbackPost]);
    const mockLimit = vi.fn().mockReturnValue({ lean: mockLean });
    const mockSort = vi.fn().mockReturnValue({ limit: mockLimit });
    vi.spyOn(Post as any, 'find').mockReturnValue({ sort: mockSort } as any);

    const source = new NewsAnnSource(annClient as any);
    const out = await source.getCandidates(query as any);

    expect(annClient.retrieve).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].newsMetadata?.externalId).toBe('N1');
    expect(out[0]._scoreBreakdown).toMatchObject({ annFallbackRecency: 1 });
  });

  it('requires complete semantic provenance before storing external news embeddings', () => {
    expect(shouldStoreSemanticNewsEmbedding([0.1, 0.2], undefined)).toBe(false);
    expect(shouldStoreSemanticNewsEmbedding([0.1, 0.2], {
      embeddingSpace: 'crawler_tfidf_v0',
      dimensions: 2,
      modelVersion: 'heuristic_fallback',
      artifactVersion: 'local_hash_v1',
      semantic: false,
    })).toBe(false);
    expect(shouldStoreSemanticNewsEmbedding([0.1, 0.2], {
      embeddingSpace: 'semantic_news_v1',
      dimensions: 2,
      modelVersion: 'semantic_news_v1',
      artifactVersion: 'semantic_news_artifact_v1',
      semantic: true,
    })).toBe(true);
  });
});
