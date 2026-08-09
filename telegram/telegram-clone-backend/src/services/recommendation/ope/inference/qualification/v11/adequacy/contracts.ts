import type {
  Phase21EvidenceGapV1,
  Phase21ResearchFamilyEvidenceV1,
  VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1,
} from '../evidenceEnvelope';

export const VERIFIED_PHASE21_DATA_ADEQUACY_ASSESSMENT_V1 =
  'verified_phase21_data_adequacy_assessment_v1' as const;

export const PHASE21_DATA_ADEQUACY_RESOURCE_LIMITS_V1 = Object.freeze({
  version: 'phase21_data_adequacy_resource_limits_v1',
  maximumRecords: 8_192,
  maximumCanonicalInputBytes: 33_554_432,
  maximumWorkUnits: 65_536,
} as const);

export const PHASE21_DATA_ADEQUACY_BLOCKERS_V1 = Object.freeze([
  'real_viewer_cluster_provenance_unavailable',
  'real_time_cluster_provenance_unavailable',
  'real_full_support_evidence_unavailable',
  'real_randomized_propensity_evidence_unavailable',
  'real_reward_or_weight_bounds_unavailable',
  'real_qhat_cross_fit_provenance_unavailable',
  'sequential_stopping_rule_unavailable',
  'multiway_dependence_handling_unavailable',
] as const);

export type Phase21DataAdequacyBlockerV1 = typeof PHASE21_DATA_ADEQUACY_BLOCKERS_V1[number];

export type Phase21DataAdequacySourceBindingsV1 = Readonly<{
  phase20HandoffSha256: string;
  evidenceEnvelopeSha256: string;
  crossFitAuditSha256: string;
}>;

export type VerifiedPhase21DataAdequacyAssessmentV1 = Readonly<{
  contractVersion: typeof VERIFIED_PHASE21_DATA_ADEQUACY_ASSESSMENT_V1;
  estimand: 'mean_reward_per_logged_slot_v1';
  dataAdequacyStatus: 'current_evidence_insufficient';
  candidateApplicabilityStatus: 'not_assessed_no_candidate_selected';
  researchDisposition: 'current_evidence_insufficient_to_select_candidate';
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  sourceBindings: Phase21DataAdequacySourceBindingsV1;
  observedEnvelope: VerifiedPhase21ViewerTimeClusterEvidenceEnvelopeV1['observedEnvelope'];
  researchEvidence: readonly Readonly<{
    researchFamily: Phase21ResearchFamilyEvidenceV1['researchFamily'];
    unmetEvidence: readonly Phase21EvidenceGapV1[];
  }>[];
  evidenceGaps: readonly Phase21EvidenceGapV1[];
  blockers: typeof PHASE21_DATA_ADEQUACY_BLOCKERS_V1;
  resourceDiagnostics: Readonly<{
    preflightCompletedBeforeAssessment: true;
    records: number;
    canonicalInputBytes: number;
    workUnits: number;
    candidateCalls: 0;
    inferenceCalls: 0;
    publicationCalls: 0;
  }>;
  assessmentSha256: string;
}>;

export type Phase21DataAdequacyAssessmentBlockerV1 =
  | 'phase21_adequacy_source_unverified'
  | 'phase21_adequacy_binding_mismatch'
  | 'phase21_adequacy_resource_limit_exceeded';

export type Phase21DataAdequacyAssessmentResultV1 =
  | Readonly<{
    status: 'verified';
    assessment: VerifiedPhase21DataAdequacyAssessmentV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: Phase21DataAdequacyAssessmentBlockerV1;
  }>;
