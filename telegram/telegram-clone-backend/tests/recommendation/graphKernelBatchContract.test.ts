import { describe, expect, it } from 'vitest';

import {
  parseGraphKernelBatchMode,
  parseGraphKernelBatchResponse,
} from '../../src/services/graphKernel/kernelClient';
import type {
  GraphKernelBridgeCandidate,
  GraphKernelDiagnostics,
} from '../../src/services/graphKernel/contracts';

type Assert<T extends true> = T;
type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];
type ParsedBatchResult = ReturnType<typeof parseGraphKernelBatchResponse>['socialNeighbors'];
type BatchResultRequiresDiagnostics = Assert<
  {} extends Pick<ParsedBatchResult, 'diagnostics'> ? false : true
>;
type BatchDiagnosticsRequireEveryField = Assert<
  OptionalKeys<NonNullable<ParsedBatchResult['diagnostics']>> extends never ? true : false
>;

const batchTypeContract: [BatchResultRequiresDiagnostics, BatchDiagnosticsRequireEveryField] = [
  true,
  true,
];

const snapshotVersion = 'snapshot-v7';
const snapshotLoadedAtMs = 1_783_278_000_000;

function diagnostics(kernel: string, candidateCount = 0) {
  return {
    kernel,
    queryDurationMs: 1,
    candidateCount,
    requestedLimit: 10,
    availableCount: candidateCount,
    truncatedCount: 0,
    scannedCount: candidateCount,
    visitedCount: 0,
    snapshotVersion,
    snapshotLoadedAtMs,
    prunedCount: 0,
    frontierMaxSize: 0,
    budgetExhausted: false,
    empty: candidateCount === 0,
    emptyReason: candidateCount === 0 ? 'no_candidates' : null,
    relationKinds: [],
  };
}

function validBatchPayload() {
  return {
    userId: 'viewer-1',
    snapshotVersion,
    snapshotLoadedAtMs,
    socialNeighbors: {
      candidates: [{ userId: 'author-1', score: 0.9 }],
      diagnostics: {
        ...diagnostics('social_neighbors', 1),
        availableCount: 4,
        scannedCount: 12,
        truncatedCount: 3,
      },
    },
    recentEngagers: {
      candidates: [],
      diagnostics: diagnostics('recent_engagers'),
    },
    bridgeUsers: {
      candidates: [],
      diagnostics: diagnostics('bridge_users'),
    },
    coEngagers: {
      candidates: [],
      diagnostics: diagnostics('co_engagers'),
    },
    contentAffinityNeighbors: {
      candidates: [],
      diagnostics: diagnostics('content_affinity_neighbors'),
    },
  };
}

