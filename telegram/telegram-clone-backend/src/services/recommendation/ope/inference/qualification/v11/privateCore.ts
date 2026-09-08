import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../decisionLog/contracts';

export function phase21CanonicalJson(value: unknown): string {
  return canonicalDecisionJson(value);
}

export function phase21CanonicalBytes(value: unknown): number {
  return Buffer.byteLength(phase21CanonicalJson(value));
}

export function phase21Digest(value: unknown): string {
  return createHash('sha256').update(phase21CanonicalJson(value)).digest('hex');
}

export function phase21Freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    phase21Freeze(Reflect.get(value, key), seen);
  }
  return Object.freeze(value);
}

export function phase21IsFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => phase21IsFrozen(Reflect.get(value, key), seen));
}

export function phase21SafeGet(value: unknown, key: PropertyKey): unknown {
  try {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
      ? Reflect.get(value, key)
      : undefined;
  } catch {
    return undefined;
  }
}

export function phase21CompareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function phase21IsSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function phase21IsNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function phase21IsObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}
