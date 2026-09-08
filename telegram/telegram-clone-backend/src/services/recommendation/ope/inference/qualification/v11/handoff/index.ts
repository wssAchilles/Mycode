import {
  isVerifiedPhase20SameProcessNoCandidateHandoffV1,
  type Phase20SameProcessOfflineDiagnosticHandoffV1,
} from '../../v10/handoff';
import {
  isVerifiedPhase21DataAdequacyAssessmentV1,
  type VerifiedPhase21DataAdequacyAssessmentV1,
} from '../adequacy';
import {
  isVerifiedPhase21ClusterAwareCrossFitAuditV1,
  type VerifiedPhase21ClusterAwareCrossFitAuditV1,
} from '../crossFit';
import {
  phase21Digest,
  phase21Freeze,
  phase21IsFrozen,
  phase21IsObjectLike,
  phase21IsSha256,
  phase21SafeGet,
} from '../privateCore';
import {
  PHASE21_HANDOFF_BLOCKERS_V1,
  PHASE21_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1,
  type Phase21HandoffBlockerV1,
  type Phase21HandoffBuildResultV1,
  type Phase21SameProcessHonestNoCandidateHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase21SameProcessHonestNoCandidateHandoffV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Readonly<{
  phase20Handoff: Phase20SameProcessOfflineDiagnosticHandoffV1;
  assessment: VerifiedPhase21DataAdequacyAssessmentV1;
  crossFit: VerifiedPhase21ClusterAwareCrossFitAuditV1;
}>>();

type BrandedHandoff = Phase21SameProcessHonestNoCandidateHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

export function buildPhase21SameProcessHonestNoCandidateHandoffV1(
  input: unknown,
): Phase21HandoffBuildResultV1 {
  try {
    const fields = readInput(input);
    if (!fields
      || !isVerifiedPhase20SameProcessNoCandidateHandoffV1(fields.phase20Handoff)
      || !isVerifiedPhase21DataAdequacyAssessmentV1(fields.assessment)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(fields.crossFit)) {
      return reject('phase21_handoff_source_unverified');
    }
    const phase20Handoff = fields.phase20Handoff;
    const assessment = fields.assessment;
    const crossFit = fields.crossFit;
    if (!phase20StateMatches(phase20Handoff)
      || !assessmentStateMatches(assessment)
      || !crossFitStateMatches(crossFit)
      || !sourcesBind(phase20Handoff, assessment, crossFit)) {
      return reject('phase21_handoff_binding_mismatch');
    }

    const preimage = {
      contractVersion: PHASE21_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1,
      handoffScope: 'same_process_offline_diagnostic_v1' as const,
      developmentStatus: 'completed_viewer_time_adequacy_cross_fit_no_candidate_selected' as const,
      phase20HandoffStatus: 'verified_no_candidate_selected' as const,
      dataAdequacyStatus: 'not_ready' as const,
      viewerTimeEvidenceStatus: 'not_ready' as const,
      phase21AdequacyStatus: 'verified_not_ready' as const,
      clusterAwareCrossFitStatus: 'verified_not_ready' as const,
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected' as const,
      candidateQualificationStatus: 'not_run' as const,
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
      qualificationEvidenceEligible: false as const,
      candidateEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
      sealedQualificationStatus: 'not_ready' as const,
      nextPhaseHandoff: 'real_cluster_evidence_required' as const,
      phase20HandoffSha256: phase20Handoff.handoffSha256,
      phase21AssessmentSha256: assessment.assessmentSha256,
      phase21EvidenceEnvelopeSha256: assessment.sourceBindings.evidenceEnvelopeSha256,
      phase21CrossFitAuditSha256: crossFit.auditSha256,
      blockers: PHASE21_HANDOFF_BLOCKERS_V1,
    };
    const candidate = {
      ...preimage,
      handoffSha256: phase21Digest(preimage),
    } as unknown as BrandedHandoff;
    Object.defineProperty(candidate, verifiedHandoff, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    phase21Freeze(candidate);
    verifiedObjects.add(candidate);
    verifiedDigests.set(candidate, candidate.handoffSha256);
    verifiedOwners.set(candidate, Object.freeze({ phase20Handoff, assessment, crossFit }));
    return { status: 'verified', handoff: candidate };
  } catch {
    return reject('phase21_handoff_source_unverified');
  }
}

export const buildPhase21SameProcessNoCandidateHandoffV1 =
  buildPhase21SameProcessHonestNoCandidateHandoffV1;
export const buildPhase21SameProcessOfflineDiagnosticHandoffV1 =
  buildPhase21SameProcessHonestNoCandidateHandoffV1;

export function isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1(
  value: unknown,
): value is BrandedHandoff {
  try {
    if (!phase21IsObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedHandoff;
    const owners = verifiedOwners.get(candidate);
    if (!owners
      || !isVerifiedPhase20SameProcessNoCandidateHandoffV1(owners.phase20Handoff)
      || !isVerifiedPhase21DataAdequacyAssessmentV1(owners.assessment)
      || !isVerifiedPhase21ClusterAwareCrossFitAuditV1(owners.crossFit)) return false;
    const handoffSha256 = phase21SafeGet(candidate, 'handoffSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    if (!Reflect.deleteProperty(preimage, 'handoffSha256')) return false;
    return phase21SafeGet(candidate, verifiedHandoff) === true
      && phase21IsFrozen(candidate)
      && phase21IsSha256(handoffSha256)
      && handoffSha256 === phase21Digest(preimage)
      && verifiedDigests.get(candidate) === handoffSha256
      && phase20StateMatches(owners.phase20Handoff)
      && assessmentStateMatches(owners.assessment)
      && crossFitStateMatches(owners.crossFit)
      && sourcesBind(owners.phase20Handoff, owners.assessment, owners.crossFit)
      && fixedHandoffState(candidate)
      && phase21SafeGet(candidate, 'phase20HandoffSha256')
        === owners.phase20Handoff.handoffSha256
      && phase21SafeGet(candidate, 'phase21AssessmentSha256')
        === owners.assessment.assessmentSha256
      && phase21SafeGet(candidate, 'phase21EvidenceEnvelopeSha256')
        === owners.assessment.sourceBindings.evidenceEnvelopeSha256
      && phase21SafeGet(candidate, 'phase21CrossFitAuditSha256')
        === owners.crossFit.auditSha256;
  } catch {
    return false;
  }
}

export const isVerifiedPhase21SameProcessNoCandidateHandoffV1 =
  isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1;
export const isVerifiedPhase21SameProcessOfflineDiagnosticHandoffV1 =
  isVerifiedPhase21SameProcessHonestNoCandidateHandoffV1;

function readInput(value: unknown): {
  phase20Handoff: unknown;
  assessment: unknown;
  crossFit: unknown;
} | null {
  if (!phase21IsObjectLike(value)) return null;
  return {
    phase20Handoff: readFirst(value, 'phase20Handoff', 'handoff'),
    assessment: readFirst(value, 'assessment', 'adequacy'),
    crossFit: readFirst(value, 'crossFit', 'crossFitAudit', 'audit'),
  };
}

function readFirst(value: object, ...keys: PropertyKey[]): unknown {
  for (const key of keys) {
    const read = safeRead(value, key);
    if (read.ok && read.value !== undefined) return read.value;
  }
  return undefined;
}

function safeRead(value: object, key: PropertyKey): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: Reflect.get(value, key) };
  } catch {
    return { ok: false };
  }
}

function phase20StateMatches(value: Phase20SameProcessOfflineDiagnosticHandoffV1): boolean {
  return phase21SafeGet(value, 'candidateSelectionStatus') === 'no_candidate_selected'
    && phase21SafeGet(value, 'candidateQualificationStatus') === 'not_run'
    && phase21SafeGet(value, 'selectedMethod') === 'diagnostics_only_abstention_v1'
    && phase21SafeGet(value, 'realDatasetEligible') === false
    && phase21SafeGet(value, 'servable') === false
    && phase21IsSha256(phase21SafeGet(value, 'handoffSha256'));
}

function assessmentStateMatches(value: VerifiedPhase21DataAdequacyAssessmentV1): boolean {
  return phase21SafeGet(value, 'contractVersion')
      === 'verified_phase21_data_adequacy_assessment_v1'
    && phase21SafeGet(value, 'dataAdequacyStatus') === 'current_evidence_insufficient'
    && phase21SafeGet(value, 'candidateApplicabilityStatus')
      === 'not_assessed_no_candidate_selected'
    && phase21SafeGet(value, 'qualificationEvidenceEligible') === false
    && phase21SafeGet(value, 'realDatasetEligible') === false
    && phase21SafeGet(value, 'servable') === false
    && phase21IsSha256(phase21SafeGet(value, 'assessmentSha256'))
    && stableArray(phase21SafeGet(value, 'blockers'), [
      'real_viewer_cluster_provenance_unavailable',
      'real_time_cluster_provenance_unavailable',
      'real_full_support_evidence_unavailable',
      'real_randomized_propensity_evidence_unavailable',
      'real_reward_or_weight_bounds_unavailable',
      'real_qhat_cross_fit_provenance_unavailable',
      'sequential_stopping_rule_unavailable',
      'multiway_dependence_handling_unavailable',
    ]);
}

function crossFitStateMatches(value: VerifiedPhase21ClusterAwareCrossFitAuditV1): boolean {
  return phase21SafeGet(value, 'contractVersion')
      === 'verified_phase21_cluster_aware_cross_fit_audit_v1'
    && phase21SafeGet(value, 'status') === 'not_ready'
    && phase21SafeGet(value, 'decisionOnlyFoldRejected') === true
    && phase21SafeGet(value, 'realViewerTimeProvenancePresent') === false
    && phase21SafeGet(value, 'qHatCrossFitVerified') === false
    && phase21SafeGet(value, 'candidateEvidenceEligible') === false
    && phase21SafeGet(value, 'qualificationEvidenceEligible') === false
    && phase21SafeGet(value, 'realDatasetEligible') === false
    && phase21SafeGet(value, 'servable') === false
    && phase21IsSha256(phase21SafeGet(value, 'auditSha256'))
    && stableArray(phase21SafeGet(value, 'blockers'), [
      'real_viewer_cluster_provenance_unavailable',
      'real_time_cluster_provenance_unavailable',
      'real_qhat_cross_fit_provenance_unavailable',
      'multiway_dependence_handling_unavailable',
    ]);
}

function sourcesBind(
  phase20: Phase20SameProcessOfflineDiagnosticHandoffV1,
  assessment: VerifiedPhase21DataAdequacyAssessmentV1,
  crossFit: VerifiedPhase21ClusterAwareCrossFitAuditV1,
): boolean {
  const evidence = phase21SafeGet(assessment.sourceBindings, 'evidenceEnvelopeSha256');
  return phase21IsSha256(evidence)
    && phase21SafeGet(assessment.sourceBindings, 'phase20HandoffSha256') === phase20.handoffSha256
    && phase21SafeGet(assessment.sourceBindings, 'crossFitAuditSha256') === crossFit.auditSha256
    && phase21SafeGet(crossFit.sourceBindings, 'evidenceEnvelopeSha256') === evidence;
}

function fixedHandoffState(value: BrandedHandoff): boolean {
  return phase21SafeGet(value, 'contractVersion')
      === PHASE21_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1
    && phase21SafeGet(value, 'handoffScope') === 'same_process_offline_diagnostic_v1'
    && phase21SafeGet(value, 'developmentStatus')
      === 'completed_viewer_time_adequacy_cross_fit_no_candidate_selected'
    && phase21SafeGet(value, 'phase20HandoffStatus') === 'verified_no_candidate_selected'
    && phase21SafeGet(value, 'dataAdequacyStatus') === 'not_ready'
    && phase21SafeGet(value, 'viewerTimeEvidenceStatus') === 'not_ready'
    && phase21SafeGet(value, 'phase21AdequacyStatus') === 'verified_not_ready'
    && phase21SafeGet(value, 'clusterAwareCrossFitStatus') === 'verified_not_ready'
    && phase21SafeGet(value, 'researchCandidateMethod') === null
    && phase21SafeGet(value, 'candidateSelectionStatus') === 'no_candidate_selected'
    && phase21SafeGet(value, 'candidateQualificationStatus') === 'not_run'
    && phase21SafeGet(value, 'candidateApplicabilityStatus')
      === 'not_assessed_no_candidate_selected'
    && phase21SafeGet(value, 'selectedMethod') === 'diagnostics_only_abstention_v1'
    && phase21SafeGet(value, 'qualificationEvidenceEligible') === false
    && phase21SafeGet(value, 'candidateEvidenceEligible') === false
    && phase21SafeGet(value, 'realDatasetEligible') === false
    && phase21SafeGet(value, 'servable') === false
    && phase21SafeGet(value, 'sealedQualificationStatus') === 'not_ready'
    && phase21SafeGet(value, 'nextPhaseHandoff') === 'real_cluster_evidence_required'
    && stableArray(phase21SafeGet(value, 'blockers'), PHASE21_HANDOFF_BLOCKERS_V1);
}

function stableArray(value: unknown, expected: readonly string[]): boolean {
  try {
    return Array.isArray(value)
      && value.length === expected.length
      && expected.every((entry, index) => phase21SafeGet(value, index) === entry);
  } catch {
    return false;
  }
}

function reject(blocker: Phase21HandoffBlockerV1): Phase21HandoffBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
