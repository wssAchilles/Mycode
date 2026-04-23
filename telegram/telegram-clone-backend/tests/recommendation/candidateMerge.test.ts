import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { mergeSourceCandidates } from '../../src/services/recommendation/internal/merge/candidateMerge';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import type { FeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';

function candidate(postId: string, authorId: string, source: string): FeedCandidate {
  return {
    postId: new mongoose.Types.ObjectId(),
    modelPostId: postId,
    authorId,
    content: 'candidate',
    createdAt: new Date('2026-04-23T00:00:00.000Z'),
    isReply: false,
    isRepost: false,
    recallSource: source,
    retrievalLane: source === 'FollowingSource' ? 'in_network' : source === 'GraphSource' ? 'social_expansion' : 'interest',
    inNetwork: source === 'FollowingSource',
    _scoreBreakdown: source === 'TwoTowerSource'
      ? { retrievalDenseVectorScore: 0.8 }
      : { retrievalGraphScore: 0.6 },
  };
}

describe('candidate source merge', () => {
  it('deduplicates multi-source hits while preserving cross-lane evidence', () => {
    const query = createFeedQuery('viewer-1', 6);
    query.userStateContext = {
      state: 'sparse',
      reason: 'test',
      followedCount: 8,
      recentActionCount: 10,
      recentPositiveActionCount: 5,
      usableEmbedding: true,
      accountAgeDays: 20,
    };
    query.embeddingContext = {
      interestedInClusters: [{ clusterId: 9, score: 0.9 }],
      producerEmbedding: [],
      qualityScore: 0.8,
      usable: true,
      stale: false,
    };

    const result = mergeSourceCandidates(
      query,
      [
        { sourceName: 'FollowingSource', candidates: [candidate('shared', 'author-1', 'FollowingSource')] },
        { sourceName: 'TwoTowerSource', candidates: [candidate('shared', 'author-1', 'TwoTowerSource')] },
        { sourceName: 'GraphSource', candidates: [candidate('shared', 'author-1', 'GraphSource')] },
      ],
      ['FollowingSource', 'GraphSource', 'TwoTowerSource'],
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.detail.duplicateRecallHits).toBe(2);
    expect(result.detail.crossLaneRecallEdges).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0].secondaryRecallSources).toContain('FollowingSource');
    expect(result.candidates[0]._scoreBreakdown).toMatchObject({
      retrievalSecondarySourceCount: 2,
      retrievalCrossLaneSourceCount: 2,
      retrievalDenseVectorScore: 0.8,
      retrievalGraphScore: 0.6,
    });
  });
});
