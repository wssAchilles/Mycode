import { describe, expect, it, vi } from 'vitest';

import UserFeatureVector from '../../src/models/UserFeatureVector';

describe('UserFeatureVector write cancellation', () => {
  it('passes signal to the upsert query and observes abort after I/O', async () => {
    const controller = new AbortController();
    const findOneAndUpdate = vi.spyOn(UserFeatureVector, 'findOneAndUpdate')
      .mockImplementation(async () => {
        controller.abort(new Error('lease lost during embedding upsert'));
        return { userId: 'user-1' } as never;
      });

    await expect(UserFeatureVector.upsertEmbedding(
      'user-1',
      { interestedInClusters: [] },
      1,
      controller.signal,
    )).rejects.toThrow('lease lost during embedding upsert');

    expect(findOneAndUpdate.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      signal: controller.signal,
    }));
  });
});
