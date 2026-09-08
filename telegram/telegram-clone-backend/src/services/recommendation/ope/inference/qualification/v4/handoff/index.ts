import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  type HonestInferenceDiagnosticResultV1,
  isVerifiedHonestInferenceDiagnosticResultV1,
} from '../../v3/honestResult';
import {
  isVerifiedPhase14DataAdequacyAssessmentV1,
  type VerifiedPhase14DataAdequacyAssessmentV1,
} from '../adequacy';
import {
  PHASE14_HANDOFF_BLOCKERS_V1,
  PHASE14_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
  type Phase14HandoffBuildResultV1,
  type Phase14SameProcessOfflineDiagnosticHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase14SameProcessOfflineDiagnosticHandoffV1');
const verifiedHandoffs = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

type BrandedHandoff = Phase14SameProcessOfflineDiagnosticHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

export function buildPhase14SameProcessHandoffV1(input: unknown): Phase14HandoffBuildResultV1 {
  const fields = handoffInput(input);
  if (!fields
    || !isVerifiedPhase14DataAdequacyAssessmentV1(fields.assessment)
    || !isVerifiedHonestInferenceDiagnosticResultV1(fields.honestResult)
    || fields.honestResult.diagnosticStatus !== 'attributed') {
    return { status: 'not_evaluable', blocker: 'phase14_handoff_source_unverified' };
  }
  if (fields.assessment.sourceBindings.honestResultSha256 !== fields.honestResult.resultSha256
    || fields.assessment.sourceBindings.diagnosticDomainSha256
      !== fields.honestResult.diagnosticDomainSha256) {
    return { status: 'not_evaluable', blocker: 'phase14_handoff_binding_mismatch' };
  }
  const preimage = handoffPreimage(fields.assessment, fields.honestResult);
  const candidate = {
    ...preimage,
    handoffSha256: digest(preimage),
  } as unknown as BrandedHandoff;
  Object.defineProperty(candidate, verifiedHandoff, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  verifiedHandoffs.add(candidate);
  recursivelyFreeze(candidate);
  verifiedDigests.set(candidate, candidate.handoffSha256);
  return { status: 'verified', handoff: candidate };
}

export function isVerifiedPhase14SameProcessHandoffV1(value: unknown): value is BrandedHandoff {
  try {
    if (!value || typeof value !== 'object' || !verifiedHandoffs.has(value)) return false;
    const candidate = value as BrandedHandoff;
    const { handoffSha256, ...preimage } = candidate;
    return candidate[verifiedHandoff] === true
      && recursivelyFrozen(candidate)
      && handoffSha256 === digest(preimage)
      && verifiedDigests.get(candidate) === handoffSha256;
  } catch {
    return false;
  }
}

function handoffInput(value: unknown): { assessment: unknown; honestResult: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return {
      assessment: Reflect.get(value, 'assessment'),
      honestResult: Reflect.get(value, 'honestResult'),
    };
  } catch {
    return null;
  }
}

function handoffPreimage(
  assessment: VerifiedPhase14DataAdequacyAssessmentV1,
  honestResult: HonestInferenceDiagnosticResultV1,
) {
  return {
    contractVersion: PHASE14_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
    handoffScope: 'same_process_offline_diagnostic_v1' as const,
    developmentStatus: 'completed_no_candidate_selected' as const,
    researchCandidateMethod: null,
    candidateSelectionStatus: 'no_candidate_selected' as const,
    candidateQualificationStatus: 'not_run' as const,
    candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
    qualificationEvidenceEligible: false as const,
    selectedMethod: 'diagnostics_only_abstention_v1' as const,
    realDatasetEligible: false as const,
    sealedQualificationStatus: 'not_ready' as const,
    nextPhaseHandoff: 'no_candidate_selected' as const,
    phase13ResultSha256: honestResult.resultSha256,
    phase14AssessmentSha256: assessment.assessmentSha256,
    blockers: PHASE14_HANDOFF_BLOCKERS_V1,
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
