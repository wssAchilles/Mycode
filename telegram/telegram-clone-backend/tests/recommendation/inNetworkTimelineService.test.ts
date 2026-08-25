import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const pipeline = {
    zadd: vi.fn(),
    zremrangebyscore: vi.fn(),
    zrevrangebyscore: vi.fn(),
    expire: vi.fn(),
    zcard: vi.fn(),
    exec: vi.fn(),
  };
  return {
    pipeline,
    redis: {
      pipeline: vi.fn(() => pipeline),
      zremrangebyrank: vi.fn(),
    },
  };
});

vi.mock('../../src/config/redis', () => ({
  redis: mocks.redis,
}));

import { InNetworkTimelineService } from '../../src/services/recommendation/InNetworkTimelineService';

describe('InNetworkTimelineService write retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pipeline.zadd.mockReturnThis();
    mocks.pipeline.zremrangebyscore.mockReturnThis();
    mocks.pipeline.zrevrangebyscore.mockReturnThis();
    mocks.pipeline.expire.mockReturnThis();
    mocks.pipeline.zcard.mockReturnThis();
    mocks.pipeline.exec.mockResolvedValue([
      [null, 1],
      [null, 1],
      [null, 1],
      [null, 1],
      [null, 1],
      [null, 1],
      [null, 201],
      [null, 250],
    ]);
  });

  it('applies the per-author cap to both timeline key variants', async () => {
    await InNetworkTimelineService.addPost(
      'author-1',
      'post-201',
      new Date('2026-08-24T00:00:00.000Z'),
    );

    expect(mocks.redis.zremrangebyrank).toHaveBeenNthCalledWith(
      1,
      'tl:author:author-1',
      0,
      0,
    );
    expect(mocks.redis.zremrangebyrank).toHaveBeenNthCalledWith(
      2,
      'timeline:author:author-1',
      0,
      49,
    );
  });

  it('drops non-finite scores from the merged timeline', async () => {
    mocks.pipeline.exec.mockResolvedValueOnce([
      [
        null,
        [
          'post-valid',
          '123',
          'post-positive-infinity',
          'Infinity',
          'post-negative-infinity',
          '-Infinity',
          'post-nan',
          'NaN',
        ],
      ],
    ]);

    const result = await InNetworkTimelineService.getMergedPostIdsForAuthorsWithSummary({
      authorIds: ['author-1'],
      maxResults: 10,
    });

    expect(result.postIds).toEqual(['post-valid']);
    expect(result.summary.scannedHitCount).toBe(1);
  });
});
