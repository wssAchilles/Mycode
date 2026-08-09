export const PHASE18_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  'phase18_same_process_offline_diagnostic_handoff_v1' as const;

export const PHASE18_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'independent_cluster_adequacy_unverified',
  'multiway_qhat_training_not_verified',
  'frozen_dgp_v2_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase18SameProcessOfflineDiagnosticHandoffV1 = Readonly<{
  contractVersion: typeof PHASE18_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  developmentStatus: 'completed_multiway_holdout_plan_no_candidate_selected';
  syntheticViewerTimeMembershipStatus: 'verified_synthetic_partition_only';
  multiwayHoldoutPlanStatus: 'verified_plan_only';
  viewerTimeStatisticReadiness: 'not_ready';
  multiwayQHatProvenanceStatus: 'plan_only_not_verified';
  dgpV2LaunchReadiness: 'not_ready';
  commonTimeShockHandlingVerified: false;
  realMultiwayClusterProvenancePresent: false;
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
  nextPhaseHandoff: 'multiway_qhat_evidence_incomplete';
  phase17HandoffSha256: string;
  provenanceSha256: string;
  planSha256: string;
  predictionVerificationReceiptSha256: string;
  blockers: typeof PHASE18_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase18HandoffBlockerV1 =
  | 'phase18_handoff_source_unverified'
  | 'phase18_handoff_binding_mismatch';

export type Phase18HandoffBuildResultV1 =
  | Readonly<{
    status: 'verified';
    handoff: Phase18SameProcessOfflineDiagnosticHandoffV1;
  }>
  | Readonly<{ status: 'not_evaluable'; blocker: Phase18HandoffBlockerV1 }>;
