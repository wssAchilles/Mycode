import { describe, expect, it, vi } from 'vitest';

import RealGraphEdge, { DEFAULT_COUNTS } from '../../src/models/RealGraphEdge';

describe('RealGraphEdge decay cancellation', () => {
  it('passes signal to Mongo and stops before a second edge mutation', async () => {
    const controller = new AbortController();
    const makeEdge = () => ({
      _id: 'edge-id',
      lastDecayAppliedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      rollupCounts: { ...DEFAULT_COUNTS, likeCount: 10 },
      dailyCounts: { ...DEFAULT_COUNTS },
      decayedSum: 10,
      save: vi.fn(async () => {
        controller.abort(new Error('lease lost during edge write'));
      }),
    });
    const edges = [makeEdge(), makeEdge()];
    const query = {
      limit: vi.fn(() => query),
      setOptions: vi.fn(() => query),
      then: (resolve: (value: typeof edges) => void) => resolve(edges),
    };
    vi.spyOn(RealGraphEdge, 'find').mockReturnValue(query as never);
    const updateOne = vi.spyOn(RealGraphEdge, 'updateOne').mockImplementation(async () => {
      controller.abort(new Error('lease lost during edge write'));
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 } as never;
    });

    await expect(RealGraphEdge.applyDailyDecay(10, controller.signal))
      .rejects.toThrow('lease lost during edge write');

    expect(query.setOptions).toHaveBeenCalledWith({ signal: controller.signal });
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ signal: controller.signal }));
    expect(edges[1].save).not.toHaveBeenCalled();
  });
});
