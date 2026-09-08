import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isGraphKernelEnabled,
  parseGraphKernelCandidateResponse,
} from '../../src/services/graphKernel/kernelClient';
import {
  parseGraphKernelEnabled,
  readGraphKernelEnablement,
} from '../../src/services/graphKernel/contracts';

describe('graph kernel diagnostics contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it.each([
    ['1', true],
    ['true', true],
    ['yes', true],
    ['on', true],
    [' TRUE ', true],
    ['0', false],
    ['false', false],
    ['no', false],
    ['off', false],
    [' OFF ', false],
  ])('uses the shared boolean aliases for %s', (value, expected) => {
    expect(parseGraphKernelEnabled(value)).toBe(expected);
  });

  it('defaults only when the flag is absent and safely disables unknown runtime values', () => {
    expect(parseGraphKernelEnabled(undefined)).toBe(true);
    expect(parseGraphKernelEnabled('')).toBe(true);
    expect(() => parseGraphKernelEnabled('treu')).toThrow(
      'invalid_boolean_env:CPP_GRAPH_KERNEL_ENABLED=treu',
    );
    expect(readGraphKernelEnablement('treu')).toMatchObject({
      enabled: false,
      valid: false,
      error: 'invalid_boolean_env:CPP_GRAPH_KERNEL_ENABLED=treu: expected one of 1/0, true/false, yes/no, or on/off',
    });

    vi.stubEnv('CPP_GRAPH_KERNEL_ENABLED', 'treu');
    expect(isGraphKernelEnabled()).toBe(false);
  });
});
