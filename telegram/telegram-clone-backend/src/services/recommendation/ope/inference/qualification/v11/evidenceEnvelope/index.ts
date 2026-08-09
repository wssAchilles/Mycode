import {
  isVerifiedPhase20SameProcessNoCandidateHandoffV1,
  type Phase20SameProcessOfflineDiagnosticHandoffV1,
} from '../../v10/handoff';
import {
  phase21CanonicalBytes,
  phase21Digest,
  phase21Freeze,
  phase21IsFrozen,
  phase21IsNonnegativeSafeInteger,
  phase21IsObjectLike,
  phase21IsSha256,
  phase21SafeGet,
} from '../privateCore';
import {
  PHASE21_EVIDENCE_GAPS_V1,
  PHASE21_VIEWER_TIME_EVIDENCE_RESOURCE_LIMITS_V1,
  VERIFIED_PHASE21_VIEWER_TIME_CLUSTER_EVIDENCE_ENVELOPE_V1,
  type Phase21EvidenceGapV1,
  type Phase21EvidenceEnvelopeSourceBindingsV1,
  type Phase21ResearchFamilyEvidenceV1,
  type Phase21ViewerTimeEvidenceEnvelopeBlockerV1,
  type Phase21ViewerTimeEvidenceEnvelopeBuildResultV1,
  type VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
} from './contracts';

export * from './contracts';

const verifiedEnvelope = Symbol('verifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1');
const verifiedObjects = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const verifiedOwners = new WeakMap<object, Phase20SameProcessOfflineDiagnosticHandoffV1>();

type BrandedEnvelope = VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1 & {
  readonly [verifiedEnvelope]: true;
};

