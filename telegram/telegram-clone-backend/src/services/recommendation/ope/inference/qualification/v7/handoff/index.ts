import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  isVerifiedPhase16SameProcessNoCandidateHandoffV1,
} from '../../v6/handoff';
import {
  isVerifiedPhase17SyntheticViewerClusterMappingAuditV1,
} from '../clusterMapping';
import {
  PHASE17_HANDOFF_BLOCKERS_V1,
  PHASE17_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
  type Phase17HandoffBuildResultV1,
  type Phase17SameProcessOfflineDiagnosticHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase17SameProcessOfflineDiagnosticHandoffV1');
const verifiedHandoffs = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

type BrandedHandoff = Phase17SameProcessOfflineDiagnosticHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

export function buildPhase17SameProcessNoCandidateHandoffV1(
  input: unknown,
): Phase17HandoffBuildResultV1 {
  const fields = handoffInput(input);
  if (!fields
    || !isVerifiedPhase16SameProcessNoCandidateHandoffV1(fields.phase16Handoff)
    || !isVerifiedPhase17SyntheticViewerClusterMappingAuditV1(fields.mappingAudit)) {
    return { status: 'not_evaluable', blocker: 'phase17_handoff_source_unverified' };
  }
  const { phase16Handoff, mappingAudit } = fields;
  if (phase16Handoff.candidateSelectionStatus !== 'no_candidate_selected'
    || phase16Handoff.selectedMethod !== 'diagnostics_only_abstention_v1'
    || phase16Handoff.predictionSetVersion
      !== mappingAudit.predictionBinding.predictionSetVersion
    || phase16Handoff.predictionVerificationReceiptSha256
      !== mappingAudit.predictionBinding.predictionVerificationReceiptSha256
    || !mappingAudit.viewerClusterCrossFitProvenancePresent
    || mappingAudit.independentViewerClustersVerified
    || mappingAudit.commonTimeShockHandlingVerified
    || mappingAudit.multiwayClusterProvenancePresent
    || mappingAudit.candidateEvidenceEligible
    || mappingAudit.qualificationEvidenceEligible
    || mappingAudit.realDatasetEligible
    || mappingAudit.servable) {
    return { status: 'not_evaluable', blocker: 'phase17_handoff_binding_mismatch' };
  }
  const preimage = {
    contractVersion: PHASE17_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
    handoffScope: 'same_process_offline_diagnostic_v1' as const,
    developmentStatus: 'completed_viewer_cluster_mapping_no_candidate_selected' as const,
    clusterStatisticMappingStatus: 'synthetic_viewer_cluster_mapping_verified' as const,
    viewerClusterStatisticReadiness: 'synthetic_only' as const,
    viewerClusterCrossFitProvenancePresent: true as const,
    independentViewerClustersVerified: false as const,
    commonTimeShockHandlingVerified: false as const,
    multiwayClusterProvenancePresent: false as const,
    researchCandidateMethod: null,
    candidateSelectionStatus: 'no_candidate_selected' as const,
    candidateQualificationStatus: 'not_run' as const,
    candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
    selectedMethod: 'diagnostics_only_abstention_v1' as const,
    qualificationEvidenceEligible: false as const,
    realDatasetEligible: false as const,
    servable: false as const,
    sealedQualificationStatus: 'not_ready' as const,
    nextPhaseHandoff: 'no_candidate_selected' as const,
    phase16HandoffSha256: phase16Handoff.handoffSha256,
    phase17MappingSha256: mappingAudit.mappingSha256,
    predictionSetVersion: mappingAudit.predictionBinding.predictionSetVersion,
    predictionVerificationReceiptSha256:
      mappingAudit.predictionBinding.predictionVerificationReceiptSha256,
    blockers: PHASE17_HANDOFF_BLOCKERS_V1,
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

export function isVerifiedPhase17SameProcessNoCandidateHandoffV1(
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

function handoffInput(value: unknown): Readonly<{
  phase16Handoff: unknown;
  mappingAudit: unknown;
}> | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return {
      phase16Handoff: Reflect.get(value, 'phase16Handoff'),
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
