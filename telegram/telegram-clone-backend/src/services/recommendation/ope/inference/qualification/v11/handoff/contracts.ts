export const PHASE21_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1 =
  'phase21_same_process_honest_no_candidate_handoff_v1' as const;
export const PHASE21_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  PHASE21_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1;

// This order is digest-bound and must not be changed without a new contract version.
export const PHASE21_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'data_adequacy_evidence_insufficient',
  'real_viewer_cluster_provenance_unavailable',
  'real_time_cluster_provenance_unavailable',
  'real_full_support_evidence_unavailable',
  'real_randomized_propensity_evidence_unavailable',
  'real_reward_or_weight_bounds_unavailable',
  'real_qhat_cross_fit_provenance_unavailable',
  'sequential_stopping_rule_unavailable',
  'multiway_dependence_handling_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase21SameProcessHonestNoCandidateHandoffV1 = Readonly<{
  contractVersion: typeof PHASE21_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  developmentStatus: 'completed_viewer_time_adequacy_cross_fit_no_candidate_selected';
  phase20HandoffStatus: 'verified_no_candidate_selected';
  dataAdequacyStatus: 'not_ready';
  viewerTimeEvidenceStatus: 'not_ready';
  phase21AdequacyStatus: 'verified_not_ready';
  clusterAwareCrossFitStatus: 'verified_not_ready';
  researchCandidateMethod: null;
  candidateSelectionStatus: 'no_candidate_selected';
  candidateQualificationStatus: 'not_run';
  candidateApplicabilityStatus: 'not_assessed_no_candidate_selected';
  selectedMethod: 'diagnostics_only_abstention_v1';
  qualificationEvidenceEligible: false;
  candidateEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  sealedQualificationStatus: 'not_ready';
  nextPhaseHandoff: 'real_cluster_evidence_required';
  phase20HandoffSha256: string;
  phase21AssessmentSha256: string;
  phase21EvidenceEnvelopeSha256: string;
  phase21CrossFitAuditSha256: string;
  blockers: typeof PHASE21_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase21SameProcessOfflineDiagnosticHandoffV1 =
  Phase21SameProcessHonestNoCandidateHandoffV1;

export type Phase21HandoffBlockerV1 =
  | 'phase21_handoff_source_unverified'
  | 'phase21_handoff_binding_mismatch';

export type Phase21HandoffBuildResultV1 =
  | Readonly<{
    status: 'verified';
    handoff: Phase21SameProcessHonestNoCandidateHandoffV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: Phase21HandoffBlockerV1;
  }>;
