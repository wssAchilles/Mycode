import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';

/** The surface owns one canonical encoding so replay and verification hash the same bytes. */
export const scoreSurfaceCanonicalJson = (value: unknown): string => canonicalDecisionJson(value);

export const scoreSurfaceCanonicalBytes = (value: unknown): number => (
  Buffer.byteLength(scoreSurfaceCanonicalJson(value))
);

export const scoreSurfaceDigest = (value: unknown): string => createHash('sha256')
  .update(scoreSurfaceCanonicalJson(value))
  .digest('hex');

export const compareScoreSurfaceText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left),
  Buffer.from(right),
);

export function freezeScoreSurface<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeScoreSurface(Reflect.get(value, key), seen);
  }
  return Object.freeze(value);
}

export function isScoreSurfaceFrozen(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  try {
    return Object.isFrozen(value)
      && Reflect.ownKeys(value).every((key) => (
        isScoreSurfaceFrozen(Reflect.get(value, key), seen)
      ));
  } catch {
    return false;
  }
}

export function safeGet(value: unknown, key: PropertyKey): unknown {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return !!value && (typeof value === 'object' || typeof value === 'function');
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function arrayWithinLimit(value: unknown, limit: number): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  try {
    const length = Reflect.get(value, 'length');
    return Number.isSafeInteger(length) && length >= 0 && length <= limit;
  } catch {
    return false;
  }
}

export function copyArray(value: unknown, limit: number): readonly unknown[] | undefined {
  if (!arrayWithinLimit(value, limit)) return undefined;
  const result: unknown[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) result.push(Reflect.get(value, index));
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

export function omitKeys(value: Record<PropertyKey, unknown>, keys: readonly PropertyKey[]): Record<string, unknown> {
  const excluded = new Set(keys);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (excluded.has(key) || typeof key !== 'string') continue;
    result[key] = safeGet(value, key);
  }
  return result;
}
