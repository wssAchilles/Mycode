import type { GraphKernelOpsSnapshot } from './contracts';

const DEFAULT_GRAPH_KERNEL_SUMMARY_URL = 'http://graph_kernel:4300/ops/graph';

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
