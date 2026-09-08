import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';

export type InferenceAssumptionAuditInputV1 = {
  sequentialPrefixMappingVerified: boolean;
  clusterDependenceHandled: boolean;
  timeShockHandled: boolean;
  positivePropensityFloorVerified: boolean;
  rewardBoundVerified: boolean;
  importanceWeightBoundVerified: boolean;
  stoppingRuleVerified: boolean;
  fixedPreOutcomePoliciesVerified: boolean;
};

const ASSUMPTION_REASONS = [
  ['sequentialPrefixMappingVerified', 'sequential_prefix_mapping_unverified'],
  ['clusterDependenceHandled', 'cluster_dependence_unhandled'],
  ['timeShockHandled', 'time_shock_unhandled'],
  ['positivePropensityFloorVerified', 'positive_propensity_floor_unverified'],
  ['rewardBoundVerified', 'reward_bound_unverified'],
  ['importanceWeightBoundVerified', 'importance_weight_bound_unverified'],
  ['stoppingRuleVerified', 'stopping_rule_unverified'],
  ['fixedPreOutcomePoliciesVerified', 'fixed_pre_outcome_policies_unverified'],
] as const;

export function auditExactSignRandomizationResolutionV1(input: unknown) {
  try {
    const clusterCount = asRecord(input)?.clusterCount;
    if (!Number.isSafeInteger(clusterCount) || (clusterCount as number) < 1
      || (clusterCount as number) > 52) return invalidExactSignAudit();
    const transformationCount = 2 ** (clusterCount as number);
    return freezeWithDigest({
      contractVersion: 'exact_sign_randomization_resolution_audit_v1' as const,
      status: 'evaluated' as const,
      procedure: 'exact_sign_randomization_resolution_audit_v1' as const,
      transformationGroup: 'all_cluster_sign_vectors_v1' as const,
      identityIncluded: true as const,
      tail: 'one_sided_inclusive_v1' as const,
      randomizedBoundary: false as const,
      midP: false as const,
      clusterCount: clusterCount as number,
      transformationCount,
      minimumNonrandomizedPValue: 1 / transformationCount,
      symmetryAssumptionVerified: false as const,
      candidateEvidenceEligible: false as const,
    });
  } catch {
    return invalidExactSignAudit();
  }
}

export function auditSelfNormalizedImportanceWeightingAssumptionsV1(input: unknown) {
  return assumptionAudit(
    'self_normalized_importance_weighting_assumption_audit_v1', input,
  );
}

export function auditTimeUniformConfidenceSequenceAssumptionsV1(input: unknown) {
  return assumptionAudit(
    'time_uniform_confidence_sequence_assumption_audit_v1', input,
  );
}

export function describeClusterMultiplierBootstrapDiagnosticV1() {
  return freezeWithDigest({
    contractVersion: 'cluster_multiplier_bootstrap_diagnostic_audit_v1' as const,
    method: 'cluster_score_multiplier_bootstrap_t_v1' as const,
    auditRole: 'diagnostic_only_v1' as const,
    candidateEvidenceEligible: false as const,
  });
}

function assumptionAudit(
  contractVersion:
    | 'self_normalized_importance_weighting_assumption_audit_v1'
    | 'time_uniform_confidence_sequence_assumption_audit_v1',
  input: unknown,
) {
  const record = asRecord(input);
  const assumptions = Object.fromEntries(ASSUMPTION_REASONS.map(([key]) => [
    key, safeBoolean(record, key),
  ])) as InferenceAssumptionAuditInputV1;
  const reasons = ASSUMPTION_REASONS
    .filter(([key]) => !assumptions[key])
    .map(([, reason]) => reason);
  return freezeWithDigest({
    contractVersion,
    status: reasons.length === 0 ? 'applicable' as const : 'not_applicable' as const,
    auditRole: 'assumption_audit_only_v1' as const,
    assumptions,
    reasons,
    candidateEvidenceEligible: false as const,
  });
}

function safeBoolean(record: Record<string, unknown> | null, key: string): boolean {
  try {
    return record?.[key] === true;
  } catch {
    return false;
  }
}

function invalidExactSignAudit() {
  return freezeWithDigest({
    contractVersion: 'exact_sign_randomization_resolution_audit_v1' as const,
    status: 'not_evaluable' as const,
    blocker: 'exact_sign_resolution_audit_contract_invalid' as const,
    candidateEvidenceEligible: false as const,
  });
}

function freezeWithDigest<T extends object>(preimage: T): Readonly<T & { auditSha256: string }> {
  return recursivelyFreeze({ ...preimage, auditSha256: digest(preimage) });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
