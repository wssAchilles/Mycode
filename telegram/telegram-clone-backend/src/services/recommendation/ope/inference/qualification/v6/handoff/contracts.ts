export const PHASE16_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  'phase16_same_process_offline_diagnostic_handoff_v1' as const;

export const PHASE16_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'data_adequacy_evidence_insufficient',
  'inference_ready_viewer_cluster_statistic_unavailable',
  'multiway_cluster_provenance_unavailable',
  'real_full_support_evidence_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase16SameProcessOfflineDiagnosticHandoffV1 = Readonly<{
  contractVersion: typeof PHASE16_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  developmentStatus: 'completed_viewer_cluster_cross_fit_no_candidate_selected';
  sameViewerLeakageExcluded: true;
  independentViewerClustersVerified: false;
  timeClusterProvenancePresent: false;
  multiwayCrossFitReady: false;
  researchCandidateMethod: null;
  candidateSelectionStatus: 'no_candidate_selected';
  candidateQualificationStatus: 'not_run';
  candidateApplicabilityStatus: 'not_assessed_no_candidate_selected';
  selectedMethod: 'diagnostics_only_abstention_v1';
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  sealedQualificationStatus: 'not_ready';
  nextPhaseHandoff: 'no_candidate_selected';
  phase15HandoffSha256: string;
  holdoutPlanSha256: string;
  predictionSetVersion: string;
  predictionVerificationReceiptSha256: string;
  blockers: typeof PHASE16_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase16HandoffBuildResultV1 =
  | { status: 'verified'; handoff: Phase16SameProcessOfflineDiagnosticHandoffV1 }
  | {
    status: 'not_evaluable';
    blocker: 'phase16_handoff_source_unverified' | 'phase16_handoff_binding_mismatch';
  };