describe('graph kernel batch contract', () => {
  it('defaults the batch client mode to disabled', () => {
    expect(parseGraphKernelBatchMode(undefined)).toBe('disabled');
    expect(parseGraphKernelBatchMode('shadow')).toBe('shadow_compare');
    expect(parseGraphKernelBatchMode('compare')).toBe('shadow_compare');
  });

  it('parses one required snapshot identity and five kernel responses', () => {
    const response = parseGraphKernelBatchResponse(validBatchPayload());
    const requiredDiagnostics: Required<GraphKernelDiagnostics> =
      response.socialNeighbors.diagnostics;

    expect(response.userId).toBe('viewer-1');
    expect(response.snapshotVersion).toBe('snapshot-v7');
    expect(response.snapshotLoadedAtMs).toBe(1_783_278_000_000);
    expect(response.socialNeighbors.candidates).toHaveLength(1);
    expect(response.socialNeighbors.diagnostics).toMatchObject({
      scannedCount: 12,
      visitedCount: 0,
      truncatedCount: 3,
      budgetExhausted: false,
    });
    expect(requiredDiagnostics.kernel).toBe('social_neighbors');
    expect(batchTypeContract).toEqual([true, true]);
    expect(response.recentEngagers.candidates).toEqual([]);
    expect(response.bridgeUsers.candidates).toEqual([]);
    expect(response.coEngagers.candidates).toEqual([]);
    expect(response.contentAffinityNeighbors.candidates).toEqual([]);
  });

  it('rejects a batch response without its snapshot identity', () => {
    expect(() => parseGraphKernelBatchResponse({
      userId: 'viewer-1',
      socialNeighbors: { candidates: [] },
      recentEngagers: { candidates: [] },
      bridgeUsers: { candidates: [] },
      coEngagers: { candidates: [] },
      contentAffinityNeighbors: { candidates: [] },
    })).toThrow('graph kernel batch missing snapshot identity');
  });

  it.each([
    {
      name: 'whitespace-only response user id',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.userId = ' \t ';
      },
      message: 'graph kernel batch invalid response: userId must be a non-empty string',
    },
    {
      name: 'whitespace-only top-level snapshot version',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.snapshotVersion = ' \t ';
      },
      message: 'graph kernel batch missing snapshot identity',
    },
    {
      name: 'zero top-level snapshot timestamp',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.snapshotLoadedAtMs = 0;
      },
      message:
        'graph kernel batch invalid response: snapshotLoadedAtMs must be a positive safe integer',
    },
    {
      name: 'zero per-kernel snapshot timestamp',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.socialNeighbors.diagnostics.snapshotLoadedAtMs = 0;
      },
      message:
        'graph kernel batch invalid socialNeighbors: snapshotLoadedAtMs must be a positive safe integer',
    },
  ])('rejects $name', ({ mutate, message }) => {
    const payload = validBatchPayload();
    mutate(payload);

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(message);
  });

  it('rejects a response for another user', () => {
    expect(() => parseGraphKernelBatchResponse(validBatchPayload(), 'viewer-2')).toThrow(
      'graph kernel batch invalid response: userId mismatch',
    );
  });

  it('rejects a numeric-string top-level snapshot timestamp', () => {
    const payload = validBatchPayload() as unknown as Record<string, unknown>;
    payload.snapshotLoadedAtMs = String(snapshotLoadedAtMs);

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(
      'graph kernel batch invalid response: snapshotLoadedAtMs must be a non-negative safe integer',
    );
  });

  it.each([
    {
      name: 'fractional diagnostic duration',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.socialNeighbors.diagnostics.queryDurationMs = 1.5;
      },
      message: 'graph kernel batch invalid socialNeighbors: queryDurationMs must be a non-negative safe integer',
    },
    {
      name: 'unsafe top-level timestamp',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.snapshotLoadedAtMs = Number.MAX_SAFE_INTEGER + 1;
      },
      message: 'graph kernel batch invalid response: snapshotLoadedAtMs must be a non-negative safe integer',
    },
  ])('rejects $name', ({ mutate, message }) => {
    const payload = validBatchPayload();
    mutate(payload);

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(message);
  });

  it.each([
    {
      name: 'empty state mismatch',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.socialNeighbors.diagnostics.empty = true;
      },
      message: 'graph kernel batch invalid socialNeighbors: empty state mismatch',
    },
    {
      name: 'available count below candidate count',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.socialNeighbors.diagnostics.availableCount = 0;
      },
      message: 'graph kernel batch invalid socialNeighbors: availableCount below candidateCount',
    },
    {
      name: 'truncated count mismatch',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.socialNeighbors.diagnostics.truncatedCount = 2;
      },
      message: 'graph kernel batch invalid socialNeighbors: truncatedCount mismatch',
    },
    {
      name: 'candidate count above requested limit',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.socialNeighbors.diagnostics.requestedLimit = 0;
      },
      message: 'graph kernel batch invalid socialNeighbors: candidateCount exceeds requestedLimit',
    },
  ])('rejects $name', ({ mutate, message }) => {
    const payload = validBatchPayload();
    mutate(payload);

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(message);
  });

  it('rejects a batch response missing any kernel result', () => {
    expect(() => parseGraphKernelBatchResponse({
      userId: 'viewer-1',
      snapshotVersion: 'snapshot-v7',
      snapshotLoadedAtMs: 1_783_278_000_000,
      recentEngagers: { candidates: [] },
      bridgeUsers: { candidates: [] },
      coEngagers: { candidates: [] },
      contentAffinityNeighbors: { candidates: [] },
    })).toThrow('graph kernel batch missing kernel response: socialNeighbors');
  });

  it('rejects a kernel result without candidates', () => {
    const payload = validBatchPayload();
    delete (payload.socialNeighbors as Partial<typeof payload.socialNeighbors>).candidates;

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(
      'graph kernel batch invalid socialNeighbors: candidates must be an array',
    );
  });

  it('rejects a kernel result without diagnostics', () => {
    const payload = validBatchPayload();
    delete (payload.socialNeighbors as Partial<typeof payload.socialNeighbors>).diagnostics;

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(
      'graph kernel batch invalid socialNeighbors: diagnostics are required',
    );
  });

  it('rejects per-kernel snapshot identity mismatch', () => {
    const payload = validBatchPayload();
    payload.socialNeighbors.diagnostics.snapshotVersion = 'snapshot-v8';

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(
      'graph kernel batch invalid socialNeighbors: snapshot identity mismatch',
    );
  });

  it('rejects malformed candidates', () => {
    const payload = validBatchPayload();
    payload.socialNeighbors.candidates = [{ userId: '', score: Number.NaN }];

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(
      'graph kernel batch invalid socialNeighbors candidate at index 0',
    );
  });

  it.each([
    {
      name: 'diagnostics snapshot version',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.socialNeighbors.diagnostics.snapshotVersion = ' \t ';
      },
      message:
        'graph kernel batch invalid socialNeighbors: snapshotVersion must be a non-empty string',
    },
    {
      name: 'neighbor candidate user id',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        payload.socialNeighbors.candidates[0].userId = ' \t ';
      },
      message: 'graph kernel batch invalid socialNeighbors candidate at index 0',
    },
    {
      name: 'bridge candidate user id',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        (payload.bridgeUsers as { candidates: GraphKernelBridgeCandidate[] }).candidates = [{
          userId: ' \t ',
          score: 0.8,
          depth: 2,
          pathCount: 1,
          viaUserIds: ['via-1'],
        }];
        payload.bridgeUsers.diagnostics = diagnostics('bridge_users', 1);
      },
      message: 'graph kernel batch invalid bridgeUsers candidate at index 0',
    },
    {
      name: 'bridge candidate via user id',
      mutate: (payload: ReturnType<typeof validBatchPayload>) => {
        (payload.bridgeUsers as { candidates: GraphKernelBridgeCandidate[] }).candidates = [{
          userId: 'bridge-1',
          score: 0.8,
          depth: 2,
          pathCount: 1,
          viaUserIds: [' \t '],
        }];
        payload.bridgeUsers.diagnostics = diagnostics('bridge_users', 1);
      },
      message: 'graph kernel batch invalid bridgeUsers candidate at index 0',
    },
  ])('rejects whitespace-only $name', ({ mutate, message }) => {
    const payload = validBatchPayload();
    mutate(payload);

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(message);
  });

  it('rejects unsafe bridge traversal counts', () => {
    const payload = validBatchPayload();
    (payload.bridgeUsers as { candidates: GraphKernelBridgeCandidate[] }).candidates = [{
      userId: 'bridge-1',
      score: 0.8,
      depth: Number.MAX_SAFE_INTEGER + 1,
      pathCount: 1,
      viaUserIds: ['via-1'],
    }];
    payload.bridgeUsers.diagnostics = diagnostics('bridge_users', 1);

    expect(() => parseGraphKernelBatchResponse(payload)).toThrow(
      'graph kernel batch invalid bridgeUsers candidate at index 0',
    );
  });
});
