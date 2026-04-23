import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { recommendationAdapterService } from '../../src/services/recommendation/internal/adapterService';
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
  it('runs only the requested scorer subset for /score contract calls', async () => {
    const query = createFeedQuery('viewer-1', 20);

    const engagementOnly = await recommendationAdapterService.scoreCandidates(
      query,
      [candidate()],
      ['EngagementScorer'],
    );
    expect(engagementOnly.stages.map((stage) => stage.name)).toEqual(['EngagementScorer']);
    expect(engagementOnly.candidates[0].phoenixScores).toBeDefined();
    expect(engagementOnly.candidates[0].weightedScore).toBeUndefined();

    const withWeighted = await recommendationAdapterService.scoreCandidates(
      query,
      [candidate()],
      ['EngagementScorer', 'WeightedScorer'],
    );
    expect(withWeighted.stages.map((stage) => stage.name)).toEqual([
      'EngagementScorer',
      'WeightedScorer',
    ]);
    expect(typeof withWeighted.candidates[0].weightedScore).toBe('number');
  });
});
