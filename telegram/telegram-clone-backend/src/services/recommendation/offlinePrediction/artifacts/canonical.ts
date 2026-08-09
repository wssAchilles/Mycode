import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';

export const sha256Text = (value: string): string => createHash('sha256')
  .update(value)
  .digest('hex');

export const canonicalJsonV1 = (value: unknown): string => canonicalDecisionJson(value);

function canonicalWireValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalWireValue);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON requires finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalWireValue((value as Record<string, unknown>)[key]),
    ]));
  }
  return value;
}

export const canonicalWireJsonV1 = (value: unknown): string => JSON.stringify(
  canonicalWireValue(value),
);

export const canonicalNdjsonV1 = (records: readonly unknown[]): string => (
  records.length === 0 ? '' : `${records.map(canonicalWireJsonV1).join('\n')}\n`
);

export function selfSha256V1<T extends Record<string, unknown>>(
  value: T,
  digestField: keyof T,
): string {
  const preimage = { ...value };
  delete preimage[digestField];
  return sha256Text(canonicalJsonV1(preimage));
}
