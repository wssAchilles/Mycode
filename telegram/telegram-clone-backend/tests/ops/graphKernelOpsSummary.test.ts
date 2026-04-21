import { afterEach, describe, expect, it, vi } from 'vitest';

import { readGraphKernelOpsSummary } from '../../src/services/graphKernel/ops';

describe('graph kernel ops summary normalization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives a stable summary from the detailed /ops/graph payload', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          runtime: {
            bindPort: 4300,
          },
          snapshot: {
            loaded: true,
            snapshotVersion: 'graph_snapshot_v2:test',
            loadedAt: '2026-04-21T06:24:33Z',
            vertexCount: 4,
            edgeCount: 12,
          },
          requests: {
            total: 5,
            kernelQueryCounts: {
              social_neighbors: 1,
            },
            kernelLatency: {
              social_neighbors: {
                lastMs: 3,
              },
            },
            kernelBudget: {
              social_neighbors: {
                lastRequestedLimit: 48,
                lastAvailableCount: 3,
              },
            },
          },
          refresh: {
            failures: 0,
            lastCompletedAt: '2026-04-21T06:19:32Z',
            lastDurationMs: 190,
          },
        },
      }),
    } as Response);

    const snapshot = await readGraphKernelOpsSummary();

    expect(snapshot.available).toBe(true);
    expect(snapshot.summary).toMatchObject({
      status: 'running',
      currentBlocker: 'none',
      snapshotLoaded: true,
      snapshotVersion: 'graph_snapshot_v2:test',
      requestTotal: 5,
      refreshFailures: 0,
    });
    expect(snapshot.summary?.kernelLatency).toMatchObject({
      social_neighbors: {
        lastMs: 3,
      },
    });
    expect(snapshot.summary?.kernelBudget).toMatchObject({
      social_neighbors: {
        lastRequestedLimit: 48,
        lastAvailableCount: 3,
      },
    });
  });

  it('flags an unavailable snapshot as a degraded graph summary', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          snapshot: {
            loaded: false,
          },
          requests: {},
          refresh: {},
        },
      }),
    } as Response);

    const snapshot = await readGraphKernelOpsSummary();

    expect(snapshot.summary).toMatchObject({
      status: 'degraded',
      currentBlocker: 'graph_snapshot_unavailable',
      snapshotLoaded: false,
    });
  });
});
