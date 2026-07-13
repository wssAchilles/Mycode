import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Post from '../../src/models/Post';
import ClusterDefinition from '../../src/models/ClusterDefinition';
import PostFeatureSnapshot from '../../src/models/PostFeatureSnapshot';
import UserFeatureVector from '../../src/models/UserFeatureVector';
import {
  CRAWLER_TFIDF_EMBEDDING_CONTRACT,
  DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
  REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
  assertEmbeddingContractCompatible,
  buildEmbeddingContract,
} from '../../src/services/recommendation/contracts/embeddingContract';
import { LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON } from '../../src/services/recommendation/contracts/embeddingContractEvidence';
import { buildDensePostEmbedding } from '../../src/services/recommendation/contentFeatures/denseEmbedding';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import { NewsAnnSource } from '../../src/services/recommendation/sources/NewsAnnSource';
import { TwoTowerSource } from '../../src/services/recommendation/sources/TwoTowerSource';
import { FeatureExportJob } from '../../src/services/jobs/FeatureExportJob';
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

  it('falls back to keywords without mutating the query contract when TwoTower runtime contract mismatches', async () => {
    const runtimeContract = {
      ...DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
      artifactVersion: 'synthetic-runtime-mismatch',
    };
    const query = createFeedQuery('viewer-1', 20);
    query.embeddingContext = {
      interestedInClusters: [{ clusterId: 101, score: 0.8 }],
      producerEmbedding: [],
      qualityScore: 0.9,
      embeddingContract: runtimeContract,
      usable: true,
      stale: false,
    };
    query.experimentContext = {
      getConfig: (_experimentId: string, key: string, defaultValue: unknown) => {
        if (key === 'enable_embedding_retrieval') return false;
        return defaultValue;
      },
    } as any;
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

    const annClient = { retrieve: vi.fn().mockResolvedValue([]) };

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
    expect(query.embeddingContext?.embeddingContract).toBe(runtimeContract);
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

  it('preserves the current user artifact and metadata when no user embedding is semantic-ready', async () => {
    const vector = new Array(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim).fill(0);
    const rows = [
      {
        userId: 'legacy-shared',
        twoTowerEmbedding: vector,
        embeddingContract: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        qualityScore: 0.9,
      },
      {
        userId: 'registered-cold-start',
        twoTowerEmbedding: vector,
        twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
        qualityScore: 0.9,
      },
      {
        userId: 'approved-quarantine',
        twoTowerEmbedding: vector,
        twoTowerEmbeddingQuarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
        qualityScore: 0.9,
      },
      {
        userId: 'unknown-producer',
        twoTowerEmbedding: vector,
        twoTowerEmbeddingContract: {
          ...DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
          producer: 'unverified-external-producer',
        },
        embeddingContract: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        qualityScore: 0.9,
      },
    ];
    mockUserFeatureRows(rows);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const outputDir = await mkdtemp(join(tmpdir(), 'feature-export-evidence-'));
    const userArtifactPath = join(outputDir, 'user_embeddings.json');
    const metadataPath = join(outputDir, 'export_metadata.json');
    const existingUserArtifact = '[{"id":"existing-index-user","vector":[1]}]\n';
    const existingMetadata = JSON.stringify(exportMetadata(), null, 2) + '\n';
    await writeFile(userArtifactPath, existingUserArtifact);
    await writeFile(metadataPath, existingMetadata);

    try {
      const result = await new FeatureExportJob().run({ onlyUsers: true, outputDir });

      expect(result.usersExported).toBe(0);
      expect(await readFile(userArtifactPath, 'utf8')).toBe(existingUserArtifact);
      expect(await readFile(metadataPath, 'utf8')).toBe(existingMetadata);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('merges a preserved user artifact with freshly exported cluster and post metadata', async () => {
    mockUserFeatureRows([]);
    mockClusterRows([{
      clusterId: 9,
      centroidEmbedding: new Array(64).fill(0.25),
      name: 'cluster-9',
      tags: ['test'],
    }]);
    mockPostRows([{
      postId: 'post-1',
      authorId: 'author-1',
      denseEmbedding: new Array(48).fill(0.5),
      embeddingContract: buildEmbeddingContract(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT, 48),
      dominantClusterIds: [9],
      qualityScore: 0.8,
      postCreatedAt: new Date('2026-07-01T00:00:00.000Z'),
    }]);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const outputDir = await mkdtemp(join(tmpdir(), 'feature-export-full-empty-users-'));
    const userArtifactPath = join(outputDir, 'user_embeddings.json');
    const metadataPath = join(outputDir, 'export_metadata.json');
    const existingUserArtifact = '[{"id":"existing-index-user","vector":[1]}]\n';
    await writeFile(userArtifactPath, existingUserArtifact);
    await writeFile(metadataPath, JSON.stringify(exportMetadata({
      userCount: 1,
      userEmbeddingDim: 256,
      clusterCount: 7,
      postCount: 8,
    }), null, 2));

    try {
      const result = await new FeatureExportJob().run({ outputDir });
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));

      expect(result).toMatchObject({ usersExported: 0, clustersExported: 1, postsExported: 1 });
      expect(await readFile(userArtifactPath, 'utf8')).toBe(existingUserArtifact);
      expect(metadata).toMatchObject({
        userCount: 1,
        userEmbeddingDim: 256,
        clusterCount: 1,
        clusterEmbeddingDim: 64,
        postCount: 1,
        postEmbeddingDim: 48,
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing', undefined],
    ['invalid', '{not-json'],
  ])('fails before other exports when preserved user metadata is %s', async (_label, metadataContents) => {
    mockUserFeatureRows([]);
    const clusterFind = mockClusterRows([]);
    const postFind = mockPostRows([]);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const outputDir = await mkdtemp(join(tmpdir(), 'feature-export-invalid-metadata-'));
    const userArtifactPath = join(outputDir, 'user_embeddings.json');
    await writeFile(userArtifactPath, '[{"id":"existing-index-user","vector":[1]}]\n');
    if (metadataContents !== undefined) {
      await writeFile(join(outputDir, 'export_metadata.json'), metadataContents);
    }

    try {
      await expect(new FeatureExportJob().run({ outputDir }))
        .rejects
        .toThrow('feature_export_existing_metadata_invalid');
      expect(clusterFind).not.toHaveBeenCalled();
      expect(postFind).not.toHaveBeenCalled();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('updates only user metadata without clearing existing cluster and post metadata', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const outputDir = await mkdtemp(join(tmpdir(), 'feature-export-only-users-'));
    const job = new FeatureExportJob();
    vi.spyOn(job as any, 'exportUserEmbeddings').mockImplementation(async (dir: string) => {
      await writeFile(join(dir, 'user_embeddings.json'), JSON.stringify([
        { id: 'user-1', vector: [1] },
        { id: 'user-2', vector: [2] },
      ]));
      return 2;
    });
    await writeFile(join(outputDir, 'export_metadata.json'), JSON.stringify(exportMetadata({
      userCount: 1,
      clusterCount: 7,
      postCount: 8,
    }), null, 2));

    try {
      const result = await job.run({ onlyUsers: true, outputDir });
      const metadata = JSON.parse(await readFile(join(outputDir, 'export_metadata.json'), 'utf8'));

      expect(result).toMatchObject({ usersExported: 2, clustersExported: 0, postsExported: 0 });
      expect(metadata).toMatchObject({
        userCount: 2,
        userEmbeddingDim: 256,
        clusterCount: 7,
        clusterEmbeddingDim: 64,
        postCount: 8,
        postEmbeddingDim: 48,
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

function mockUserFeatureRows(rows: unknown[]) {
  let batch = 0;
  return vi.spyOn(UserFeatureVector as any, 'find').mockImplementation(() => {
    const result = batch === 0 ? rows : [];
    batch += 1;
    const query = {
      select: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn().mockResolvedValue(result),
    } as any;
    query.select.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    return query;
  });
}

function mockClusterRows(rows: unknown[]) {
  const query = {
    select: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
  } as any;
  query.select.mockReturnValue(query);
  return vi.spyOn(ClusterDefinition as any, 'find').mockReturnValue(query);
}

function mockPostRows(rows: unknown[]) {
  let batch = 0;
  return vi.spyOn(PostFeatureSnapshot as any, 'find').mockImplementation(() => {
    const result = batch === 0 ? rows : [];
    batch += 1;
    const query = {
      select: vi.fn(),
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean: vi.fn().mockResolvedValue(result),
    } as any;
    query.select.mockReturnValue(query);
    query.sort.mockReturnValue(query);
    query.skip.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    return query;
  });
}

function exportMetadata(overrides: Record<string, unknown> = {}) {
  return {
    exportedAt: '2026-06-01T00:00:00.000Z',
    version: 1,
    userCount: 1,
    clusterCount: 7,
    postCount: 8,
    userEmbeddingDim: 256,
    clusterEmbeddingDim: 64,
    postEmbeddingDim: 48,
    ...overrides,
  };
}
