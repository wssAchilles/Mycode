import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../decisionLog/contracts';

export const phase19CanonicalJson = (value: unknown): string => canonicalDecisionJson(value);

export const phase19CanonicalBytes = (value: unknown): number => (
  Buffer.byteLength(phase19CanonicalJson(value))
);

export const phase19Digest = (value: unknown): string => createHash('sha256')
  .update(phase19CanonicalJson(value)).digest('hex');

export const comparePhase19Text = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);

export function freezePhase19<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) freezePhase19(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

export function isPhase19Frozen(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => isPhase19Frozen(Reflect.get(value, key), seen));
}
