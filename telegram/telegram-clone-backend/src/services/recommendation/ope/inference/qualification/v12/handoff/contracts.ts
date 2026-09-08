export const PHASE22_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1 =
  'phase22_same_process_honest_no_candidate_handoff_v1' as const;

export const PHASE22_SAME_PROCESS_OFFLINE_DIAGNOSTIC_HANDOFF_V1 =
  PHASE22_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1;

// This order is digest-bound and is part of the private handoff contract.
export const PHASE22_HANDOFF_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'data_adequacy_evidence_insufficient',
  'real_evidence_intake_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase22SameProcessHonestNoCandidateHandoffV1 = Readonly<{
  contractVersion: typeof PHASE22_SAME_PROCESS_HONEST_NO_CANDIDATE_HANDOFF_V1;
  handoffScope: 'same_process_offline_diagnostic_v1';
  developmentStatus: 'completed_real_evidence_intake_no_candidate_selected';
  realEvidenceIntakeStatus: 'verified_not_ready';
  sealedReadinessStatus: 'verified_not_ready';
  qualificationReadiness: 'not_ready';
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
  phase21HandoffSha256: string;
  phase21AssessmentSha256: string;
  phase21CrossFitAuditSha256: string;
  realEvidenceIntakeSha256: string;
  sealedReadinessSha256: string;
  sourceBindings: Readonly<{
    phase21HandoffSha256: string;
    phase21AssessmentSha256: string;
    phase21CrossFitAuditSha256: string;
    realEvidenceIntakeSha256: string;
    sealedReadinessSha256: string;
  }>;
  blockers: typeof PHASE22_HANDOFF_BLOCKERS_V1;
  handoffSha256: string;
}>;

export type Phase22SameProcessOfflineDiagnosticHandoffV1 =
  Phase22SameProcessHonestNoCandidateHandoffV1;

export type Phase22HandoffBlockerV1 =
  | 'phase22_handoff_source_unverified'
  | 'phase22_handoff_binding_mismatch';

export type Phase22HandoffBuildResultV1 =
  | Readonly<{
    status: 'verified';
    handoff: Phase22SameProcessHonestNoCandidateHandoffV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: Phase22HandoffBlockerV1;
  }>;
