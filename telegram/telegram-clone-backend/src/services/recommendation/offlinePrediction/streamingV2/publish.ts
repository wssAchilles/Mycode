import type { AtomicCanonicalNdjsonPublishResultV1 } from '../snapshotV2/contracts';

export type Phase11AtomicPublishResultV1 =
  | AtomicCanonicalNdjsonPublishResultV1
  | { status: 'pre_publish_failed'; reason: string };

export function describePhase11AtomicPublishResultV1(result: Phase11AtomicPublishResultV1) {
  if (result.status === 'pre_publish_failed') {
    return {
      ...result,
      finalPathVisibility: 'not_visible' as const,
      retry: 'allowed' as const,
    };
  }
  if (result.status === 'published_durability_unconfirmed') {
    return {
      ...result,
      finalPathVisibility: 'may_be_visible' as const,
      retry: 'forbidden' as const,
    };
  }
  return {
    ...result,
    finalPathVisibility: 'visible' as const,
    retry: 'forbidden' as const,
  };
}
