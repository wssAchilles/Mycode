import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../../../../decisionLog/contracts';
import {
  isVerifiedCrossFittedCohortPredictionSetV3,
} from '../../../../../offlinePrediction/predictionV3';
import {
  isVerifiedPhase15SameProcessNoCandidateHandoffV1,
} from '../../v5/handoff';
import {
  isVerifiedViewerClusterHoldoutPlanV1,
} from '../../../../../offlinePrediction/predictionV3';
import {
  PHASE16_HANDOFF_BLOCKERS_V1,
  PHASE16_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
  type Phase16HandoffBuildResultV1,
  type Phase16SameProcessOfflineDiagnosticHandoffV1,
} from './contracts';

export * from './contracts';

const verifiedHandoff = Symbol('verifiedPhase16SameProcessOfflineDiagnosticHandoffV1');
const verifiedHandoffs = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

type BrandedHandoff = Phase16SameProcessOfflineDiagnosticHandoffV1 & {
  readonly [verifiedHandoff]: true;
};

export function buildPhase16SameProcessNoCandidateHandoffV1(
  input: unknown,
): Phase16HandoffBuildResultV1 {
  const fields = handoffInput(input);
  if (!fields
    || !isVerifiedPhase15SameProcessNoCandidateHandoffV1(fields.phase15Handoff)
    || !isVerifiedViewerClusterHoldoutPlanV1(fields.holdoutPlan)
    || !isVerifiedCrossFittedCohortPredictionSetV3(fields.predictionSet)) {
    return { status: 'not_evaluable', blocker: 'phase16_handoff_source_unverified' };
  }
  const phase15Handoff = fields.phase15Handoff;
  const holdoutPlan = fields.holdoutPlan;
  const predictionSet = fields.predictionSet;
  if (phase15Handoff.candidateSelectionStatus !== 'no_candidate_selected'
    || phase15Handoff.selectedMethod !== 'diagnostics_only_abstention_v1'
    || predictionSet.holdoutPlan !== holdoutPlan
    || predictionSet.receipt.holdoutPlanSha256 !== holdoutPlan.holdoutPlanSha256
    || !holdoutPlan.sameViewerLeakageExcluded
    || predictionSet.realDatasetEligible
    || predictionSet.servable) {
    return { status: 'not_evaluable', blocker: 'phase16_handoff_binding_mismatch' };
  }
  const preimage = {
    contractVersion: PHASE16_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1,
    handoffScope: 'same_process_offline_diagnostic_v1' as const,
    developmentStatus: 'completed_viewer_cluster_cross_fit_no_candidate_selected' as const,
    sameViewerLeakageExcluded: true as const,
    independentViewerClustersVerified: false as const,
    timeClusterProvenancePresent: false as const,
    multiwayCrossFitReady: false as const,
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
    phase15HandoffSha256: phase15Handoff.handoffSha256,
    holdoutPlanSha256: holdoutPlan.holdoutPlanSha256,
    predictionSetVersion: predictionSet.receipt.predictionSetVersion,
    predictionVerificationReceiptSha256: predictionSet.receipt.receiptSha256,
    blockers: PHASE16_HANDOFF_BLOCKERS_V1,
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

export function isVerifiedPhase16SameProcessNoCandidateHandoffV1(
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
  phase15Handoff: unknown;
  holdoutPlan: unknown;
  predictionSet: unknown;
} | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return {
      phase15Handoff: Reflect.get(value, 'phase15Handoff'),
      holdoutPlan: Reflect.get(value, 'holdoutPlan'),
      predictionSet: Reflect.get(value, 'predictionSet'),
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
