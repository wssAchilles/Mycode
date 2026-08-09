import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  isVerifiedPhase14SameProcessHandoffV1,
  type Phase14SameProcessOfflineDiagnosticHandoffV1,
} from '../../v4/handoff';
import {
  isVerifiedPhase15SyntheticClusterStatisticMappingAuditV1,
  type VerifiedPhase15SyntheticClusterStatisticMappingAuditV1,
} from '../clusterMapping';
import {
  PHASE15_HANDOFF_BLOCKERS_V1,
  PHASE15_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
  type Phase15HandoffBuildResultV1,
  type Phase15SameProcessOfflineDiagnosticHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase15SameProcessOfflineDiagnosticHandoffV1');
const verifiedHandoffs = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

type BrandedHandoff = Phase15SameProcessOfflineDiagnosticHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

export function buildPhase15SameProcessNoCandidateHandoffV1(
  input: unknown,
): Phase15HandoffBuildResultV1 {
  const fields = handoffInput(input);
  if (!fields
    || !isVerifiedPhase14SameProcessHandoffV1(fields.phase14Handoff)
    || !isVerifiedPhase15SyntheticClusterStatisticMappingAuditV1(fields.mappingAudit)) {
    return { status: 'not_evaluable', blocker: 'phase15_handoff_source_unverified' };
  }
  const phase14Handoff = fields.phase14Handoff;
  const mappingAudit = fields.mappingAudit;
  if (phase14Handoff.candidateSelectionStatus !== 'no_candidate_selected'
    || phase14Handoff.selectedMethod !== 'diagnostics_only_abstention_v1'
    || mappingAudit.candidateEvidenceEligible
    || mappingAudit.qualificationEvidenceEligible
    || mappingAudit.realDatasetEligible) {
    return { status: 'not_evaluable', blocker: 'phase15_handoff_binding_mismatch' };
  }
  const preimage = {
    contractVersion: PHASE15_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
    handoffScope: 'same_process_offline_diagnostic_v1' as const,
    crossPhaseBindingStatus: 'not_assessed_no_common_binding' as const,
    developmentStatus: 'completed_mapping_audit_no_candidate_selected' as const,
    clusterStatisticMappingStatus: 'synthetic_mapping_verified' as const,
    viewerClusterStatisticReadiness: 'not_ready' as const,
    researchCandidateMethod: null,
    candidateSelectionStatus: 'no_candidate_selected' as const,
    candidateQualificationStatus: 'not_run' as const,
    candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
    selectedMethod: 'diagnostics_only_abstention_v1' as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    sealedQualificationStatus: 'not_ready' as const,
    nextPhaseHandoff: 'no_candidate_selected' as const,
    phase14HandoffSha256: phase14Handoff.handoffSha256,
    phase15MappingSha256: mappingAudit.mappingSha256,
    blockers: PHASE15_HANDOFF_BLOCKERS_V1,
  };
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

export function isVerifiedPhase15SameProcessNoCandidateHandoffV1(
  value: unknown,
): value is BrandedHandoff {
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

function handoffInput(value: unknown): {
  phase14Handoff: unknown;
  mappingAudit: unknown;
} | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return {
      phase14Handoff: Reflect.get(value, 'phase14Handoff'),
      mappingAudit: Reflect.get(value, 'mappingAudit'),
    };
  } catch {
    return null;
  }
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

const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value)).digest('hex');
