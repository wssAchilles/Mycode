import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../decisionLog/contracts';

export const phase18CanonicalJson = (value: unknown): string => canonicalDecisionJson(value);

export const phase18CanonicalBytes = (value: unknown): number => (
  Buffer.byteLength(phase18CanonicalJson(value))
);

export const phase18Digest = (value: unknown): string => createHash('sha256')
  .update(phase18CanonicalJson(value)).digest('hex');

export const comparePhase18Text = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);

export function freezePhase18<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) freezePhase18(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

export function isPhase18Frozen(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => isPhase18Frozen(Reflect.get(value, key), seen));
}