export function buildPhase21ViewerTimeEvidenceEnvelopeV1(
  input: unknown,
): Phase21ViewerTimeEvidenceEnvelopeBuildResultV1 {
  try {
    const fields = readInput(input);
    if (!fields || !isVerifiedPhase20SameProcessNoCandidateHandoffV1(fields.phase20Handoff)) {
      return reject('phase21_evidence_source_unverified');
    }
    const phase20Handoff = fields.phase20Handoff;
    if (!phase20BindingMatches(phase20Handoff)) {
      return reject('phase21_evidence_phase20_binding_mismatch');
    }
    const canonicalInputBytes = phase21CanonicalBytes({
      phase20HandoffSha256: phase20Handoff.handoffSha256,
      dgpProtocolSha256: phase20Handoff.dgpProtocolSha256,
      scoreSurfaceSha256: phase20Handoff.scoreSurfaceSha256,
    });
    if (!resourcePlanAllows(fields.plannedResources, canonicalInputBytes)) {
      return reject('phase21_evidence_resource_limit_exceeded');
    }

    // Phase 18's crossed memberships are deliberately synthetic and cannot be
    // promoted to real viewer/time provenance by this diagnostic boundary.
    if (fields.syntheticProvenance !== undefined && fields.syntheticProvenance !== null) {
      return reject('phase21_synthetic_provenance_rejected');
    }
    // No real viewer/time source contract exists in this phase. An unbranded
    // caller object is therefore never treated as evidence.
    if (fields.realSources !== undefined) {
      return reject('phase21_evidence_source_unverified');
    }

    const preimage = {
      contractVersion: VERIFIED_PHASE21_VIEWER_TIME_CLUSTER_EVIDENCE_ENVELOPE_V1,
      estimand: 'mean_reward_per_logged_slot_v1' as const,
      evidenceStatus: 'not_ready' as const,
      sourceClusterUnitVersion: null,
      timeClusterUnitVersion: null,
      cellUnitVersion: null,
      viewerTimeCellMembershipPresent: false as const,
      viewerClusterProvenancePresent: false as const,
      timeClusterProvenancePresent: false as const,
      realMultiwayClusterProvenancePresent: false as const,
      sourceBindings: sourceBindings(phase20Handoff),
      observedEnvelope: observedEnvelope(),
      researchEvidence: researchEvidence(),
      evidenceGaps: PHASE21_EVIDENCE_GAPS_V1,
      resourceDiagnostics: {
        preflightCompletedBeforeSourceScan: true as const,
        contributions: 0,
        memberships: 0,
        canonicalInputBytes,
        workUnits: 0,
        candidateCalls: 0 as const,
        inferenceCalls: 0 as const,
        publicationCalls: 0 as const,
      },
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    if (preimage.resourceDiagnostics.canonicalInputBytes
      > PHASE21_VIEWER_TIME_EVIDENCE_RESOURCE_LIMITS_V1.maximumCanonicalInputBytes) {
      return reject('phase21_evidence_resource_limit_exceeded');
    }
    const candidate = {
      ...preimage,
      envelopeSha256: phase21Digest(preimage),
    } as unknown as BrandedEnvelope;
    Object.defineProperty(candidate, verifiedEnvelope, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    verifiedObjects.add(candidate);
    phase21Freeze(candidate);
    verifiedDigests.set(candidate, candidate.envelopeSha256);
    verifiedOwners.set(candidate, phase20Handoff);
    return { status: 'verified', envelope: candidate };
  } catch {
    return reject('phase21_evidence_source_unverified');
  }
}

// Long-form alias used by callers that name the artifact rather than the audit.
export const buildVerifiedViewerTimeClusterEvidenceEnvelopeV1 =
  buildPhase21ViewerTimeEvidenceEnvelopeV1;
export const buildVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1 =
  buildPhase21ViewerTimeEvidenceEnvelopeV1;
export const buildPhase21VerifiedViewerTimeClusterEvidenceEnvelopeV1 =
  buildPhase21ViewerTimeEvidenceEnvelopeV1;

export function isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1(
  value: unknown,
): value is BrandedEnvelope {
  try {
    if (!phase21IsObjectLike(value) || !verifiedObjects.has(value)) return false;
    const candidate = value as BrandedEnvelope;
    const owner = verifiedOwners.get(candidate);
    if (!owner || !isVerifiedPhase20SameProcessNoCandidateHandoffV1(owner)) return false;
    const envelopeSha256 = phase21SafeGet(candidate, 'envelopeSha256');
    const preimage = { ...candidate } as Record<string, unknown>;
    if (!Reflect.deleteProperty(preimage, 'envelopeSha256')) return false;
    return phase21SafeGet(candidate, verifiedEnvelope) === true
      && phase21IsFrozen(candidate)
      && phase21IsSha256(envelopeSha256)
      && envelopeSha256 === phase21Digest(preimage)
      && verifiedDigests.get(candidate) === envelopeSha256
      && phase21SafeGet(candidate, 'evidenceStatus') === 'not_ready'
      && phase21SafeGet(candidate, 'realDatasetEligible') === false
      && phase21SafeGet(candidate, 'candidateEvidenceEligible') === false
      && phase21SafeGet(candidate, 'qualificationEvidenceEligible') === false
      && sourceBindingsMatch(phase21SafeGet(candidate, 'sourceBindings'), owner)
      && stableGaps(phase21SafeGet(candidate, 'evidenceGaps'));
  } catch {
    return false;
  }
}

export const isVerifiedViewerTimeClusterEvidenceEnvelopeV1 =
  isVerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1;

function readInput(value: unknown): {
  phase20Handoff: unknown;
  syntheticProvenance: unknown;
  realSources: unknown;
  plannedResources: unknown;
} | null {
  if (!phase21IsObjectLike(value)) return null;
  try {
    return {
      phase20Handoff: Reflect.get(value, 'phase20Handoff')
        ?? Reflect.get(value, 'handoff'),
      syntheticProvenance: Reflect.get(value, 'syntheticProvenance'),
      realSources: Reflect.get(value, 'realSources')
        ?? Reflect.get(value, 'source')
        ?? Reflect.get(value, 'evidence')
        ?? Reflect.get(value, 'viewerTimeEvidence'),
      plannedResources: Reflect.get(value, 'plannedResources'),
    };
  } catch {
    return null;
  }
}

function resourcePlanAllows(value: unknown, actualCanonicalInputBytes: number): boolean {
  const limits = PHASE21_VIEWER_TIME_EVIDENCE_RESOURCE_LIMITS_V1;
  if (actualCanonicalInputBytes > limits.maximumCanonicalInputBytes) return false;
  if (value === undefined) return true;
  if (!phase21IsObjectLike(value)) return false;
  const contributions = phase21SafeGet(value, 'contributions');
  const memberships = phase21SafeGet(value, 'memberships');
  const canonicalInputBytes = phase21SafeGet(value, 'canonicalInputBytes');
  const workUnits = phase21SafeGet(value, 'workUnits');
  return phase21IsNonnegativeSafeInteger(contributions)
    && phase21IsNonnegativeSafeInteger(memberships)
    && phase21IsNonnegativeSafeInteger(canonicalInputBytes)
    && phase21IsNonnegativeSafeInteger(workUnits)
    && contributions <= limits.maximumContributions
    && memberships <= limits.maximumMemberships
    && canonicalInputBytes >= actualCanonicalInputBytes
    && canonicalInputBytes <= limits.maximumCanonicalInputBytes
    && workUnits <= limits.maximumWorkUnits;
}

function phase20BindingMatches(value: Phase20SameProcessOfflineDiagnosticHandoffV1): boolean {
  return phase21SafeGet(value, 'contractVersion')
      === 'phase20_same_process_offline_diagnostic_handoff_v1'
    && phase21SafeGet(value, 'handoffScope') === 'same_process_offline_diagnostic_v1'
    && phase21SafeGet(value, 'candidateSelectionStatus') === 'no_candidate_selected'
    && phase21SafeGet(value, 'candidateQualificationStatus') === 'not_run'
    && phase21SafeGet(value, 'selectedMethod') === 'diagnostics_only_abstention_v1'
    && phase21SafeGet(value, 'candidateApplicabilityStatus')
      === 'not_assessed_no_candidate_selected'
    && phase21SafeGet(value, 'qualificationEvidenceEligible') === false
    && phase21SafeGet(value, 'candidateEvidenceEligible') === false
    && phase21SafeGet(value, 'realDatasetEligible') === false
    && phase21SafeGet(value, 'servable') === false
    && phase21IsSha256(phase21SafeGet(value, 'handoffSha256'))
    && phase21IsSha256(phase21SafeGet(value, 'dgpProtocolSha256'))
    && phase21IsSha256(phase21SafeGet(value, 'scoreSurfaceSha256'));
}

function sourceBindings(
  phase20Handoff: Phase20SameProcessOfflineDiagnosticHandoffV1,
): Phase21EvidenceEnvelopeSourceBindingsV1 {
  return {
    phase20HandoffSha256: phase20Handoff.handoffSha256,
    dgpProtocolSha256: phase20Handoff.dgpProtocolSha256,
    scoreSurfaceSha256: phase20Handoff.scoreSurfaceSha256,
    pitSnapshotSha256: null,
    decisionContextSha256: null,
    opeReceiptSha256: null,
    predictionReceiptSha256: null,
    targetEvidenceSha256: null,
    outcomeEvidenceSha256: null,
    viewerTimeMembershipSha256: null,
    crossFitReceiptSha256: null,
    sourceRecordCount: null,
    sourceByteCount: null,
    resourcePlanSha256: null,
  };
}

function sourceBindingsMatch(value: unknown, owner: Phase20SameProcessOfflineDiagnosticHandoffV1): boolean {
  return phase21IsObjectLike(value)
    && phase21SafeGet(value, 'phase20HandoffSha256') === owner.handoffSha256
    && phase21SafeGet(value, 'dgpProtocolSha256') === owner.dgpProtocolSha256
    && phase21SafeGet(value, 'scoreSurfaceSha256') === owner.scoreSurfaceSha256
    && phase21SafeGet(value, 'pitSnapshotSha256') === null
    && phase21SafeGet(value, 'decisionContextSha256') === null
    && phase21SafeGet(value, 'opeReceiptSha256') === null
    && phase21SafeGet(value, 'predictionReceiptSha256') === null
    && phase21SafeGet(value, 'targetEvidenceSha256') === null
    && phase21SafeGet(value, 'outcomeEvidenceSha256') === null
    && phase21SafeGet(value, 'viewerTimeMembershipSha256') === null
    && phase21SafeGet(value, 'crossFitReceiptSha256') === null
    && phase21SafeGet(value, 'sourceRecordCount') === null
    && phase21SafeGet(value, 'sourceByteCount') === null
    && phase21SafeGet(value, 'resourcePlanSha256') === null;
}

function observedEnvelope(): VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1['observedEnvelope'] {
  const empty = { count: null, minimum: null, maximum: null, imbalanceRatio: null } as const;
  return {
    viewerClusterCount: null,
    timeClusterCount: null,
    cellCount: null,
    viewerClusterObservations: empty,
    timeClusterObservations: empty,
    cellObservations: empty,
    viewerClusterSizes: Object.freeze([]),
    timeClusterSizes: Object.freeze([]),
    cellSizes: Object.freeze([]),
    maximumPrefixWeight: null,
    minimumBehaviorPropensity: null,
    fullSupportVerified: false,
    randomizedPropensityVerified: false,
    rewardBoundsVerified: false,
    weightBoundsVerified: false,
    qHatCrossFitVerified: false,
    commonTimeShockHandled: false,
    multiwayDependenceHandled: false,
    stoppingRuleVerified: false,
  };
}

function researchEvidence(): readonly Phase21ResearchFamilyEvidenceV1[] {
  const gap = (researchFamily: Phase21ResearchFamilyEvidenceV1['researchFamily'], unmetEvidence: readonly Phase21EvidenceGapV1[]) => ({
    researchFamily,
    unmetEvidence,
  });
  return [
    gap('cluster_multiplier_wild_bootstrap', [
      'real_viewer_cluster_provenance_unavailable',
      'real_time_cluster_provenance_unavailable',
    ]),
    gap('small_number_large_cluster_wild_bootstrap', [
      'real_viewer_cluster_provenance_unavailable',
      'real_time_cluster_provenance_unavailable',
    ]),
    gap('ibragimov_muller_group_t', [
      'real_viewer_cluster_provenance_unavailable',
      'real_time_cluster_provenance_unavailable',
    ]),
    gap('exact_sign_randomization', [
      'real_viewer_cluster_provenance_unavailable',
      'multiway_dependence_handling_unavailable',
    ]),
    gap('bounded_self_normalized_robust_mean', [
      'real_viewer_cluster_provenance_unavailable',
      'real_full_support_evidence_unavailable',
      'real_randomized_propensity_evidence_unavailable',
      'real_reward_or_weight_bounds_unavailable',
    ]),
    gap('off_policy_confidence_sequence', [
      'real_full_support_evidence_unavailable',
      'real_randomized_propensity_evidence_unavailable',
      'real_qhat_cross_fit_provenance_unavailable',
      'sequential_stopping_rule_unavailable',
      'multiway_dependence_handling_unavailable',
    ]),
  ];
}

function stableGaps(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== PHASE21_EVIDENCE_GAPS_V1.length) return false;
  return PHASE21_EVIDENCE_GAPS_V1.every((gap, index) => phase21SafeGet(value, index) === gap);
}

function reject(blocker: Phase21ViewerTimeEvidenceEnvelopeBlockerV1): Phase21ViewerTimeEvidenceEnvelopeBuildResultV1 {
  return { status: 'not_evaluable', blocker };
}
