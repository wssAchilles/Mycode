export const VERIFIED_PHASE21_VIEWER_TIME_CLUSTER_EVIDENCE_ENVELOPE_V1 =
  'verified_viewer_time_cluster_evidence_envelope_v1' as const;

export const PHASE21_VIEWER_TIME_EVIDENCE_RESOURCE_LIMITS_V1 = Object.freeze({
  version: 'phase21_viewer_time_evidence_resource_limits_v1',
  maximumContributions: 8_192,
  maximumMemberships: 8_192,
  maximumCanonicalContributionBytes: 1_048_576,
  maximumCanonicalInputBytes: 33_554_432,
  maximumWorkUnits: 65_536,
} as const);

export const PHASE21_EVIDENCE_GAPS_V1 = Object.freeze([
  'real_viewer_cluster_provenance_unavailable',
  'real_time_cluster_provenance_unavailable',
  'real_full_support_evidence_unavailable',
  'real_randomized_propensity_evidence_unavailable',
  'real_reward_or_weight_bounds_unavailable',
  'real_qhat_cross_fit_provenance_unavailable',
  'sequential_stopping_rule_unavailable',
  'multiway_dependence_handling_unavailable',
] as const);

export type Phase21EvidenceGapV1 = typeof PHASE21_EVIDENCE_GAPS_V1[number];

export type Phase21EvidenceEnvelopeSourceBindingsV1 = Readonly<{
  phase20HandoffSha256: string;
  dgpProtocolSha256: string;
  scoreSurfaceSha256: string;
  pitSnapshotSha256: string | null;
  decisionContextSha256: string | null;
  opeReceiptSha256: string | null;
  predictionReceiptSha256: string | null;
  targetEvidenceSha256: string | null;
  outcomeEvidenceSha256: string | null;
  viewerTimeMembershipSha256: string | null;
  crossFitReceiptSha256: string | null;
  sourceRecordCount: number | null;
  sourceByteCount: number | null;
  resourcePlanSha256: string | null;
}>;

export type Phase21ClusterObservationSummaryV1 = Readonly<{
  count: number | null;
  minimum: number | null;
  maximum: number | null;
  imbalanceRatio: number | null;
}>;

export type Phase21ObservedViewerTimeEnvelopeV1 = Readonly<{
  viewerClusterCount: number | null;
  timeClusterCount: number | null;
  cellCount: number | null;
  viewerClusterObservations: Phase21ClusterObservationSummaryV1;
  timeClusterObservations: Phase21ClusterObservationSummaryV1;
  cellObservations: Phase21ClusterObservationSummaryV1;
  viewerClusterSizes: readonly number[];
  timeClusterSizes: readonly number[];
  cellSizes: readonly number[];
  maximumPrefixWeight: number | null;
  minimumBehaviorPropensity: number | null;
  fullSupportVerified: false;
  randomizedPropensityVerified: false;
  rewardBoundsVerified: false;
  weightBoundsVerified: false;
  qHatCrossFitVerified: false;
  commonTimeShockHandled: false;
  multiwayDependenceHandled: false;
  stoppingRuleVerified: false;
}>;

export type Phase21ResearchFamilyEvidenceV1 = Readonly<{
  researchFamily:
    | 'cluster_multiplier_wild_bootstrap'
    | 'small_number_large_cluster_wild_bootstrap'
    | 'ibragimov_muller_group_t'
    | 'exact_sign_randomization'
    | 'bounded_self_normalized_robust_mean'
    | 'off_policy_confidence_sequence';
  unmetEvidence: readonly Phase21EvidenceGapV1[];
}>;

export type VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1 = Readonly<{
  contractVersion: typeof VERIFIED_PHASE21_VIEWER_TIME_CLUSTER_EVIDENCE_ENVELOPE_V1;
  estimand: 'mean_reward_per_logged_slot_v1';
  evidenceStatus: 'not_ready';
  sourceClusterUnitVersion: null;
  timeClusterUnitVersion: null;
  cellUnitVersion: null;
  viewerTimeCellMembershipPresent: false;
  viewerClusterProvenancePresent: false;
  timeClusterProvenancePresent: false;
  realMultiwayClusterProvenancePresent: false;
  sourceBindings: Phase21EvidenceEnvelopeSourceBindingsV1;
  observedEnvelope: Phase21ObservedViewerTimeEnvelopeV1;
  researchEvidence: readonly Phase21ResearchFamilyEvidenceV1[];
  evidenceGaps: readonly Phase21EvidenceGapV1[];
  resourceDiagnostics: Readonly<{
    preflightCompletedBeforeSourceScan: true;
    contributions: number;
    memberships: number;
    canonicalInputBytes: number;
    workUnits: number;
    candidateCalls: 0;
    inferenceCalls: 0;
    publicationCalls: 0;
  }>;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  envelopeSha256: string;
}>;

export type Phase21ViewerTimeEvidenceEnvelopeBlockerV1 =
  | 'phase21_evidence_source_unverified'
  | 'phase21_evidence_phase20_binding_mismatch'
  | 'phase21_synthetic_provenance_rejected'
  | 'phase21_evidence_resource_limit_exceeded';

export type Phase21ViewerTimeEvidenceEnvelopeBuildResultV1 =
  | Readonly<{
    status: 'verified';
    envelope: VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: Phase21ViewerTimeEvidenceEnvelopeBlockerV1;
  }>;
