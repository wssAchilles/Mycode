import type { Phase22RealEvidenceIntakeStatusV1 } from '../realEvidenceIntake/contracts';

export const PHASE22_SEALED_READINESS_ENVELOPE_V1 =
  'verified_phase22_sealed_readiness_envelope_v1' as const;
export const VERIFIED_PHASE22_SEALED_READINESS_ENVELOPE_V1 =
  PHASE22_SEALED_READINESS_ENVELOPE_V1;

// This order is digest-bound and must not be changed without a new contract version.
export const PHASE22_SEALED_READINESS_BLOCKERS_V1 = Object.freeze([
  'finite_sample_inference_unavailable',
  'multiplicity_control_unavailable',
  'candidate_method_unavailable',
  'data_adequacy_evidence_insufficient',
  'real_evidence_intake_unavailable',
  'sealed_qualification_protocol_unavailable',
] as const);

export type Phase22SealedReadinessBlockerV1 =
  typeof PHASE22_SEALED_READINESS_BLOCKERS_V1[number];

export type Phase22SealedReadinessSourceBindingsV1 = Readonly<{
  phase21HandoffSha256: string;
  phase21AssessmentSha256: string;
  phase21CrossFitAuditSha256: string;
  realEvidenceIntakeSha256: string;
}>;

export type Phase22SealedReadinessEnvelopeV1 = Readonly<{
  contractVersion: typeof PHASE22_SEALED_READINESS_ENVELOPE_V1;
  readinessKind: 'sealed_readiness_envelope_v1';
  readinessStatus: 'not_ready';
  sealedReadinessStatus: 'not_ready';
  realEvidenceIntakeStatus: Phase22RealEvidenceIntakeStatusV1;
  receiptIntegrityStatus: Phase22RealEvidenceIntakeStatusV1;
  qualificationReadiness: 'not_ready';
  evidenceStatus: 'not_ready';
  candidateSelectionStatus: 'no_candidate_selected';
  candidateQualificationStatus: 'not_run';
  candidateApplicabilityStatus: 'not_assessed_no_candidate_selected';
  selectedMethod: 'diagnostics_only_abstention_v1';
  qualificationEvidenceEligible: false;
  candidateEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  sealedQualificationStatus: 'not_ready';
  sourceBindings: Phase22SealedReadinessSourceBindingsV1;
  blockers: typeof PHASE22_SEALED_READINESS_BLOCKERS_V1;
  readinessSha256: string;
}>;

export type VerifiedPhase22SealedReadinessEnvelopeV1 = Phase22SealedReadinessEnvelopeV1;
export type Phase22SealedReadinessV1 = Phase22SealedReadinessEnvelopeV1;

export type Phase22SealedReadinessEnvelopeBuildResultV1 =
  | Readonly<{
    status: 'verified';
    envelope: VerifiedPhase22SealedReadinessEnvelopeV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker:
      | 'phase22_sealed_readiness_source_unverified'
      | 'phase22_sealed_readiness_binding_mismatch';
  }>;

export type Phase22SealedReadinessBuildResultV1 =
  Phase22SealedReadinessEnvelopeBuildResultV1;
