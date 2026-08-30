import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import { recommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';
import { EngagementScorer } from '../../src/services/recommendation/scorers/EngagementScorer';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';

function candidate(extra?: Record<string, unknown>) {
  return {
    postId: new mongoose.Types.ObjectId('507f191e810c19729de86001'),
    authorId: 'author-1',
    content: 'scorer selection test',
    createdAt: new Date('2026-04-22T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    likeCount: 3,
    commentCount: 1,
    repostCount: 0,
    inNetwork: false,
    recallSource: 'PopularSource',
    ...extra,
  } as any;
}

describe('recommendation adapter scorer selection', () => {
  it('runs only provider scorers for /score contract calls', async () => {
    const query = createFeedQuery('viewer-1', 20);

    const engagementOnly = await recommendationAdapterService.scoreCandidates(
      query,
      [candidate()],
      ['EngagementScorer'],
    );
    expect(engagementOnly.stages.map((stage) => stage.name)).toEqual(['EngagementScorer']);
    expect(engagementOnly.candidates[0].phoenixScores).toBeDefined();
    expect(engagementOnly.candidates[0].weightedScore).toBeUndefined();

    await expect(
      recommendationAdapterService.scoreCandidates(
        query,
        [candidate()],
        ['EngagementScorer', 'WeightedScorer'],
      ),
    ).rejects.toThrow('non_provider_scorer:WeightedScorer');

    await expect(
      recommendationAdapterService.scoreCandidates(
        query,
        [candidate()],
        ['EngagementScorer', 'EngagementScorer'],
      ),
    ).rejects.toThrow('duplicate_provider_scorer:EngagementScorer');

    await expect(
      recommendationAdapterService.scoreCandidates(
        query,
        [candidate()],
        ['MissingScorer'],
      ),
    ).rejects.toThrow('unknown_scorer:MissingScorer');
  });

  it('records a provider contract error when a scorer returns the wrong cardinality', async () => {
    const query = createFeedQuery('viewer-1', 20);
    const score = vi.spyOn(EngagementScorer.prototype, 'score').mockResolvedValueOnce([]);

    try {
      const result = await recommendationAdapterService.scoreCandidates(
        query,
        [candidate()],
        ['EngagementScorer'],
      );

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        postId: new mongoose.Types.ObjectId('507f191e810c19729de86001'),
        content: 'scorer selection test',
      });
      expect(result.candidates[0].phoenixScores).toBeUndefined();
      expect(result.stages).toHaveLength(1);
      expect(result.stages[0]).toMatchObject({
        name: 'EngagementScorer',
        inputCount: 1,
        outputCount: 1,
        detail: {
          error: 'scorer_contract_violation:EngagementScorer:length_mismatch:1:0',
          errorClass: 'provider_contract_error',
          scoredCount: 0,
        },
      });
    } finally {
      score.mockRestore();
    }
  });
});
