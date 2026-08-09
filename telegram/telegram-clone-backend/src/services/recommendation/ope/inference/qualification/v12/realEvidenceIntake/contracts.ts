export const PHASE22_REAL_EVIDENCE_INTAKE_V1 =
  'phase22_real_evidence_intake_v1' as const;

export type Phase22RealEvidenceIntakeStatusV1 = 'not_ready';

export const PHASE22_REAL_EVIDENCE_ESTIMAND_V1 =
  'mean_reward_per_logged_slot_v1' as const;

export const PHASE22_REAL_EVIDENCE_RESOURCE_LIMITS_V1 = Object.freeze({
  version: 'phase22_real_evidence_resource_limits_v1',
  maximumRecords: 8_192,
  maximumSourceBytes: 33_554_432,
  maximumCanonicalInputBytes: 33_554_432,
  maximumWorkUnits: 65_536,
} as const);

// These are evidence gaps, not method applicability conclusions.
export const PHASE22_REAL_EVIDENCE_GAPS_V1 = Object.freeze([
  'real_viewer_cluster_provenance_unavailable',
  'real_time_cluster_provenance_unavailable',
  'real_viewer_time_cell_membership_unavailable',
  'real_full_support_evidence_unavailable',
  'real_randomized_propensity_evidence_unavailable',
  'real_propensity_bounds_unavailable',
  'real_reward_or_weight_bounds_unavailable',
  'real_qhat_cross_fit_provenance_unavailable',
  'sequential_stopping_rule_unavailable',
  'multiway_dependence_handling_unavailable',
] as const);

export type Phase22RealEvidenceGapV1 = typeof PHASE22_REAL_EVIDENCE_GAPS_V1[number];

export const PHASE22_REAL_EVIDENCE_INTAKE_BLOCKERS_V1 = Object.freeze([
  'real_evidence_source_unavailable',
  ...PHASE22_REAL_EVIDENCE_GAPS_V1,
] as const);

export type Phase22RealEvidenceIntakeBlockerV1 =
  | 'phase22_intake_source_unverified'
  | 'phase22_intake_binding_mismatch'
  | 'phase22_intake_resource_limit_exceeded'
  | 'real_evidence_source_unavailable'
  | Phase22RealEvidenceGapV1;

export type Phase22RealEvidenceSourceBindingsV1 = Readonly<{
  phase21HandoffSha256: string;
  phase21EvidenceEnvelopeSha256: string;
  phase21AssessmentSha256: string;
  phase21CrossFitAuditSha256: string;
  pitSnapshotSha256: null;
  decisionContextSha256: null;
  targetEvidenceSha256: null;
  outcomeEvidenceSha256: null;
  opeReceiptSha256: null;
  predictionReceiptSha256: null;
  viewerTimeMembershipSha256: null;
  crossFitReceiptSha256: null;
  realEvidenceReceiptSha256: null;
}>;

export type Phase22RealEvidenceCountsV1 = Readonly<{
  records: 0;
  viewers: 0;
  times: 0;
  cells: 0;
}>;

export type Phase22RealEvidenceBytesV1 = Readonly<{
  source: 0;
  canonicalInput: number;
}>;

export type Phase22RealEvidenceSupportV1 = Readonly<{
  fullSupportVerified: false;
  randomizedPropensityVerified: false;
  minimumBehaviorPropensity: null;
  maximumPrefixWeight: null;
}>;

export type Phase22RealEvidenceBoundsV1 = Readonly<{
  rewardMinimum: null;
  rewardMaximum: null;
  weightMaximum: null;
  qHatMinimum: null;
  qHatMaximum: null;
}>;

export type Phase22RealEvidenceCrossFitV1 = Readonly<{
  viewerTimeCellLeakageExcluded: false;
  qHatCrossFitVerified: false;
  foldAssignmentSha256: null;
}>;

export type Phase22RealEvidenceStoppingRuleV1 = Readonly<{
  verified: false;
  ruleVersion: null;
}>;

export type Phase22RealEvidenceResourceDiagnosticsV1 = Readonly<{
  preflightCompletedBeforeSourceScan: true;
  records: 0;
  sourceBytes: 0;
  canonicalInputBytes: number;
  workUnits: 0;
  candidateCalls: 0;
  inferenceCalls: 0;
  publicationCalls: 0;
}>;

export type VerifiedPhase22RealEvidenceIntakeV1 = Readonly<{
  contractVersion: typeof PHASE22_REAL_EVIDENCE_INTAKE_V1;
  intakeKind: 'real_evidence_intake_v1';
  status: 'not_ready';
  intakeStatus: 'not_ready';
  sourceStatus: 'unavailable';
  receiptIntegrityStatus: 'not_ready';
  evidenceStatus: 'not_ready';
  qualificationReadiness: 'not_ready';
  sealedQualificationStatus: 'not_ready';
  estimand: typeof PHASE22_REAL_EVIDENCE_ESTIMAND_V1;
  datasetVersion: null;
  sourceRoots: null;
  sourceBindings: Phase22RealEvidenceSourceBindingsV1;
  recordCount: 0;
  byteCount: 0;
  sealedAt: null;
  maxObservationAt: null;
  clusterUnitVersion: null;
  timeClusterUnitVersion: null;
  cellUnitVersion: null;
  viewerTimeCellMembershipPresent: false;
  viewerClusterProvenancePresent: false;
  timeClusterProvenancePresent: false;
  realMultiwayClusterProvenancePresent: false;
  counts: Phase22RealEvidenceCountsV1;
  bytes: Phase22RealEvidenceBytesV1;
  support: Phase22RealEvidenceSupportV1;
  bounds: Phase22RealEvidenceBoundsV1;
  crossFit: Phase22RealEvidenceCrossFitV1;
  stoppingRule: Phase22RealEvidenceStoppingRuleV1;
  evidenceGaps: readonly Phase22RealEvidenceGapV1[];
  blockers: readonly Phase22RealEvidenceIntakeBlockerV1[];
  candidateSelectionStatus: 'no_candidate_selected';
  candidateQualificationStatus: 'not_run';
  candidateApplicabilityStatus: 'not_assessed_no_candidate_selected';
  selectedMethod: 'diagnostics_only_abstention_v1';
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  resourceDiagnostics: Phase22RealEvidenceResourceDiagnosticsV1;
  intakeSha256: string;
}>;

export type Phase22RealEvidenceIntakeV1 = VerifiedPhase22RealEvidenceIntakeV1;

export type Phase22RealEvidenceIntakeBuildResultV1 =
  | Readonly<{ status: 'verified'; intake: VerifiedPhase22RealEvidenceIntakeV1 }>
  | Readonly<{ status: 'not_evaluable'; blocker: Phase22RealEvidenceIntakeBlockerV1 }>;
