import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../decisionLog/contracts';

/** Keep the v12 boundary on the same canonical bytes as the decision log. */
export function phase22CanonicalJson(value: unknown): string {
  return canonicalDecisionJson(value);
}

export function phase22CanonicalBytes(value: unknown): number {
  return Buffer.byteLength(phase22CanonicalJson(value));
}

export function phase22Digest(value: unknown): string {
  return createHash('sha256').update(phase22CanonicalJson(value)).digest('hex');
}

export function phase22Freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    phase22Freeze(Reflect.get(value, key), seen);
  }
  return Object.freeze(value);
}

export function phase22IsFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  try {
    return Object.isFrozen(value)
      && Reflect.ownKeys(value).every((key) => (
        phase22IsFrozen(Reflect.get(value, key), seen)
      ));
  } catch {
    return false;
  }
}

/** Reflect.get is deliberately the only property read at the trust boundary. */
export function phase22SafeGet(value: unknown, key: PropertyKey): unknown {
  try {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
      ? Reflect.get(value, key)
      : undefined;
  } catch {
    return undefined;
  }
}

export function phase22CompareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function phase22IsSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function phase22IsNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function phase22IsFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function phase22IsObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

export function phase22IsNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Reject proxies/objects with an unexpected enumerable or symbol shape. */
export function phase22OwnKeys(value: unknown): readonly PropertyKey[] | null {
  if (!phase22IsObjectLike(value)) return null;
  try {
    return Reflect.ownKeys(value);
  } catch {
    return null;
  }
}
