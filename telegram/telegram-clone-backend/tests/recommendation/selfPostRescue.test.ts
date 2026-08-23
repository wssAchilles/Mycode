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

    const candidates = await materializeSelfPosts({ userId: 'user-1', limit: 5 });

    expect(mocks.postFind).toHaveBeenCalledWith(expect.objectContaining({
      authorId: 'user-1',
      isNsfw: { $ne: true },
    }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isNsfw).toBe(false);
  });
});
