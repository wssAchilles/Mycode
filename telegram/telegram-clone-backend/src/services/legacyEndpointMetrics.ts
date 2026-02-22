type LegacyEndpointName = 'conversation' | 'group';

type EndpointBucket = {
  totalCalls: number;
  lastCalledAt: number;
  byUser: Map<string, number>;
  recentCallsMs: number[];
};

type LegacyCallMeta = {
  userId?: string | null;
};

const MAX_TRACKED_USERS_PER_ENDPOINT = 500;
const RECENT_CALLS_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_CALLS_MAX_SAMPLES = 20_000;
const buckets = new Map<LegacyEndpointName, EndpointBucket>();

function getOrCreateBucket(endpoint: LegacyEndpointName): EndpointBucket {
  const existing = buckets.get(endpoint);
  if (existing) return existing;
  const next: EndpointBucket = {
    totalCalls: 0,
    lastCalledAt: 0,
    byUser: new Map<string, number>(),
    recentCallsMs: [],
  };
  buckets.set(endpoint, next);
  return next;
}

function pruneRecentCalls(bucket: EndpointBucket, now: number) {
  const minTs = now - RECENT_CALLS_WINDOW_MS;
  let dropCount = 0;
  while (dropCount < bucket.recentCallsMs.length) {
    if (bucket.recentCallsMs[dropCount] >= minTs) break;
    dropCount += 1;
  }
  if (dropCount > 0) {
    bucket.recentCallsMs.splice(0, dropCount);
  }
  if (bucket.recentCallsMs.length > RECENT_CALLS_MAX_SAMPLES) {
    bucket.recentCallsMs.splice(0, bucket.recentCallsMs.length - RECENT_CALLS_MAX_SAMPLES);
  }
}

export function recordLegacyEndpointCall(endpoint: LegacyEndpointName, meta: LegacyCallMeta = {}) {
  const bucket = getOrCreateBucket(endpoint);
  const now = Date.now();
  bucket.totalCalls += 1;
  bucket.lastCalledAt = now;
  bucket.recentCallsMs.push(now);
  pruneRecentCalls(bucket, now);

  const userId = meta.userId ? String(meta.userId) : '';
  if (!userId) return;

  const nextCount = (bucket.byUser.get(userId) || 0) + 1;
  bucket.byUser.set(userId, nextCount);

  if (bucket.byUser.size <= MAX_TRACKED_USERS_PER_ENDPOINT) return;

  // Drop the coldest user key to keep bounded memory.
  let coldestUserId = '';
  let coldestCount = Number.POSITIVE_INFINITY;
  for (const [id, count] of bucket.byUser.entries()) {
    if (count < coldestCount) {
      coldestUserId = id;
      coldestCount = count;
    }
  }
  if (coldestUserId) {
    bucket.byUser.delete(coldestUserId);
  }
}

export function getLegacyEndpointUsageSnapshot() {
  const now = Date.now();
  const result: Record<
    LegacyEndpointName,
    {
      totalCalls: number;
      lastCalledAt: number | null;
      quietForMs: number | null;
      callsLastHour: number;
      callsLast24h: number;
      topUsers: Array<{ userId: string; count: number }>;
    }
  > = {
    conversation: { totalCalls: 0, lastCalledAt: null, quietForMs: null, callsLastHour: 0, callsLast24h: 0, topUsers: [] },
    group: { totalCalls: 0, lastCalledAt: null, quietForMs: null, callsLastHour: 0, callsLast24h: 0, topUsers: [] },
  };

  for (const endpoint of ['conversation', 'group'] as const) {
    const bucket = buckets.get(endpoint);
    if (!bucket) continue;
    pruneRecentCalls(bucket, now);
    const topUsers = Array.from(bucket.byUser.entries())
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    const callsLast24h = bucket.recentCallsMs.length;
    const hourThreshold = now - 60 * 60 * 1000;
    let callsLastHour = 0;
    for (const ts of bucket.recentCallsMs) {
      if (ts >= hourThreshold) callsLastHour += 1;
    }
    const quietForMs = bucket.lastCalledAt ? Math.max(0, now - bucket.lastCalledAt) : null;

    result[endpoint] = {
      totalCalls: bucket.totalCalls,
      lastCalledAt: bucket.lastCalledAt || null,
      quietForMs,
      callsLastHour,
      callsLast24h,
      topUsers,
    };
  }

  return result;
}
