import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { buildRecommendationExplain } from '../../src/services/recommendation/explain/candidateExplain';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

function candidate(extra?: Partial<any>) {
  return {
    postId: new mongoose.Types.ObjectId('507f191e810c19729de86011'),
    authorId: 'author-1',
    content: 'candidate explain test',
    createdAt: new Date('2026-04-22T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    inNetwork: false,
    recallSource: 'TwoTowerSource',
    _scoreBreakdown: {
      retrievalEmbeddingScore: 0.42,
      retrievalAuthorClusterScore: 0.26,
      retrievalCandidateClusterScore: 0.19,
      retrievalDenseVectorScore: 0.11,
      diversityMultiplier: 0.8,
    },
    ...extra,
  } as any;
}

describe('candidate recommendation explain', () => {
  it('builds structured embedding evidence for embedding-retrieved candidates', () => {
    const query = createFeedQuery('viewer-1', 20);
    query.userStateContext = {
      state: 'warm',
      reason: 'steady_usage',
      followedCount: 6,
      recentActionCount: 12,
      recentPositiveActionCount: 8,
      usableEmbedding: true,
      accountAgeDays: 30,
    };

    const explain = buildRecommendationExplain(candidate(), query);
    expect(explain?.primarySource).toBe('TwoTowerSource');
    expect(explain?.sourceReason).toBe('embedding_post_retrieval');
    expect(explain?.embeddingMatched).toBe(true);
    expect(explain?.diversityAdjusted).toBe(true);
    expect(explain?.evidence).toContain('author_cluster');
    expect(explain?.evidence).toContain('dense_vector');
    expect(explain?.detail).toContain('兴趣');
  });

  it('surfaces multi-source and interest-pool evidence in the reason payload', () => {
    const explain = buildRecommendationExplain(
      candidate({
        interestPoolKind: 'dense_pool',
        commentCount: 4,
        _scoreBreakdown: {
          retrievalEmbeddingScore: 0.48,
          retrievalDenseVectorScore: 0.32,
          retrievalEvidenceConfidence: 0.72,
          retrievalCrossLaneSourceCount: 1,
          contentQuality: 0.78,
        },
      }),
    );

    expect(explain?.evidence).toContain('multi_source_consensus');
    expect(explain?.evidence).toContain('high_quality_discussion');
    expect(explain?.evidence).toContain('interest_pool:dense_pool');
    expect(explain?.detail).toBe('多路召回共同推荐');
  });

  it('marks popular fallback separately from embedding-reranked popular content', () => {
    const explain = buildRecommendationExplain(
      candidate({
        recallSource: 'PopularSource',
        _scoreBreakdown: {
          retrievalEmbeddingScore: 0,
          retrievalKeywordScore: 0,
        },
      }),
    );

    expect(explain?.popularFallback).toBe(true);
    expect(explain?.sourceReason).toBe('popular_fallback');
    expect(explain?.detail).toBe('当前热门内容');
  });
});
