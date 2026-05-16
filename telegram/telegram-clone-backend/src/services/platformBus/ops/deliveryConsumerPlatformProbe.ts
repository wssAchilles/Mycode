export interface DeliveryConsumerPlatformProbeSnapshot {
  available: boolean;
  url: string;
  probe?: Record<string, unknown>;
  error?: string;
}

const DEFAULT_DELIVERY_CONSUMER_PLATFORM_PROBE_URL = 'http://delivery_consumer:4100/ops/platform/probe';
const EXPECTED_PLATFORM_PROBE_CONTRACT_VERSION = 'delivery_consumer_platform_probe_v1';

export async function readDeliveryConsumerPlatformProbe(): Promise<DeliveryConsumerPlatformProbeSnapshot> {
  const url = String(
    process.env.DELIVERY_CONSUMER_PLATFORM_PROBE_URL || DEFAULT_DELIVERY_CONSUMER_PLATFORM_PROBE_URL,
  ).trim();

  if (!url) {
    return {
      available: false,
      url: '',
      error: 'DELIVERY_CONSUMER_PLATFORM_PROBE_URL 未配置',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const internalToken = String(process.env.DELIVERY_CONSUMER_INTERNAL_TOKEN || '').trim();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'x-internal-ops-client': 'node-backend',
        ...(internalToken ? { 'x-internal-token': internalToken } : {}),
      },
    });
    if (!response.ok) {
      return {
        available: false,
        url,
        error: `consumer platform probe ${response.status}`,
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    if (payload.contractVersion !== EXPECTED_PLATFORM_PROBE_CONTRACT_VERSION) {
      return {
        available: false,
        url,
        probe: payload,
        error: `consumer platform probe contract drift: ${String(payload.contractVersion || 'missing')}`,
      };
    }
    return {
      available: Boolean(payload.ok ?? true),
      url,
      probe: payload,
    };
  } catch (error: any) {
    return {
      available: false,
      url,
      error:
        error?.name === 'AbortError'
          ? 'consumer platform probe timeout'
          : (error?.message || 'consumer platform probe unavailable'),
    };
  } finally {
    clearTimeout(timeout);
  }
}
