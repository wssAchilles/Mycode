import type {
  VerifiedPhase18SyntheticViewerTimeProvenanceV1,
} from '../timeProvenance';

export const VERIFIED_PHASE18_MULTIWAY_HOLDOUT_PLAN_AUDIT_V1 =
  'verified_phase18_multiway_holdout_plan_audit_v1' as const;
export const PHASE18_VIEWER_MEMBERSHIP_DIGEST_DOMAIN_V1 =
  'phase18_viewer_membership_digest_v1' as const;
export const PHASE18_TIME_MEMBERSHIP_DIGEST_DOMAIN_V1 =
  'phase18_time_membership_digest_v1' as const;
export const PHASE18_MULTIWAY_CELL_DIGEST_DOMAIN_V1 =
  'phase18_multiway_cell_digest_v1' as const;

export const PHASE18_MULTIWAY_HOLDOUT_RESOURCE_LIMITS_V1 = Object.freeze({
  maximumDecisions: 64,
  maximumViewerClusters: 64,
  maximumTimeClusters: 64,
  maximumEvaluationCells: 4_096,
  maximumCanonicalInputBytes: 33_554_432,
  maximumPlanWorkUnits: 20_480,
} as const);

export type Phase18MultiwayHoldoutCellV1 = Readonly<{
  viewerClusterId: string;
  timeClusterId: string;
  evaluationDecisionIds: readonly string[];
  trainingDecisionIds: readonly string[];
  guardBandDecisionIds: readonly string[];
  excludedDecisionIds: readonly string[];
  evaluationDecisionSetSha256: string;
  trainingDecisionSetSha256: string;
  guardBandDecisionSetSha256: string;
  excludedDecisionSetSha256: string;
  cellSha256: string;
}>;

export type VerifiedPhase18MultiwayHoldoutPlanAuditV1 = Readonly<{
  contractVersion: typeof VERIFIED_PHASE18_MULTIWAY_HOLDOUT_PLAN_AUDIT_V1;
  estimand: VerifiedPhase18SyntheticViewerTimeProvenanceV1['estimand'];
  sourceClusterUnitVersion:
    VerifiedPhase18SyntheticViewerTimeProvenanceV1['sourceClusterUnitVersion'];
  timeClusterUnitVersion:
    VerifiedPhase18SyntheticViewerTimeProvenanceV1['timeClusterUnitVersion'];
  auditStatus: 'verified_plan_only';
  unionExclusionVerified: true;
  sameViewerLeakageExcludedInPlan: true;
  sameTimeLeakageExcludedInPlan: true;
  trainingApplied: false;
  multiwayQHatProvenanceStatus: 'plan_only_not_verified';
  dgpV2LaunchReadiness: 'not_ready';
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  provenanceSha256: string;
  phase17HandoffSha256: string;
  phase17MappingSha256: string;
  predictionVerificationReceiptSha256: string;
  viewerMembershipSha256: string;
  timeMembershipSha256: string;
  cells: readonly Phase18MultiwayHoldoutCellV1[];
  resourceDiagnostics: Readonly<{
    preflightCompletedBeforeCellEnumeration: true;
    decisions: number;
    viewerClusters: number;
    timeClusters: number;
    evaluationCells: number;
    canonicalInputBytes: number;
    planWorkUnits: number;
  }>;
  planSha256: string;
}>;

export type Phase18MultiwayHoldoutBlockerV1 =
  | 'phase18_multiway_holdout_source_unverified'
  | 'phase18_multiway_holdout_binding_mismatch'
  | 'phase18_multiway_holdout_union_exclusion_invalid'
  | 'phase18_multiway_holdout_resource_limit_exceeded';

export type Phase18MultiwayHoldoutBuildResultV1 =
  | Readonly<{
    status: 'verified';
    audit: VerifiedPhase18MultiwayHoldoutPlanAuditV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: Phase18MultiwayHoldoutBlockerV1;
  }>;
