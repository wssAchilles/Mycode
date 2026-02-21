type LegacyEndpointName = 'conversation' | 'group';

type EndpointBucket = {
  totalCalls: number;
  lastCalledAt: number;
  byUser: Map<string, number>;
};

type LegacyCallMeta = {
  userId?: string | null;
};

const MAX_TRACKED_USERS_PER_ENDPOINT = 500;
const buckets = new Map<LegacyEndpointName, EndpointBucket>();

function getOrCreateBucket(endpoint: LegacyEndpointName): EndpointBucket {
  const existing = buckets.get(endpoint);
  if (existing) return existing;
  const next: EndpointBucket = {
    totalCalls: 0,
    lastCalledAt: 0,
    byUser: new Map<string, number>(),
  };
  buckets.set(endpoint, next);
  return next;
}

export function recordLegacyEndpointCall(endpoint: LegacyEndpointName, meta: LegacyCallMeta = {}) {
  const bucket = getOrCreateBucket(endpoint);
  bucket.totalCalls += 1;
  bucket.lastCalledAt = Date.now();

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
  const result: Record<
    LegacyEndpointName,
    {
      totalCalls: number;
      lastCalledAt: number | null;
      topUsers: Array<{ userId: string; count: number }>;
    }
  > = {
    conversation: { totalCalls: 0, lastCalledAt: null, topUsers: [] },
    group: { totalCalls: 0, lastCalledAt: null, topUsers: [] },
  };

  for (const endpoint of ['conversation', 'group'] as const) {
    const bucket = buckets.get(endpoint);
    if (!bucket) continue;
    const topUsers = Array.from(bucket.byUser.entries())
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    result[endpoint] = {
      totalCalls: bucket.totalCalls,
      lastCalledAt: bucket.lastCalledAt || null,
      topUsers,
    };
  }

  return result;
}
