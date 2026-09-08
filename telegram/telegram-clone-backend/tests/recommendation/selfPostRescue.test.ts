import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postFind: vi.fn(),
  userFindByPk: vi.fn(),
}));

vi.mock('../../src/models/Post', () => ({
  default: {
    find: mocks.postFind,
  },
}));

vi.mock('../../src/models/User', () => ({
  default: {
    findByPk: mocks.userFindByPk,
  },
}));

import { materializeSelfPosts } from '../../src/services/recommendation/providers/selfPostRescue/materializeSelfPosts';

describe('self post rescue', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('excludes NSFW posts at the provider boundary', async () => {
    const posts = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{
        _id: 'post-1',
        authorId: 'user-1',
        content: 'safe',
        createdAt: new Date('2026-08-22T00:00:00.000Z'),
        isNsfw: false,
      }]),
    };
    mocks.postFind.mockReturnValue(posts);
    mocks.userFindByPk.mockResolvedValue({ username: 'user-1', avatarUrl: null });

    const excludedPostId = '507f1f77bcf86cd799439011';
    const candidates = await materializeSelfPosts({
      userId: 'user-1',
      limit: 5,
      excludePostIds: [excludedPostId, 'not-an-object-id'],
    });

    expect(mocks.postFind).toHaveBeenCalledWith(expect.objectContaining({
      authorId: 'user-1',
      isNsfw: { $ne: true },
      _id: { $nin: [expect.objectContaining({})] },
    }));
    const query = mocks.postFind.mock.calls[0][0] as { _id: { $nin: Array<{ toString(): string }> } };
    expect(query._id.$nin.map((id) => id.toString())).toEqual([excludedPostId]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isNsfw).toBe(false);
  });
});
