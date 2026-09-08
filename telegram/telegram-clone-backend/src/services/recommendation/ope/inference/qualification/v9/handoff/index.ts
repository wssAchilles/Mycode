import {
  isVerifiedMultiwayPredictionSetV4,
  type VerifiedMultiwayPredictionSetV4,
} from '../../../../../offlinePrediction/predictionV4';
import {
  isVerifiedPhase18SameProcessNoCandidateHandoffV1,
  type Phase18SameProcessOfflineDiagnosticHandoffV1,
} from '../../v8/handoff';
import {
  freezePhase19,
  isPhase19Frozen,
  phase19Digest,
} from '../privateCore';
import {
  PHASE19_HANDOFF_BLOCKERS_V1,
  PHASE19_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
  type Phase19HandoffBlockerV1,
  type Phase19HandoffBuildResultV1,
  type Phase19SameProcessOfflineDiagnosticHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase19SameProcessOfflineDiagnosticHandoffV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Readonly<{
  phase18Handoff: Phase18SameProcessOfflineDiagnosticHandoffV1;
  predictionSet: VerifiedMultiwayPredictionSetV4;
}>>();

type BrandedHandoff = Phase19SameProcessOfflineDiagnosticHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

export function buildPhase19SameProcessNoCandidateHandoffV1(
  input: unknown,
): Phase19HandoffBuildResultV1 {
  try {
    if (!input || typeof input !== 'object') {
      return reject('phase19_handoff_source_unverified');
    }
    const phase18Handoff = Reflect.get(input, 'phase18Handoff');
    if (!isVerifiedPhase18SameProcessNoCandidateHandoffV1(phase18Handoff)) {
      return reject('phase19_handoff_source_unverified');
    }
    const predictionSet = Reflect.get(input, 'predictionSet');
    if (!isVerifiedMultiwayPredictionSetV4(predictionSet)) {
      return reject('phase19_handoff_source_unverified');
    }
    const { manifest, receipt } = predictionSet;
    if (phase18Handoff.provenanceSha256 !== manifest.phase18ProvenanceSha256
      || phase18Handoff.provenanceSha256 !== receipt.phase18ProvenanceSha256
      || phase18Handoff.planSha256 !== manifest.phase18PlanSha256
      || phase18Handoff.planSha256 !== receipt.phase18PlanSha256
      || phase18Handoff.predictionVerificationReceiptSha256
        !== manifest.sourcePredictionVerificationReceiptSha256
      || phase18Handoff.predictionVerificationReceiptSha256
        !== receipt.sourcePredictionVerificationReceiptSha256
      || manifest.predictionSetVersion !== receipt.predictionSetVersion
      || manifest.modelBundleSha256 !== receipt.modelBundleSha256
      || manifest.predictionStreamSha256 !== receipt.predictionStreamSha256
      || manifest.sourcePredictionVerificationReceiptSha256
        !== receipt.sourcePredictionVerificationReceiptSha256
      || phase18Handoff.candidateSelectionStatus !== 'no_candidate_selected'
      || phase18Handoff.selectedMethod !== 'diagnostics_only_abstention_v1'
      || !predictionSet.trainingApplied
      || predictionSet.trainingEvidenceScope !== 'mechanical_training_e2e_only'
      || predictionSet.multiwayQHatProvenanceStatus !== 'verified_synthetic_only'
      || receipt.trainingEvidenceScope !== 'mechanical_training_e2e_only'
      || receipt.multiwayQHatProvenanceStatus !== 'verified_synthetic_only'
      || receipt.commonTimeShockHandlingVerified
      || receipt.candidateEvidenceEligible
      || receipt.qualificationEvidenceEligible
      || receipt.realDatasetEligible
      || receipt.servable
      || predictionSet.candidateEvidenceEligible
      || predictionSet.qualificationEvidenceEligible
      || predictionSet.realDatasetEligible
      || predictionSet.servable) {
      return reject('phase19_handoff_binding_mismatch');
    }
    const preimage = {
      contractVersion: PHASE19_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
      handoffScope: 'same_process_offline_diagnostic_v1' as const,
      developmentStatus:
        'completed_multiway_qhat_retraining_no_candidate_selected' as const,
      multiwayQHatProvenanceStatus: 'verified_synthetic_only' as const,
      trainingApplied: true as const,
      trainingEvidenceScope: 'mechanical_training_e2e_only' as const,
      dgpV2LaunchReadiness: 'ready_for_frozen_design' as const,
      commonTimeShockHandlingVerified: false as const,
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
      nextPhaseHandoff: 'ready_to_design_frozen_dgp_v2' as const,
      phase18HandoffSha256: phase18Handoff.handoffSha256,
      phase18ProvenanceSha256: phase18Handoff.provenanceSha256,
      phase18PlanSha256: phase18Handoff.planSha256,
      sourcePredictionVerificationReceiptSha256:
        phase18Handoff.predictionVerificationReceiptSha256,
      predictionV4SetVersion: manifest.predictionSetVersion,
      predictionV4ModelBundleSha256: manifest.modelBundleSha256,
      predictionV4StreamSha256: manifest.predictionStreamSha256,
      predictionV4VerificationReceiptSha256: receipt.receiptSha256,
      blockers: PHASE19_HANDOFF_BLOCKERS_V1,
    };
    const candidate = {
      ...preimage,
      handoffSha256: phase19Digest(preimage),
    } as unknown as BrandedHandoff;
    Object.defineProperty(candidate, verifiedHandoff, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    verifiedObjects.add(candidate);
    freezePhase19(candidate);
    verifiedDigests.set(candidate, candidate.handoffSha256);
    verifiedOwners.set(candidate, Object.freeze({ phase18Handoff, predictionSet }));
    return { status: 'verified', handoff: candidate };
  } catch {
    return reject('phase19_handoff_source_unverified');
  }
}

export function isVerifiedPhase19SameProcessNoCandidateHandoffV1(
  value: unknown,
): value is BrandedHandoff {
  try {
    if (!value || typeof value !== 'object' || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedHandoff;
    const owners = verifiedOwners.get(candidate);
    if (!owners
      || !isVerifiedPhase18SameProcessNoCandidateHandoffV1(owners.phase18Handoff)
      || !isVerifiedMultiwayPredictionSetV4(owners.predictionSet)) return false;
    const { manifest, receipt } = owners.predictionSet;
    const { handoffSha256, ...preimage } = candidate;
    return candidate[verifiedHandoff] === true
      && isPhase19Frozen(candidate)
      && handoffSha256 === phase19Digest(preimage)
      && verifiedDigests.get(candidate) === handoffSha256
      && candidate.phase18HandoffSha256 === owners.phase18Handoff.handoffSha256
      && candidate.phase18ProvenanceSha256 === owners.phase18Handoff.provenanceSha256
      && candidate.phase18PlanSha256 === owners.phase18Handoff.planSha256
      && candidate.sourcePredictionVerificationReceiptSha256
        === owners.phase18Handoff.predictionVerificationReceiptSha256
      && candidate.predictionV4SetVersion === manifest.predictionSetVersion
      && candidate.predictionV4ModelBundleSha256 === manifest.modelBundleSha256
      && candidate.predictionV4StreamSha256 === manifest.predictionStreamSha256
      && candidate.predictionV4VerificationReceiptSha256 === receipt.receiptSha256;
  } catch {
    return false;
  }
}

function reject(blocker: Phase19HandoffBlockerV1): Phase19HandoffBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
