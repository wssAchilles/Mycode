import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { AgeFilter } from '../../src/services/recommendation/filters/AgeFilter';
import { createFeedQuery } from '../../src/services/recommendation/types/FeedQuery';
import type { FeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

function candidate(recallSource: string, ageDays: number): FeedCandidate {
  return {
    postId: oid('507f191e810c19729de8a061'),
    authorId: 'author-1',
    content: `${recallSource} candidate`,
    createdAt: daysAgo(ageDays),
    isReply: false,
    isRepost: false,
    recallSource,
  };
}

describe('AgeFilter sparse recall contract', () => {
  it('keeps sparse primary recall candidates while preserving the default 7 day crop', async () => {
    const query = createFeedQuery('viewer-1', 10);
    const filter = new AgeFilter(7, 180);

    const result = await filter.filter(query, [
      candidate('PopularSource', 60),
      candidate('GraphKernelSource', 60),
      candidate('FollowingSource', 60),
    ]);

    expect(result.kept.map((item) => item.recallSource)).toEqual([
      'PopularSource',
      'GraphKernelSource',
    ]);
    expect(result.removed.map((item) => item.recallSource)).toEqual(['FollowingSource']);
  });
});
