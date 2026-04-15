import { chatRuntimeMetrics } from '../chatRuntimeMetrics';
import { redis } from '../../config/redis';
import {
  CHAT_DELIVERY_EVENT_RECENT_LIMIT,
  CHAT_DELIVERY_EVENT_STREAM_KEY,
  CHAT_DELIVERY_EVENT_STREAM_MAX_LEN,
  type ChatDeliveryEventBusConsumerGroupSummary,
  type ChatDeliveryEventBusSummary,
  type ChatDeliveryEventEnvelope,
  type ChatDeliveryEventTopic,
} from './busContracts';
import type { DeliveryEventPublisher } from './ports';

type RawRedisGroupInfo = Array<Array<string | number | null>>;

function parseRedisGroupEntry(
  entry: Array<string | number | null>,
): ChatDeliveryEventBusConsumerGroupSummary | null {
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

async function readConsumerGroups(streamKey: string): Promise<ChatDeliveryEventBusConsumerGroupSummary[]> {
  try {
    const raw = (await redis.call('XINFO', 'GROUPS', streamKey)) as RawRedisGroupInfo;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((entry) => parseRedisGroupEntry(entry))
      .filter((entry): entry is ChatDeliveryEventBusConsumerGroupSummary => Boolean(entry));
  } catch {
    return [];
  }
}

function buildXAddFields(event: ChatDeliveryEventEnvelope): string[] {
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
    'producer',
    event.producer,
    'event',
    JSON.stringify(event),
  ];
}

export class RedisStreamChatDeliveryEventPublisher implements DeliveryEventPublisher {
  private readonly countsByTopic: Partial<Record<ChatDeliveryEventTopic, number>> = {};
  private readonly recentEvents: ChatDeliveryEventEnvelope[] = [];
  private publishErrors = 0;
  private lastPublishedAt?: string;

  constructor() {
    if (redis.listenerCount('error') === 0) {
      redis.on('error', () => {
        // Best-effort publisher must never crash the process on transient stream errors.
      });
    }
  }

  async publish(events: ChatDeliveryEventEnvelope[]): Promise<void> {
    const normalized = events.filter(Boolean);
    if (!normalized.length) {
      return;
    }

    const pipeline = redis.pipeline();
    for (const event of normalized) {
      pipeline.xadd(
        CHAT_DELIVERY_EVENT_STREAM_KEY,
        'MAXLEN',
        '~',
        String(CHAT_DELIVERY_EVENT_STREAM_MAX_LEN),
        '*',
        ...buildXAddFields(event),
      );
    }

    try {
      await pipeline.exec();
      for (const event of normalized) {
        this.recordPublishedEvent(event);
      }
      chatRuntimeMetrics.increment('chatDelivery.eventBus.publish.success');
      chatRuntimeMetrics.observeValue('chatDelivery.eventBus.publish.count', normalized.length);
    } catch (error) {
      this.publishErrors += 1;
      chatRuntimeMetrics.increment('chatDelivery.eventBus.publish.errors');
      throw error;
    }
  }

  async buildSummary(recentLimit = CHAT_DELIVERY_EVENT_RECENT_LIMIT): Promise<ChatDeliveryEventBusSummary> {
    let streamLength = 0;
    try {
      streamLength = await redis.xlen(CHAT_DELIVERY_EVENT_STREAM_KEY);
    } catch {
      streamLength = 0;
    }

    const consumerGroups = await readConsumerGroups(CHAT_DELIVERY_EVENT_STREAM_KEY);

    return {
      transport: 'redis_stream',
      streamKey: CHAT_DELIVERY_EVENT_STREAM_KEY,
      specVersion: 'chat.delivery.v1',
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
    for (const key of Object.keys(this.countsByTopic) as ChatDeliveryEventTopic[]) {
      delete this.countsByTopic[key];
    }
    this.publishErrors = 0;
    this.lastPublishedAt = undefined;
  }

  private recordPublishedEvent(event: ChatDeliveryEventEnvelope): void {
    this.countsByTopic[event.topic] = (this.countsByTopic[event.topic] || 0) + 1;
    this.lastPublishedAt = event.emittedAt;
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > CHAT_DELIVERY_EVENT_RECENT_LIMIT) {
      this.recentEvents.length = CHAT_DELIVERY_EVENT_RECENT_LIMIT;
    }
  }
}

export const chatDeliveryEventPublisher = new RedisStreamChatDeliveryEventPublisher();
