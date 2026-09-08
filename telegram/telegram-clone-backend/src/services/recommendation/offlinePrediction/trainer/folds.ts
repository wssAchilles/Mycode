import { createHash } from 'crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const FOLD_ASSIGNMENT_VERSION = 'decision_sha256_mod_k_v1' as const;

export function canonicalDecisionId(decisionId: string): string {
  if (!UUID.test(decisionId)) throw new Error('invalid_decision_id');
  return decisionId.toLowerCase();
}

export function assignDecisionFoldV1(decisionId: string, foldCount: number): number {
  if (!Number.isInteger(foldCount) || foldCount < 2 || foldCount > 32) {
    throw new Error('invalid_fold_count');
  }
  const canonical = canonicalDecisionId(decisionId);
  const digest = createHash('sha256')
    .update(`${FOLD_ASSIGNMENT_VERSION}:${canonical}`)
    .digest('hex');
  return Number(BigInt(`0x${digest.slice(0, 16)}`) % BigInt(foldCount));
}
