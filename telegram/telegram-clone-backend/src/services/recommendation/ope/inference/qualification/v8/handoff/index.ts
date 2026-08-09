import {
  isVerifiedPhase17SameProcessNoCandidateHandoffV1,
  type Phase17SameProcessOfflineDiagnosticHandoffV1,
} from '../../v7/handoff';
import {
  isVerifiedPhase18MultiwayHoldoutPlanAuditV1,
  type VerifiedPhase18MultiwayHoldoutPlanAuditV1,
} from '../multiwayHoldout';
import {
  isVerifiedPhase18SyntheticViewerTimeProvenanceV1,
  type VerifiedPhase18SyntheticViewerTimeProvenanceV1,
} from '../timeProvenance';
import {
  freezePhase18,
  isPhase18Frozen,
  phase18Digest,
} from '../privateCore';
import {
  PHASE18_HANDOFF_BLOCKERS_V1,
  PHASE18_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
  type Phase18HandoffBlockerV1,
  type Phase18HandoffBuildResultV1,
  type Phase18SameProcessOfflineDiagnosticHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase18SameProcessOfflineDiagnosticHandoffV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Readonly<{
  phase17Handoff: Phase17SameProcessOfflineDiagnosticHandoffV1;
  provenance: VerifiedPhase18SyntheticViewerTimeProvenanceV1;
  plan: VerifiedPhase18MultiwayHoldoutPlanAuditV1;
}>>();

type BrandedHandoff = Phase18SameProcessOfflineDiagnosticHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

export function buildPhase18SameProcessNoCandidateHandoffV1(
  input: unknown,
): Phase18HandoffBuildResultV1 {
  try {
    if (!input || typeof input !== 'object') {
      return reject('phase18_handoff_source_unverified');
    }
    const phase17Handoff = Reflect.get(input, 'phase17Handoff');
    if (!isVerifiedPhase17SameProcessNoCandidateHandoffV1(phase17Handoff)) {
      return reject('phase18_handoff_source_unverified');
    }
    const provenance = Reflect.get(input, 'provenance');
    if (!isVerifiedPhase18SyntheticViewerTimeProvenanceV1(provenance)) {
      return reject('phase18_handoff_source_unverified');
    }
    const plan = Reflect.get(input, 'plan');
    if (!isVerifiedPhase18MultiwayHoldoutPlanAuditV1(plan)) {
      return reject('phase18_handoff_source_unverified');
    }
    if (plan.provenanceSha256 !== provenance.provenanceSha256
      || plan.phase17HandoffSha256 !== phase17Handoff.handoffSha256
      || provenance.sourceBindings.phase17HandoffSha256 !== phase17Handoff.handoffSha256
      || plan.predictionVerificationReceiptSha256
        !== provenance.sourceBindings.predictionVerificationReceiptSha256
      || phase17Handoff.candidateSelectionStatus !== 'no_candidate_selected'
      || phase17Handoff.selectedMethod !== 'diagnostics_only_abstention_v1'
      || plan.trainingApplied
      || plan.multiwayQHatProvenanceStatus !== 'plan_only_not_verified'
      || plan.dgpV2LaunchReadiness !== 'not_ready'
      || provenance.commonTimeShockHandlingVerified
      || provenance.realMultiwayClusterProvenancePresent
      || provenance.realDatasetEligible
      || provenance.qualificationEvidenceEligible
      || provenance.servable) {
      return reject('phase18_handoff_binding_mismatch');
    }
    const preimage = {
      contractVersion: PHASE18_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
      handoffScope: 'same_process_offline_diagnostic_v1' as const,
      developmentStatus: 'completed_multiway_holdout_plan_no_candidate_selected' as const,
      syntheticViewerTimeMembershipStatus:
        'verified_synthetic_partition_only' as const,
      multiwayHoldoutPlanStatus: 'verified_plan_only' as const,
      viewerTimeStatisticReadiness: 'not_ready' as const,
      multiwayQHatProvenanceStatus: 'plan_only_not_verified' as const,
      dgpV2LaunchReadiness: 'not_ready' as const,
      commonTimeShockHandlingVerified: false as const,
      realMultiwayClusterProvenancePresent: false as const,
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
      nextPhaseHandoff: 'multiway_qhat_evidence_incomplete' as const,
      phase17HandoffSha256: phase17Handoff.handoffSha256,
      provenanceSha256: provenance.provenanceSha256,
      planSha256: plan.planSha256,
      predictionVerificationReceiptSha256:
        provenance.sourceBindings.predictionVerificationReceiptSha256,
      blockers: PHASE18_HANDOFF_BLOCKERS_V1,
    };
    const candidate = {
      ...preimage,
      handoffSha256: phase18Digest(preimage),
    } as unknown as BrandedHandoff;
    Object.defineProperty(candidate, verifiedHandoff, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    verifiedObjects.add(candidate);
    freezePhase18(candidate);
    verifiedDigests.set(candidate, candidate.handoffSha256);
    verifiedOwners.set(candidate, Object.freeze({ phase17Handoff, provenance, plan }));
    return { status: 'verified', handoff: candidate };
  } catch {
    return reject('phase18_handoff_source_unverified');
  }
}

export function isVerifiedPhase18SameProcessNoCandidateHandoffV1(
  value: unknown,
): value is BrandedHandoff {
  try {
    if (!value || typeof value !== 'object' || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedHandoff;
    const owners = verifiedOwners.get(candidate);
    if (!owners
      || !isVerifiedPhase17SameProcessNoCandidateHandoffV1(owners.phase17Handoff)
      || !isVerifiedPhase18SyntheticViewerTimeProvenanceV1(owners.provenance)
      || !isVerifiedPhase18MultiwayHoldoutPlanAuditV1(owners.plan)) return false;
    const { handoffSha256, ...preimage } = candidate;
    return candidate[verifiedHandoff] === true
      && isPhase18Frozen(candidate)
      && handoffSha256 === phase18Digest(preimage)
      && verifiedDigests.get(candidate) === handoffSha256
      && candidate.phase17HandoffSha256 === owners.phase17Handoff.handoffSha256
      && candidate.provenanceSha256 === owners.provenance.provenanceSha256
      && candidate.planSha256 === owners.plan.planSha256;
  } catch {
    return false;
  }
}

function reject(blocker: Phase18HandoffBlockerV1): Phase18HandoffBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
