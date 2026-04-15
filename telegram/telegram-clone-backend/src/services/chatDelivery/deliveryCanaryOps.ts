import { redis } from '../../config/redis';

const DEFAULT_CANARY_STREAM_KEY = 'chat:delivery:canary:v1';

export interface ChatDeliveryCanaryStreamSummary {
  transport: 'redis_stream';
  streamKey: string;
  available: boolean;
  streamLength: number;
  lastEntryId?: string;
  lastResult?: string;
  lastSegment?: string;
  error?: string;
}

function readCanaryStreamKey(): string {
  return String(process.env.DELIVERY_CONSUMER_CANARY_STREAM_KEY || DEFAULT_CANARY_STREAM_KEY).trim()
    || DEFAULT_CANARY_STREAM_KEY;
}

function entryToMap(entry: unknown): Map<string, string> {
  const values = new Map<string, string>();
  if (!Array.isArray(entry) || entry.length < 2 || !Array.isArray(entry[1])) {
    return values;
  }
  const fields = entry[1] as unknown[];
  for (let index = 0; index < fields.length; index += 2) {
    const key = fields[index];
    const value = fields[index + 1];
    if (typeof key === 'string') {
      values.set(key, String(value ?? ''));
    }
  }
  return values;
}

export async function readDeliveryCanaryStreamSummary(): Promise<ChatDeliveryCanaryStreamSummary> {
  const streamKey = readCanaryStreamKey();
  try {
    const [streamLength, latest] = await Promise.all([
      redis.xlen(streamKey),
      redis.xrevrange(streamKey, '+', '-', 'COUNT', 1) as Promise<unknown[]>,
    ]);
    const latestEntry = Array.isArray(latest) ? latest[0] : undefined;
    const latestFields = entryToMap(latestEntry);
    return {
      transport: 'redis_stream',
      streamKey,
      available: true,
      streamLength,
      lastEntryId: Array.isArray(latestEntry) ? String(latestEntry[0] ?? '') || undefined : undefined,
      lastResult: latestFields.get('result'),
      lastSegment: latestFields.get('segment'),
    };
  } catch (error) {
    return {
      transport: 'redis_stream',
      streamKey,
      available: false,
      streamLength: 0,
      error: error instanceof Error ? error.message : String(error || 'canary stream unavailable'),
    };
  }
}
