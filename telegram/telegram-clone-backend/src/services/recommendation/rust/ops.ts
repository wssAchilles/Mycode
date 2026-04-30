export interface RustRecommendationOpsSnapshot {
  available: boolean;
  url: string;
  summary?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  error?: string;
}

const DEFAULT_RUST_RECOMMENDATION_SUMMARY_URL = 'http://recommendation:4200/ops/recommendation/summary';

export async function readRustRecommendationOpsSummary(): Promise<RustRecommendationOpsSnapshot> {
  const url = String(
    process.env.RUST_RECOMMENDATION_SUMMARY_URL || DEFAULT_RUST_RECOMMENDATION_SUMMARY_URL,
  ).trim();

  if (!url) {
    return {
      available: false,
      url: '',
      error: 'RUST_RECOMMENDATION_SUMMARY_URL 未配置',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: rustRecommendationOpsHeaders(),
    });

    if (!response.ok) {
      return {
        available: false,
        url,
        error: `recommendation summary ${response.status}`,
      };
    }

    const payload = (await response.json()) as {
      summary?: Record<string, unknown>;
      runtime?: Record<string, unknown>;
    };

    return {
      available: true,
      url,
      summary: payload.summary || {},
      runtime: payload.runtime || {},
    };
  } catch (error: any) {
    return {
      available: false,
      url,
      error:
        error?.name === 'AbortError'
          ? 'recommendation summary timeout'
          : (error?.message || 'recommendation summary unavailable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function rustRecommendationOpsHeaders(): Record<string, string> {
  const token = String(process.env.RECOMMENDATION_INTERNAL_TOKEN || '').trim();
  return {
    'x-internal-ops-client': 'node-backend',
    ...(token
      ? {
          authorization: `Bearer ${token}`,
          'x-recommendation-internal-token': token,
        }
      : {}),
  };
}
