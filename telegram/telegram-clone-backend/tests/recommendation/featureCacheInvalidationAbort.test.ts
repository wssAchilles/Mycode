import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redisDel: vi.fn(),
}));

vi.mock('../../src/config/redis', () => ({
  redis: { del: mocks.redisDel },
}));

import { FeatureCacheService } from '../../src/services/recommendation/FeatureCacheService';

describe('FeatureCacheService invalidation cancellation', () => {
  it('does not mutate Redis when already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('lease already lost'));

    await expect(FeatureCacheService.getInstance().invalidateUserEmbedding(
      'user-1',
      controller.signal,
    )).rejects.toThrow('lease already lost');
    expect(mocks.redisDel).not.toHaveBeenCalled();
  });

  it('waits for an in-flight Redis delete before observing abort', async () => {
    const controller = new AbortController();
    let resolveDelete!: () => void;
    mocks.redisDel.mockReturnValue(new Promise<void>((resolve) => { resolveDelete = resolve; }));
    let settled = false;

    const invalidation = FeatureCacheService.getInstance()
      .invalidateUserEmbedding('user-2', controller.signal)
      .finally(() => { settled = true; });
    await vi.waitFor(() => expect(mocks.redisDel).toHaveBeenCalled());
    controller.abort(new Error('lease lost in flight'));
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveDelete();
    await expect(invalidation).rejects.toThrow('lease lost in flight');
  });
});
