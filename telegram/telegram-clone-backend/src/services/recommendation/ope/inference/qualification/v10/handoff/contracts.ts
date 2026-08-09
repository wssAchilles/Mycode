export const PHASE20_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  'phase20_same_process_offline_diagnostic_handoff_v1' as const;

// This order is part of the digest-bound handoff contract.
export const PHASE20_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'data_adequacy_evidence_insufficient',
  'multiway_cluster_inference_unavailable',
  'common_time_shock_inference_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase20SameProcessOfflineDiagnosticHandoffV1 = Readonly<{
  contractVersion: typeof PHASE20_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  developmentStatus: 'completed_frozen_multiway_dgp_v2_no_candidate_selected';
  dgpV2Status: 'verified_synthetic_development_only';
  multiwayScoreSurfaceStatus: 'verified_synthetic_only';
  commonTimeShockScenarioPresent: true;
  commonTimeShockHandlingVerified: false;
  multiwayQHatQualityStatus: 'not_assessed_prediction_v4_mechanical_fixture_only';
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
  nextPhaseHandoff: 'ready_to_research_candidate_on_frozen_dgp_v2';
  phase19HandoffSha256: string;
  dgpProtocolSha256: string;
  scoreSurfaceSha256: string;
  blockers: typeof PHASE20_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase20HandoffBlockerV1 =
  | 'phase20_handoff_source_unverified'
  | 'phase20_handoff_binding_mismatch';

export type Phase20HandoffBuildResultV1 =
  | Readonly<{
    status: 'verified';
    handoff: Phase20SameProcessOfflineDiagnosticHandoffV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: Phase20HandoffBlockerV1;
  }>;
