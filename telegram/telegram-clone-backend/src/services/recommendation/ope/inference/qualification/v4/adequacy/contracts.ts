import type { SyntheticDgpEnvelopeV1 } from '../../v2/dgpMath';

export const VERIFIED_PHASE14_DATA_ADEQUACY_ASSESSMENT_V1 =
  'verified_phase14_data_adequacy_assessment_v1' as const;

export const PHASE14_DATA_ADEQUACY_EVIDENCE_GAPS_V1 = Object.freeze([
  'viewer_cluster_provenance_unavailable',
  'independent_viewer_cluster_count_unverified',
  'within_viewer_cluster_observation_count_unverified',
  'common_time_shock_handling_unverified',
  'joint_sign_symmetry_unverified',
  'real_randomized_propensity_evidence_unavailable',
  'real_full_support_evidence_unavailable',
  'real_reward_bounds_not_bound_to_assessment',
  'real_qhat_range_contract_unavailable',
  'real_prefix_weight_bound_evidence_unavailable',
  'sequential_prefix_mapping_unverified',
  'cross_fitting_provenance_unverified',
  'stopping_rule_unverified',
] as const);

export type Phase14DataAdequacyEvidenceGapV1 =
  typeof PHASE14_DATA_ADEQUACY_EVIDENCE_GAPS_V1[number];

export type Phase14ResearchFamilyEvidenceV1 = Readonly<{
  researchFamily:
    | 'cluster_multiplier_wild_bootstrap'
    | 'small_number_large_cluster_wild_bootstrap'
    | 'ibragimov_muller_group_t'
    | 'exact_sign_randomization'
    | 'bounded_self_normalized_robust_mean'
    | 'off_policy_confidence_sequence';
  unmetEvidence: readonly Phase14DataAdequacyEvidenceGapV1[];
}>;

export type Phase14ExactSignResolutionAuditV1 = Readonly<{
  contractVersion: 'exact_sign_randomization_resolution_audit_v1';
  status: 'evaluated';
  procedure: 'exact_sign_randomization_resolution_audit_v1';
  transformationGroup: 'all_cluster_sign_vectors_v1';
  identityIncluded: true;
  tail: 'one_sided_inclusive_v1';
  randomizedBoundary: false;
  midP: false;
  clusterCount: number;
  transformationCount: number;
  minimumNonrandomizedPValue: number;
  symmetryAssumptionVerified: false;
  candidateEvidenceEligible: false;
  auditSha256: string;
}>;

export type Phase14ObservedSyntheticEnvelopeV1 = SyntheticDgpEnvelopeV1 & Readonly<{
  syntheticRewardSupport: readonly [0, 1];
  clusterUnitVersionPresent: false;
  viewerClusterProvenancePresent: false;
  crossFitProvenance: 'synthetic_direct_qhat_not_cross_fitted';
  revealedDevelopmentEvidence: true;
  exactSignResolutionAudits: readonly Phase14ExactSignResolutionAuditV1[];
}>;

export type Phase14AdequacySourceBindingsV1 = Readonly<{
  protocolSha256: string;
  qualificationSha256: string;
  generatorSeedSha256: string;
  bootstrapSeedSha256: string;
  rawArtifactSha256: string;
  rawArtifactRecordCount: number;
  rawArtifactByteCount: number;
  sourceReceiptSha256: string;
  attributionSha256: string;
  attributionRecordCount: number;
  diagnosticDomainSha256: string;
  honestResultSha256: string;
  dgpSha256: string;
  scoreGeneratorSha256: string;
  diagnosticMethodSha256: string;
  diagnosticMethodConfigSha256: string;
}>;

export type VerifiedPhase14DataAdequacyAssessmentV1 = Readonly<{
  contractVersion: typeof VERIFIED_PHASE14_DATA_ADEQUACY_ASSESSMENT_V1;
  estimand: 'mean_reward_per_logged_slot_v1';
  dataAdequacyStatus: 'current_evidence_insufficient';
  candidateApplicabilityStatus: 'not_assessed_no_candidate_selected';
  researchDisposition: 'current_evidence_insufficient_to_select_candidate';
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  sourceBindings: Phase14AdequacySourceBindingsV1;
  observedSyntheticEnvelope: Phase14ObservedSyntheticEnvelopeV1;
  researchEvidenceGaps: readonly Phase14ResearchFamilyEvidenceV1[];
  evidenceGaps: readonly Phase14DataAdequacyEvidenceGapV1[];
  assessmentSha256: string;
}>;

export type Phase14DataAdequacyAssessmentBlockerV1 =
  | 'adequacy_source_unverified'
  | 'adequacy_source_not_attributed'
  | 'adequacy_binding_mismatch'
  | 'synthetic_dgp_envelope_unavailable';

export type Phase14DataAdequacyAssessmentResultV1 =
  | { status: 'verified'; assessment: VerifiedPhase14DataAdequacyAssessmentV1 }
  | { status: 'not_evaluable'; blocker: Phase14DataAdequacyAssessmentBlockerV1 };
