export const PHASE19_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  'phase19_same_process_offline_diagnostic_handoff_v1' as const;

export const PHASE19_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'independent_cluster_adequacy_unverified',
  'synthetic_multiway_qhat_quality_unverified',
  'common_time_shock_inference_unavailable',
  'frozen_dgp_v2_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase19SameProcessOfflineDiagnosticHandoffV1 = Readonly<{
  contractVersion: typeof PHASE19_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  developmentStatus: 'completed_multiway_qhat_retraining_no_candidate_selected';
  multiwayQHatProvenanceStatus: 'verified_synthetic_only';
  trainingApplied: true;
  trainingEvidenceScope: 'mechanical_training_e2e_only';
  dgpV2LaunchReadiness: 'ready_for_frozen_design';
  commonTimeShockHandlingVerified: false;
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
  nextPhaseHandoff: 'ready_to_design_frozen_dgp_v2';
  phase18HandoffSha256: string;
  phase18ProvenanceSha256: string;
  phase18PlanSha256: string;
  sourcePredictionVerificationReceiptSha256: string;
  predictionV4SetVersion: string;
  predictionV4ModelBundleSha256: string;
  predictionV4StreamSha256: string;
  predictionV4VerificationReceiptSha256: string;
  blockers: typeof PHASE19_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase19HandoffBlockerV1 =
  | 'phase19_handoff_source_unverified'
  | 'phase19_handoff_binding_mismatch';

export type Phase19HandoffBuildResultV1 =
  | Readonly<{
    status: 'verified';
    handoff: Phase19SameProcessOfflineDiagnosticHandoffV1;
  }>
  | Readonly<{ status: 'not_evaluable'; blocker: Phase19HandoffBlockerV1 }>;
