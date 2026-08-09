export const PHASE17_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  'phase17_same_process_offline_diagnostic_handoff_v1' as const;

export const PHASE17_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'independent_viewer_cluster_count_unverified',
  'within_viewer_cluster_observation_count_unverified',
  'common_time_shock_handling_unverified',
  'multiway_cluster_provenance_unavailable',
  'real_full_support_evidence_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase17SameProcessOfflineDiagnosticHandoffV1 = Readonly<{
  contractVersion: typeof PHASE17_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  developmentStatus: 'completed_viewer_cluster_mapping_no_candidate_selected';
  clusterStatisticMappingStatus: 'synthetic_viewer_cluster_mapping_verified';
  viewerClusterStatisticReadiness: 'synthetic_only';
  viewerClusterCrossFitProvenancePresent: true;
  independentViewerClustersVerified: false;
  commonTimeShockHandlingVerified: false;
  multiwayClusterProvenancePresent: false;
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
  phase16HandoffSha256: string;
  phase17MappingSha256: string;
  predictionSetVersion: string;
  predictionVerificationReceiptSha256: string;
  blockers: typeof PHASE17_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase17HandoffBuildResultV1 =
  | Readonly<{ status: 'verified'; handoff: Phase17SameProcessOfflineDiagnosticHandoffV1 }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: 'phase17_handoff_source_unverified' | 'phase17_handoff_binding_mismatch';
  }>;
