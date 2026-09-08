import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postAggregate: vi.fn(),
}));

vi.mock('../../src/models/Post', () => ({
  default: {
    aggregate: mocks.postAggregate,
  },
}));

import { materializeGraphAuthorPostsWithDiagnostics } from '../../src/services/recommendation/providers/graphKernel/authorPostMaterializer';

describe('graph author post materializer', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows MongoDB to spill large author groups to disk', async () => {
    const aggregate = Object.assign(
      Promise.resolve([{
        _id: 'post-materializer-disk-1',
        authorId: 'author-materializer-disk-1',
        content: 'content',
        createdAt: new Date('2026-08-22T00:00:00.000Z'),
        isNsfw: false,
        isNews: false,
      }]),
      {
        allowDiskUse: vi.fn(function (this: unknown) {
          return this;
        }),
      },
    );
    mocks.postAggregate.mockReturnValue(aggregate);

    const result = await materializeGraphAuthorPostsWithDiagnostics({
      authorIds: ['author-materializer-disk-1'],
      limitPerAuthor: 2,
      lookbackDays: 7,
    });

    expect(aggregate.allowDiskUse).toHaveBeenCalledWith(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].postId.toString()).toBe('post-materializer-disk-1');
  });

  it('isolates continuation cursors in both Mongo filtering and cache identity', async () => {
    const aggregateResult = () => Object.assign(Promise.resolve([]), {
      allowDiskUse: vi.fn(function (this: unknown) {
        return this;
      }),
    });
    mocks.postAggregate
      .mockReturnValueOnce(aggregateResult())
      .mockReturnValueOnce(aggregateResult());
    const firstCursor = new Date('2026-08-28T12:00:00.000Z');
    const secondCursor = new Date('2026-08-27T12:00:00.000Z');
    const baseOptions = {
      authorIds: ['author-materializer-cursor-1'],
      limitPerAuthor: 2,
      lookbackDays: 7,
    };

    const first = await materializeGraphAuthorPostsWithDiagnostics({
      ...baseOptions,
      createdBefore: firstCursor,
    });
    const second = await materializeGraphAuthorPostsWithDiagnostics({
      ...baseOptions,
      createdBefore: secondCursor,
    });
    const replay = await materializeGraphAuthorPostsWithDiagnostics({
      ...baseOptions,
      createdBefore: firstCursor,
    });

    expect(mocks.postAggregate).toHaveBeenCalledTimes(2);
    expect(mocks.postAggregate.mock.calls[0][0][0].$match.createdAt).toEqual({
      $gte: expect.any(Date),
      $lt: firstCursor,
    });
    expect(mocks.postAggregate.mock.calls[1][0][0].$match.createdAt).toEqual({
      $gte: expect.any(Date),
      $lt: secondCursor,
    });
    expect(first.diagnostics.cacheHit).toBe(false);
    expect(second.diagnostics.cacheHit).toBe(false);
    expect(replay.diagnostics.cacheHit).toBe(true);
  });
});
