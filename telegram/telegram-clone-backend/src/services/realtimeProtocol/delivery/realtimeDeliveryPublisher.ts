import { redis } from '../../../config/redis';
import { chatRuntimeMetrics } from '../../chatRuntimeMetrics';
import {
  REALTIME_DELIVERY_SPEC_VERSION,
  REALTIME_EVENT_DELIVERY_STREAM_KEY,
  REALTIME_EVENT_RECENT_LIMIT,
  REALTIME_EVENT_STREAM_MAX_LEN,
  type RealtimeDeliveryEnvelopeV1,
  type RealtimeDeliveryTopic,
} from '../eventBusContracts';

type RawRedisGroupInfo = Array<Array<string | number | null>>;

interface RealtimeDeliveryConsumerGroupSummary {
  name: string;
  consumers: number;
  pending: number;
  lag?: number;
  lastDeliveredId?: string;
}

export interface RealtimeDeliveryBusSummary {
  transport: 'redis_stream';
  streamKey: string;
  specVersion: typeof REALTIME_DELIVERY_SPEC_VERSION;
  streamLength: number;
  countsByTopic: Partial<Record<RealtimeDeliveryTopic, number>>;
  recentDeliveries: RealtimeDeliveryEnvelopeV1[];
  consumerGroups: RealtimeDeliveryConsumerGroupSummary[];
  lastPublishedAt?: string;
  publishErrors: number;
}

function parseRedisGroupEntry(
  entry: Array<string | number | null>,
): RealtimeDeliveryConsumerGroupSummary | null {
  if (!Array.isArray(entry) || !entry.length) {
    return null;
  }

  const values = new Map<string, string | number | null>();
  for (let index = 0; index < entry.length; index += 2) {
    const key = entry[index];
    const value = entry[index + 1];
    if (typeof key === 'string') {
      values.set(key, value ?? null);
    }
  }

  const name = values.get('name');
  if (typeof name !== 'string' || !name) {
    return null;
  }

  const consumers = Number(values.get('consumers') ?? 0);
  const pending = Number(values.get('pending') ?? 0);
  const lagValue = values.get('lag');
  const lastDeliveredId = values.get('last-delivered-id');

  return {
    name,
    consumers: Number.isFinite(consumers) ? consumers : 0,
    pending: Number.isFinite(pending) ? pending : 0,
    lag:
      typeof lagValue === 'number'
        ? lagValue
        : typeof lagValue === 'string' && lagValue !== 'N/A'
          ? Number(lagValue)
          : undefined,
    lastDeliveredId: typeof lastDeliveredId === 'string' ? lastDeliveredId : undefined,
  };
}

async function readConsumerGroups(streamKey: string): Promise<RealtimeDeliveryConsumerGroupSummary[]> {
  try {
    const raw = (await redis.call('XINFO', 'GROUPS', streamKey)) as RawRedisGroupInfo;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((entry) => parseRedisGroupEntry(entry))
      .filter((entry): entry is RealtimeDeliveryConsumerGroupSummary => Boolean(entry));
  } catch {
    return [];
  }
}

function buildXAddFields(event: RealtimeDeliveryEnvelopeV1): string[] {
  return [
    'topic',
    event.topic,
    'deliveryId',
    event.deliveryId,
    'emittedAt',
    event.emittedAt,
    'specVersion',
    event.specVersion,
    'source',
    event.source,
    'delivery',
    JSON.stringify(event),
  ];
}

export class RedisStreamRealtimeDeliveryPublisher {
  private readonly countsByTopic: Partial<Record<RealtimeDeliveryTopic, number>> = {};
  private readonly recentDeliveries: RealtimeDeliveryEnvelopeV1[] = [];
  private publishErrors = 0;
  private lastPublishedAt?: string;

  async publish(events: RealtimeDeliveryEnvelopeV1[]): Promise<void> {
    const normalized = events.filter(Boolean);
    if (!normalized.length) {
      return;
    }

    const pipeline = redis.pipeline();
    for (const event of normalized) {
      pipeline.xadd(
        REALTIME_EVENT_DELIVERY_STREAM_KEY,
        'MAXLEN',
        '~',
        String(REALTIME_EVENT_STREAM_MAX_LEN),
        '*',
        ...buildXAddFields(event),
      );
    }

    try {
      await pipeline.exec();
      for (const event of normalized) {
        this.recordPublishedEvent(event);
      }
      chatRuntimeMetrics.increment('realtime.delivery.publish.success');
      chatRuntimeMetrics.observeValue('realtime.delivery.publish.count', normalized.length);
    } catch (error) {
      this.publishErrors += 1;
      chatRuntimeMetrics.increment('realtime.delivery.publish.errors');
      throw error;
    }
  }

  async buildSummary(recentLimit = REALTIME_EVENT_RECENT_LIMIT): Promise<RealtimeDeliveryBusSummary> {
    let streamLength = 0;
    try {
      streamLength = await redis.xlen(REALTIME_EVENT_DELIVERY_STREAM_KEY);
    } catch {
      streamLength = 0;
    }

    const consumerGroups = await readConsumerGroups(REALTIME_EVENT_DELIVERY_STREAM_KEY);

    return {
      transport: 'redis_stream',
      streamKey: REALTIME_EVENT_DELIVERY_STREAM_KEY,
      specVersion: REALTIME_DELIVERY_SPEC_VERSION,
      streamLength,
      countsByTopic: { ...this.countsByTopic },
      recentDeliveries: this.recentDeliveries.slice(0, recentLimit),
      consumerGroups,
      lastPublishedAt: this.lastPublishedAt,
      publishErrors: this.publishErrors,
    };
  }

  resetForTests(): void {
    this.recentDeliveries.splice(0, this.recentDeliveries.length);
    for (const key of Object.keys(this.countsByTopic) as RealtimeDeliveryTopic[]) {
      delete this.countsByTopic[key];
    }
    this.publishErrors = 0;
    this.lastPublishedAt = undefined;
  }

  private recordPublishedEvent(event: RealtimeDeliveryEnvelopeV1): void {
    this.countsByTopic[event.topic] = (this.countsByTopic[event.topic] || 0) + 1;
    this.lastPublishedAt = event.emittedAt;
    this.recentDeliveries.unshift(event);
    if (this.recentDeliveries.length > REALTIME_EVENT_RECENT_LIMIT) {
      this.recentDeliveries.length = REALTIME_EVENT_RECENT_LIMIT;
    }
  }
}

export const realtimeDeliveryPublisher = new RedisStreamRealtimeDeliveryPublisher();
