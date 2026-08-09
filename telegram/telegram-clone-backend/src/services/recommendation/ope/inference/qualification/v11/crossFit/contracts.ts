export const VERIFIED_PHASE21_CLUSTER_AWARE_CROSS_FIT_AUDIT_V1 =
  'verified_phase21_cluster_aware_cross_fit_audit_v1' as const;

export const PHASE21_CROSS_FIT_RESOURCE_LIMITS_V1 = Object.freeze({
  version: 'phase21_cluster_aware_cross_fit_resource_limits_v1',
  maximumRows: 8_192,
  maximumFolds: 32,
  maximumCanonicalInputBytes: 33_554_432,
  maximumWorkUnits: 65_536,
} as const);

export const PHASE21_CROSS_FIT_BLOCKERS_V1 = Object.freeze([
  'real_viewer_cluster_provenance_unavailable',
  'real_time_cluster_provenance_unavailable',
  'real_qhat_cross_fit_provenance_unavailable',
  'multiway_dependence_handling_unavailable',
] as const);

export type Phase21CrossFitBlockerV1 = typeof PHASE21_CROSS_FIT_BLOCKERS_V1[number]
  | 'phase21_cross_fit_source_unverified'
  | 'phase21_cross_fit_binding_mismatch'
  | 'phase21_cross_fit_decision_only_fold_rejected'
  | 'phase21_cross_fit_viewer_time_leakage'
  | 'phase21_cross_fit_resource_limit_exceeded';

export type Phase21CrossFitRowV1 = Readonly<{
  rowId: string;
  decisionId: string;
  viewerClusterId: string;
  timeClusterId: string;
  foldId: number;
  role: 'train' | 'evaluation';
}>;

export type VerifiedPhase21ClusterAwareCrossFitAuditV1 = Readonly<{
  contractVersion: typeof VERIFIED_PHASE21_CLUSTER_AWARE_CROSS_FIT_AUDIT_V1;
  status: 'not_ready';
  assignmentDomain: 'viewer_time_cluster_cross_fit_v1';
  foldCount: number | null;
  viewerHoldoutLeakageExcluded: false;
  timeHoldoutLeakageExcluded: false;
  cellLeakageExcluded: false;
  decisionOnlyFoldRejected: true;
  realViewerTimeProvenancePresent: false;
  qHatCrossFitVerified: false;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  sourceBindings: Readonly<{
    evidenceEnvelopeSha256: string;
    predictionReceiptSha256: string | null;
    foldAssignmentSha256: string | null;
  }>;
  rows: readonly Phase21CrossFitRowV1[];
  blockers: typeof PHASE21_CROSS_FIT_BLOCKERS_V1;
  resourceDiagnostics: Readonly<{
    preflightCompletedBeforeRows: true;
    rows: number;
    folds: number;
    workUnits: number;
    canonicalInputBytes: number;
    candidateCalls: 0;
    inferenceCalls: 0;
  }>;
  auditSha256: string;
}>;

export type Phase21CrossFitBuildResultV1 =
  | Readonly<{
    status: 'verified';
    audit: VerifiedPhase21ClusterAwareCrossFitAuditV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: Phase21CrossFitBlockerV1;
  }>;
