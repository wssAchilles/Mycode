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

  it('surfaces trend, exploration and selector signals for frontend explain UI', () => {
    const explain = buildRecommendationExplain(
      candidate({
        selectionPool: 'trend',
        selectionReason: 'trend_affinity_primary',
        _scoreBreakdown: {
          retrievalKeywordScore: 0.34,
          trendAffinityStrength: 0.22,
          trendPersonalizationStrength: 0.16,
          explorationEligible: 1,
          explorationRisk: 0.24,
          explorationNovelty: 0.52,
          interestDecayMultiplier: 1.08,
          interestDecayNegativePenalty: 0.04,
          negativeFeedbackMultiplier: 0.94,
          sessionSuppressionStrength: 0.04,
        },
      }),
    );

    expect(explain?.detail).toBe('你关注的趋势话题');
    expect(explain?.selectionPool).toBe('trend');
    expect(explain?.selectionReason).toBe('trend_affinity_primary');
    expect(explain?.evidence).toContain('trend_personalized');
    expect(explain?.evidence).toContain('trend_affinity');
    expect(explain?.evidence).toContain('safe_exploration');
    expect(explain?.evidence).toContain('novelty_budget');
    expect(explain?.evidence).toContain('recent_interest_lift');
    expect(explain?.evidence).toContain('negative_feedback_guardrail');
    expect(explain?.evidence).toContain('selection_reason:trend_affinity_primary');
    expect(explain?.signals?.trendPersonalizationStrength).toBe(0.16);
  });

  it('surfaces news trend linkage as a natural frontend reason', () => {
    const explain = buildRecommendationExplain(
      candidate({
        recallSource: 'NewsAnnSource',
        isNews: true,
        _scoreBreakdown: {
          retrievalKeywordScore: 0.28,
          newsTrendLinkStrength: 0.24,
          newsTrendLinkMultiplier: 1.04,
          strategyVersionHash: 0.52,
        },
      }),
    );

    expect(explain?.detail).toBe('热点新闻趋势联动');
    expect(explain?.sourceReason).toBe('news_ann_embedding');
    expect(explain?.evidence).toContain('news_trend_link');
    expect(explain?.evidence).toContain('versioned_strategy_policy');
    expect(explain?.signals?.newsTrendLinkStrength).toBe(0.24);
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
