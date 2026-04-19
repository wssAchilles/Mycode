export interface DeliveryConsumerReplaySummarySnapshot {
  available: boolean;
  url: string;
  summary?: Record<string, unknown>;
  error?: string;
}

const DEFAULT_DELIVERY_CONSUMER_REPLAY_SUMMARY_URL = 'http://delivery_consumer:4100/ops/platform/replay/summary';

export async function readDeliveryConsumerReplaySummary(): Promise<DeliveryConsumerReplaySummarySnapshot> {
  const url = String(
    process.env.DELIVERY_CONSUMER_REPLAY_SUMMARY_URL || DEFAULT_DELIVERY_CONSUMER_REPLAY_SUMMARY_URL,
  ).trim();

  if (!url) {
    return {
      available: false,
      url: '',
      error: 'DELIVERY_CONSUMER_REPLAY_SUMMARY_URL 未配置',
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
        error: `consumer replay summary ${response.status}`,
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    return {
      available: Boolean(payload.available ?? true),
      url,
      summary: payload,
    };
  } catch (error: any) {
    return {
      available: false,
      url,
      error: error?.name === 'AbortError' ? 'consumer replay summary timeout' : (error?.message || 'consumer replay summary unavailable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}
