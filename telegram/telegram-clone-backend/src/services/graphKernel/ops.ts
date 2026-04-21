import type { GraphKernelOpsSnapshot } from './contracts';

const DEFAULT_GRAPH_KERNEL_SUMMARY_URL = 'http://graph_kernel:4300/ops/graph';

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildGraphKernelSummary(data: {
  runtime?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  requests?: Record<string, unknown>;
  refresh?: Record<string, unknown>;
} | undefined): Record<string, unknown> {
  const providedSummary = readRecord(data?.summary);
  if (Object.keys(providedSummary).length > 0) {
    return providedSummary;
  }

  const snapshot = readRecord(data?.snapshot);
  const requests = readRecord(data?.requests);
  const refresh = readRecord(data?.refresh);
  const kernelLatency = readRecord(requests.kernelLatency);
  const kernelBudget = readRecord(requests.kernelBudget);
  const snapshotLoaded = Boolean(snapshot.loaded);

  let currentBlocker = 'none';
  if (!snapshotLoaded) {
    currentBlocker = 'graph_snapshot_unavailable';
  } else if (Object.keys(kernelLatency).length === 0) {
    currentBlocker = 'graph_kernel_latency_missing';
  } else if (Object.keys(kernelBudget).length === 0) {
    currentBlocker = 'graph_kernel_budget_missing';
  }

  return {
    status: currentBlocker === 'none' ? 'running' : 'degraded',
    currentBlocker,
    snapshotLoaded,
    snapshotVersion: snapshot.snapshotVersion ?? null,
    loadedAt: snapshot.loadedAt ?? null,
    vertexCount: snapshot.vertexCount ?? null,
    edgeCount: snapshot.edgeCount ?? null,
    requestTotal: requests.total ?? 0,
    kernelQueryCounts: readRecord(requests.kernelQueryCounts),
    kernelLatency,
    kernelBudget,
    refreshFailures: refresh.failures ?? 0,
    lastRefreshCompletedAt: refresh.lastCompletedAt ?? null,
    lastRefreshDurationMs: refresh.lastDurationMs ?? null,
  };
}

export async function readGraphKernelOpsSummary(): Promise<GraphKernelOpsSnapshot> {
  const url = String(
    process.env.CPP_GRAPH_KERNEL_SUMMARY_URL || DEFAULT_GRAPH_KERNEL_SUMMARY_URL,
  ).trim();

  if (!url) {
    return {
      available: false,
      url: '',
      error: 'CPP_GRAPH_KERNEL_SUMMARY_URL 未配置',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'x-internal-ops-client': 'node-backend',
      },
    });

    if (!response.ok) {
      return {
        available: false,
        url,
        error: `graph kernel summary ${response.status}`,
      };
    }

    const payload = (await response.json()) as {
      success?: boolean;
      data?: {
        runtime?: Record<string, unknown>;
        summary?: Record<string, unknown>;
        snapshot?: Record<string, unknown>;
        requests?: Record<string, unknown>;
        refresh?: Record<string, unknown>;
      };
    };

    return {
      available: payload.success !== false,
      url,
      summary: buildGraphKernelSummary(payload.data),
      runtime: payload.data?.runtime || {},
      snapshot: payload.data?.snapshot || {},
      requests: payload.data?.requests || {},
      refresh: payload.data?.refresh || {},
    };
  } catch (error: any) {
    return {
      available: false,
      url,
      error:
        error?.name === 'AbortError'
          ? 'graph kernel summary timeout'
          : (error?.message || 'graph kernel summary unavailable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}
