export const PHASE15_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  'phase15_same_process_offline_diagnostic_handoff_v1' as const;

export const PHASE15_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'data_adequacy_evidence_insufficient',
  'inference_ready_viewer_cluster_statistic_unavailable',
  'cluster_aware_cross_fitting_unavailable',
  'multiway_cluster_provenance_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase15SameProcessOfflineDiagnosticHandoffV1 = Readonly<{
  contractVersion: typeof PHASE15_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  crossPhaseBindingStatus: 'not_assessed_no_common_binding';
  developmentStatus: 'completed_mapping_audit_no_candidate_selected';
  clusterStatisticMappingStatus: 'synthetic_mapping_verified';
  viewerClusterStatisticReadiness: 'not_ready';
  researchCandidateMethod: null;
  candidateSelectionStatus: 'no_candidate_selected';
  candidateQualificationStatus: 'not_run';
  candidateApplicabilityStatus: 'not_assessed_no_candidate_selected';
  selectedMethod: 'diagnostics_only_abstention_v1';
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  sealedQualificationStatus: 'not_ready';
  nextPhaseHandoff: 'no_candidate_selected';
  phase14HandoffSha256: string;
  phase15MappingSha256: string;
  blockers: typeof PHASE15_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase15HandoffBuildResultV1 =
  | { status: 'verified'; handoff: Phase15SameProcessOfflineDiagnosticHandoffV1 }
  | {
    status: 'not_evaluable';
    blocker: 'phase15_handoff_source_unverified' | 'phase15_handoff_binding_mismatch';
  };
