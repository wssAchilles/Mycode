import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  isVerifiedFrozenInferenceDiagnosticDomainV1,
  type FrozenInferenceDiagnosticDomainV1,
} from '../diagnosticDomain';

export const HONEST_INFERENCE_DIAGNOSTIC_RESULT_V1 =
  'honest_inference_diagnostic_result_v1' as const;

export type HonestInferenceDiagnosticResultV1 = {
  contractVersion: typeof HONEST_INFERENCE_DIAGNOSTIC_RESULT_V1;
  diagnosticStatus: 'attributed' | 'not_evaluable';
  applicabilityStatus: 'not_assessed_no_candidate_selected';
  methodSelectionStatus: 'not_performed_no_candidate_selected';
  candidateQualificationStatus: 'not_run_no_candidate_selected';
  researchCandidateMethod: null;
  selectedMethod: 'diagnostics_only_abstention_v1';
  realDatasetEligible: false;
  diagnosticDomainSha256: string | null;
  blockers: readonly string[];
  resultSha256: string;
};

const verifiedResult = Symbol('verifiedHonestInferenceDiagnosticResultV1');
const verifiedResults = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
type BrandedResult = HonestInferenceDiagnosticResultV1 & { readonly [verifiedResult]: true };

export function buildHonestInferenceDiagnosticResultV1(domain: unknown): BrandedResult {
  const valid = isVerifiedFrozenInferenceDiagnosticDomainV1(domain);
  const preimage = resultPreimage(valid ? domain : null);
  const candidate = { ...preimage, resultSha256: digest(preimage) } as unknown as BrandedResult;
  Object.defineProperty(candidate, verifiedResult, {
    value: true, enumerable: false, configurable: false, writable: false,
  });
  verifiedResults.add(candidate);
  recursivelyFreeze(candidate);
  verifiedDigests.set(candidate, candidate.resultSha256);
  return candidate;
}

export function isVerifiedHonestInferenceDiagnosticResultV1(
  value: unknown,
): value is BrandedResult {
  try {
    if (!value || typeof value !== 'object' || !verifiedResults.has(value)) return false;
    const candidate = value as BrandedResult;
    const { resultSha256, ...preimage } = candidate;
    return candidate[verifiedResult] === true
      && recursivelyFrozen(candidate)
      && resultSha256 === digest(preimage)
      && verifiedDigests.get(candidate) === resultSha256;
  } catch {
    return false;
  }
}

function resultPreimage(domain: FrozenInferenceDiagnosticDomainV1 | null) {
  return {
    contractVersion: HONEST_INFERENCE_DIAGNOSTIC_RESULT_V1,
    diagnosticStatus: domain ? 'attributed' as const : 'not_evaluable' as const,
    applicabilityStatus: 'not_assessed_no_candidate_selected' as const,
    methodSelectionStatus: 'not_performed_no_candidate_selected' as const,
    candidateQualificationStatus: 'not_run_no_candidate_selected' as const,
    researchCandidateMethod: null,
    selectedMethod: 'diagnostics_only_abstention_v1' as const,
    realDatasetEligible: false as const,
    diagnosticDomainSha256: domain?.diagnosticDomainSha256 ?? null,
    blockers: [
      'finite_sample_inference_unavailable',
      'multiplicity_control_unavailable',
      'synthetic_candidate_method_unavailable',
      ...(domain ? [] : ['failure_attribution_source_unverified']),
    ],
  };
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}

const digest = (value: unknown) => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
