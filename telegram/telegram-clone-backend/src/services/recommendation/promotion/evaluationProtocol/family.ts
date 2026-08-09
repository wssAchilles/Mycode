import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  frozenEvaluationFamilyV1Schema,
  type FrozenEvaluationFamilyV1,
} from './contracts';

const verifiedFamily = Symbol('verifiedFrozenEvaluationFamilyV1');
const verifiedFamilies = new WeakSet<object>();
const verifiedFamilyDigests = new WeakMap<object, string>();

export type VerifiedFrozenEvaluationFamilyV1 = FrozenEvaluationFamilyV1 & {
  readonly [verifiedFamily]: true;
};

export type VerifyFrozenEvaluationFamilyResultV1 =
  | { status: 'verified'; family: VerifiedFrozenEvaluationFamilyV1 }
  | {
    status: 'not_evaluable';
    blocker:
      | 'frozen_evaluation_family_invalid'
      | 'frozen_evaluation_family_digest_mismatch'
      | 'single_candidate_required'
      | 'family_array_duplicate'
      | 'family_array_not_canonical'
      | 'family_not_frozen_before_holdout';
  };

export function verifyFrozenEvaluationFamilyV1(
  input: unknown,
): VerifyFrozenEvaluationFamilyResultV1 {
  let parsed: ReturnType<typeof frozenEvaluationFamilyV1Schema.safeParse> | undefined;
  try {
    parsed = frozenEvaluationFamilyV1Schema.safeParse(input);
  } catch {
    parsed = undefined;
  }
  if (!parsed?.success) {
    return { status: 'not_evaluable', blocker: 'frozen_evaluation_family_invalid' };
  }
  const family = parsed.data;
  if (family.candidatePolicies.length !== 1) {
    return { status: 'not_evaluable', blocker: 'single_candidate_required' };
  }
  const identitySets = [
    family.candidatePolicies.map(({ policyId, policyVersion }) => canonicalDecisionJson({ policyId, policyVersion })),
    family.objectives.map(({ objective }) => objective),
    family.segments.map(({ segmentKey, segmentValue }) => canonicalDecisionJson({ segmentKey, segmentValue })),
    family.evidenceBindings.map(({ bindingId }) => bindingId),
    family.configBindings.map(({ bindingId }) => bindingId),
  ];
  if (identitySets.some((values) => new Set(values).size !== values.length)) {
    return { status: 'not_evaluable', blocker: 'family_array_duplicate' };
  }
  const arrays = [
    family.candidatePolicies,
    family.objectives,
    family.segments,
    family.evidenceBindings,
    family.configBindings,
  ] as const;
  if (arrays.some((values) => !isCanonicalOrder(values))) {
    return { status: 'not_evaluable', blocker: 'family_array_not_canonical' };
  }
  if (Date.parse(family.frozenAt) >= Date.parse(family.holdoutRevealNotBefore)) {
    return { status: 'not_evaluable', blocker: 'family_not_frozen_before_holdout' };
  }
  const { familySha256: _digest, ...preimage } = family;
  if (digest(preimage) !== family.familySha256) {
    return { status: 'not_evaluable', blocker: 'frozen_evaluation_family_digest_mismatch' };
  }

  const result = family as VerifiedFrozenEvaluationFamilyV1;
  Object.defineProperty(result, verifiedFamily, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  verifiedFamilies.add(result);
  recursivelyFreeze(result);
  verifiedFamilyDigests.set(result, family.familySha256);
  return { status: 'verified', family: result };
}

export function isVerifiedFrozenEvaluationFamilyV1(
  value: unknown,
): value is VerifiedFrozenEvaluationFamilyV1 {
  try {
    if (!value || typeof value !== 'object' || !verifiedFamilies.has(value)) return false;
    const family = value as VerifiedFrozenEvaluationFamilyV1;
    const { familySha256: _digest, ...preimage } = family;
    return family[verifiedFamily] === true
      && recursivelyFrozen(family)
      && family.realDatasetEligible === false
      && family.familySha256 === digest(preimage)
      && verifiedFamilyDigests.get(family) === family.familySha256;
  } catch {
    return false;
  }
}

function isCanonicalOrder(values: readonly unknown[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = Buffer.from(canonicalDecisionJson(values[index - 1]));
    const current = Buffer.from(canonicalDecisionJson(values[index]));
    if (Buffer.compare(previous, current) >= 0) return false;
  }
  return true;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const property of Reflect.ownKeys(value)) {
    recursivelyFreeze(Reflect.get(value, property), seen);
  }
  Object.freeze(value);
  return value;
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((property) => recursivelyFrozen(Reflect.get(value, property), seen));
}
