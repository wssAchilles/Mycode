export interface DeliveryConsumerOpsSnapshot {
  available: boolean;
  url: string;
  summary?: Record<string, unknown>;
  error?: string;
}

const DEFAULT_DELIVERY_CONSUMER_SUMMARY_URL = 'http://delivery_consumer:4100/ops/summary';

export async function readDeliveryConsumerOpsSummary(): Promise<DeliveryConsumerOpsSnapshot> {
  const url = String(
    process.env.DELIVERY_CONSUMER_SUMMARY_URL || DEFAULT_DELIVERY_CONSUMER_SUMMARY_URL,
  ).trim();

  if (!url) {
    return {
      available: false,
      url: '',
      error: 'DELIVERY_CONSUMER_SUMMARY_URL 未配置',
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
        error: `consumer summary ${response.status}`,
      };
    }

    const payload = (await response.json()) as { summary?: Record<string, unknown> };
    return {
      available: true,
      url,
      summary: payload.summary || {},
    };
  } catch (error: any) {
    return {
      available: false,
      url,
      error: error?.name === 'AbortError' ? 'consumer summary timeout' : (error?.message || 'consumer summary unavailable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}
