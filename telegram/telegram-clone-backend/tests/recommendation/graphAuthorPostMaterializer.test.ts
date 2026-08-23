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
});
