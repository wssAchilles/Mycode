import { redis } from '../../config/redis';
import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import {
  REALTIME_EVENT_RECENT_LIMIT,
  REALTIME_EVENT_SPEC_VERSION,
  REALTIME_EVENT_STREAM_KEY,
  REALTIME_EVENT_STREAM_MAX_LEN,
  type RealtimeEventBusConsumerGroupSummary,
  type RealtimeEventBusSummary,
  type RealtimeEventEnvelopeV1,
  type RealtimeEventTopic,
} from './eventBusContracts';

type RawRedisGroupInfo = Array<Array<string | number | null>>;

function parseRedisGroupEntry(
  entry: Array<string | number | null>,
): RealtimeEventBusConsumerGroupSummary | null {
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

async function readConsumerGroups(streamKey: string): Promise<RealtimeEventBusConsumerGroupSummary[]> {
  try {
    const raw = (await redis.call('XINFO', 'GROUPS', streamKey)) as RawRedisGroupInfo;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((entry) => parseRedisGroupEntry(entry))
      .filter((entry): entry is RealtimeEventBusConsumerGroupSummary => Boolean(entry));
  } catch {
    return [];
  }
}

function buildXAddFields(event: RealtimeEventEnvelopeV1): string[] {
  return [
    'topic',
    event.topic,
    'eventId',
    event.eventId,
    'partitionKey',
    event.partitionKey,
    'emittedAt',
    event.emittedAt,
    'specVersion',
    event.specVersion,
    'source',
    event.source,
    'event',
    JSON.stringify(event),
  ];
}

export class RedisStreamRealtimeEventPublisher {
  private readonly countsByTopic: Partial<Record<RealtimeEventTopic, number>> = {};
  private readonly recentEvents: RealtimeEventEnvelopeV1[] = [];
  private publishErrors = 0;
  private lastPublishedAt?: string;

  constructor() {
    if (redis.listenerCount('error') === 0) {
      redis.on('error', () => {
        // Best-effort publisher must never crash the process on transient stream errors.
      });
    }
  }

  async publish(events: RealtimeEventEnvelopeV1[]): Promise<void> {
    const normalized = events.filter(Boolean);
    if (!normalized.length) {
      return;
    }

    const pipeline = redis.pipeline();
    for (const event of normalized) {
      pipeline.xadd(
        REALTIME_EVENT_STREAM_KEY,
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
      chatRuntimeMetrics.increment('realtime.eventBus.publish.success');
      chatRuntimeMetrics.observeValue('realtime.eventBus.publish.count', normalized.length);
    } catch (error) {
      this.publishErrors += 1;
      chatRuntimeMetrics.increment('realtime.eventBus.publish.errors');
      throw error;
    }
  }

  async buildSummary(recentLimit = REALTIME_EVENT_RECENT_LIMIT): Promise<RealtimeEventBusSummary> {
    let streamLength = 0;
    try {
      streamLength = await redis.xlen(REALTIME_EVENT_STREAM_KEY);
    } catch {
      streamLength = 0;
    }

    const consumerGroups = await readConsumerGroups(REALTIME_EVENT_STREAM_KEY);

    return {
      transport: 'redis_stream',
      streamKey: REALTIME_EVENT_STREAM_KEY,
      specVersion: REALTIME_EVENT_SPEC_VERSION,
      streamLength,
      countsByTopic: { ...this.countsByTopic },
      recentEvents: this.recentEvents.slice(0, recentLimit),
      consumerGroups,
      lastPublishedAt: this.lastPublishedAt,
      publishErrors: this.publishErrors,
    };
  }

  resetForTests(): void {
    this.recentEvents.splice(0, this.recentEvents.length);
    for (const key of Object.keys(this.countsByTopic) as RealtimeEventTopic[]) {
      delete this.countsByTopic[key];
    }
    this.publishErrors = 0;
    this.lastPublishedAt = undefined;
  }

  private recordPublishedEvent(event: RealtimeEventEnvelopeV1): void {
    this.countsByTopic[event.topic] = (this.countsByTopic[event.topic] || 0) + 1;
    this.lastPublishedAt = event.emittedAt;
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > REALTIME_EVENT_RECENT_LIMIT) {
      this.recentEvents.length = REALTIME_EVENT_RECENT_LIMIT;
    }
  }
}

export const realtimeEventPublisher = new RedisStreamRealtimeEventPublisher();
