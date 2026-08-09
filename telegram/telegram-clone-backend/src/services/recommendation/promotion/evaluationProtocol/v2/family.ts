import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../decisionLog/contracts';
import { directionalTestResolutionV2 } from '../../../ope/inference/directionalV2';
import {
  frozenPolicyEvaluationFamilyV2Schema,
  type FrozenPolicyEvaluationFamilyV2,
} from './contracts';

const familyBrand = Symbol('verifiedFrozenPolicyEvaluationFamilyV2');
const verifiedFamilies = new WeakSet<object>();
const familyDigests = new WeakMap<object, string>();

export type VerifiedFrozenPolicyEvaluationFamilyV2 = FrozenPolicyEvaluationFamilyV2 & {
  readonly [familyBrand]: true;
};

export function verifyFrozenPolicyEvaluationFamilyV2(input: unknown):
  | { status: 'verified'; family: VerifiedFrozenPolicyEvaluationFamilyV2 }
  | { status: 'not_evaluable'; blocker: string } {
  try {
    const parsed = frozenPolicyEvaluationFamilyV2Schema.safeParse(input);
    if (!parsed.success) return blocked('frozen_policy_evaluation_family_invalid');
    const family = parsed.data;
    if (family.hypotheses.some((hypothesis) => (
      (hypothesis.direction === 'greater')
        !== (hypothesis.alternative === 'theta_greater_than_null_v1')
    ))) return blocked('frozen_policy_evaluation_family_invalid');
    if (new Set(family.hypotheses.map((entry) => entry.hypothesisId)).size
      !== family.hypotheses.length
      || new Set(family.configBindings.map((entry) => entry.bindingId)).size
        !== family.configBindings.length) {
      return blocked('frozen_policy_evaluation_family_duplicate');
    }
    if (!canonicalOrder(family.hypotheses) || !canonicalOrder(family.configBindings)) {
      return blocked('frozen_policy_evaluation_family_not_canonical');
    }
    if (Date.parse(family.frozenAt) >= Date.parse(family.holdoutRevealNotBefore)) {
      return blocked('frozen_policy_evaluation_family_revealed');
    }
    const resolution = directionalTestResolutionV2({
      bootstrapReplicates: family.bootstrapReplicates,
      familyAlpha: family.familyAlpha,
      hypothesisCount: family.hypotheses.length,
      procedure: family.procedure,
    });
    if (resolution.status !== 'reachable') return resolution;
    const { familySha256: _sha256, ...preimage } = family;
    if (digest(preimage) !== family.familySha256) {
      return blocked('frozen_policy_evaluation_family_digest_mismatch');
    }
    const verified = family as VerifiedFrozenPolicyEvaluationFamilyV2;
    Object.defineProperty(verified, familyBrand, { value: true, enumerable: false });
    verifiedFamilies.add(verified);
    recursivelyFreeze(verified);
    familyDigests.set(verified, verified.familySha256);
    return { status: 'verified', family: verified };
  } catch {
    return blocked('frozen_policy_evaluation_family_invalid');
  }
}

export function isVerifiedFrozenPolicyEvaluationFamilyV2(
  input: unknown,
): input is VerifiedFrozenPolicyEvaluationFamilyV2 {
  try {
    if (!input || typeof input !== 'object' || !verifiedFamilies.has(input)) return false;
    const family = input as VerifiedFrozenPolicyEvaluationFamilyV2;
    const { familySha256: _sha256, ...preimage } = family;
    return family[familyBrand] === true
      && recursivelyFrozen(family)
      && familyDigests.get(family) === family.familySha256
      && digest(preimage) === family.familySha256;
  } catch {
    return false;
  }
}

function canonicalOrder(values: readonly unknown[]): boolean {
  return values.every((value, index) => index === 0 || Buffer.compare(
    Buffer.from(canonicalDecisionJson(values[index - 1])),
    Buffer.from(canonicalDecisionJson(value)),
  ) < 0);
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => recursivelyFreeze(Reflect.get(value, key), seen));
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}

const blocked = (blocker: string) => ({ status: 'not_evaluable' as const, blocker });
