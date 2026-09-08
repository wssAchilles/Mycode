export const PHASE14_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  'phase14_same_process_offline_diagnostic_handoff_v1' as const;

export const PHASE14_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'data_adequacy_evidence_insufficient',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase14SameProcessOfflineDiagnosticHandoffV1 = Readonly<{
  contractVersion: typeof PHASE14_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  developmentStatus: 'completed_no_candidate_selected';
  researchCandidateMethod: null;
  candidateSelectionStatus: 'no_candidate_selected';
  candidateQualificationStatus: 'not_run';
  candidateApplicabilityStatus: 'not_assessed_no_candidate_selected';
  qualificationEvidenceEligible: false;
  selectedMethod: 'diagnostics_only_abstention_v1';
  realDatasetEligible: false;
  sealedQualificationStatus: 'not_ready';
  nextPhaseHandoff: 'no_candidate_selected';
  phase13ResultSha256: string;
  phase14AssessmentSha256: string;
  blockers: typeof PHASE14_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase14HandoffBuildResultV1 =
  | { status: 'verified'; handoff: Phase14SameProcessOfflineDiagnosticHandoffV1 }
  | {
    status: 'not_evaluable';
    blocker: 'phase14_handoff_source_unverified' | 'phase14_handoff_binding_mismatch';
  };
