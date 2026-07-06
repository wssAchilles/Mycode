import { describe, expect, it } from 'vitest';

import { parseGraphKernelCandidateResponse } from '../../src/services/graphKernel/kernelClient';

describe('graph kernel diagnostics contract', () => {
  it('preserves graph diagnostics for traces and degrade decisions', () => {
    const parsed = parseGraphKernelCandidateResponse({
      candidates: [{ userId: 'author_1', score: 0.6, relationKinds: ['follow'] }],
      diagnostics: {
        snapshotVersion: 'snapshot_2026_07_06',
        budgetExhausted: false,
        truncatedCount: 3,
        emptyReason: null,
      },
    });

    expect(parsed.candidates).toEqual([
      { userId: 'author_1', score: 0.6, relationKinds: ['follow'] },
    ]);
    expect(parsed.diagnostics).toEqual({
      snapshotVersion: 'snapshot_2026_07_06',
      budgetExhausted: false,
      truncatedCount: 3,
      emptyReason: null,
    });
  });
});
