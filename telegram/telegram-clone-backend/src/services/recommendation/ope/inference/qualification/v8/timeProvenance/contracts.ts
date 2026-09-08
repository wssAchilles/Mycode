import { VIEWER_CLUSTER_UNIT_VERSION } from '../../../../../decisionContext/contracts';
import { SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1 } from '../../../../../offlinePrediction/streamingV3';

export const VERIFIED_PHASE18_SYNTHETIC_VIEWER_TIME_PROVENANCE_V1 =
  'verified_phase18_synthetic_viewer_time_provenance_v1' as const;
export const PHASE18_SYNTHETIC_TIME_SOURCE_VERSION_V1 =
  'phase16_fixed_crossed_viewer_time_fixture_v1' as const;
export const PHASE18_SYNTHETIC_TIME_CLUSTER_UNIT_VERSION_V1 =
  'synthetic_phase16_fixed_time_cell_v1' as const;

export const PHASE18_TIME_PROVENANCE_RESOURCE_LIMITS_V1 = Object.freeze({
  maximumDecisions: SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.maximumDecisions,
  maximumViewerClusters:
    SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.maximumViewerClusters,
  maximumTimeClusters: SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.maximumDecisions,
  maximumSlots: SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.maximumSlots,
  maximumCanonicalInputBytes:
    SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.maximumUpstreamCombinedSpoolBytes,
  maximumMembershipWorkUnits:
    SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.maximumSlots
    + SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.maximumDecisions,
} as const);

export type Phase18SyntheticViewerTimeMembershipV1 = Readonly<{
  decisionId: string;
  requestId: string;
  viewerClusterId: string;
  viewerFoldId: 0 | 1;
  timeClusterId: string;
  servedPositions: readonly number[];
  joinedStepSha256s: readonly string[];
}>;

export type VerifiedPhase18SyntheticViewerTimeProvenanceV1 = Readonly<{
  contractVersion: typeof VERIFIED_PHASE18_SYNTHETIC_VIEWER_TIME_PROVENANCE_V1;
  estimand: 'mean_reward_per_logged_slot_v1';
  sourceClusterUnitVersion: typeof VIEWER_CLUSTER_UNIT_VERSION;
  timeClusterUnitVersion: typeof PHASE18_SYNTHETIC_TIME_CLUSTER_UNIT_VERSION_V1;
  syntheticSourceVersion: typeof PHASE18_SYNTHETIC_TIME_SOURCE_VERSION_V1;
  provenanceStatus: 'verified_synthetic_fixture_only';
  syntheticTimeMembershipStatus: 'verified_synthetic_partition_only';
  syntheticViewerTimeMembershipPresent: true;
  completeCrossedGrid: true;
  commonTimeShockHandlingVerified: false;
  realMultiwayClusterProvenancePresent: false;
  multiwayTrainingEvidencePresent: false;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  viewerClusterIds: readonly string[];
  timeClusterIds: readonly string[];
  memberships: readonly Phase18SyntheticViewerTimeMembershipV1[];
  sourceBindings: Readonly<{
    phase17HandoffSha256: string;
    phase17MappingSha256: string;
    trajectoryEvidenceSha256: string;
    opeReceiptSha256: string;
    predictionSetVersion: string;
    predictionVerificationReceiptSha256: string;
    holdoutPlanSha256: string;
    modelBundleSha256: string;
    predictionStreamSha256: string;
    decisionContextEvidenceSha256: string;
    syntheticDecisionLogRootSha256: string;
    syntheticOutcomeEvidenceRootSha256: string;
  }>;
  resourceDiagnostics: Readonly<{
    preflightCompletedBeforeMembershipScan: true;
    decisions: number;
    slots: number;
    viewerClusters: number;
    timeClusters: number;
    canonicalInputBytes: number;
    membershipWorkUnits: number;
  }>;
  provenanceSha256: string;
}>;

export type Phase18TimeProvenanceBlockerV1 =
  | 'phase18_time_provenance_source_unverified'
  | 'phase18_time_provenance_binding_mismatch'
  | 'phase18_time_provenance_source_not_frozen'
  | 'phase18_time_provenance_fixture_mismatch'
  | 'phase18_time_provenance_incomplete'
  | 'phase18_time_provenance_resource_limit_exceeded';

export type Phase18TimeProvenanceBuildResultV1 =
  | Readonly<{
    status: 'verified';
    provenance: VerifiedPhase18SyntheticViewerTimeProvenanceV1;
  }>
  | Readonly<{
    status: 'not_ready';
    blocker: 'phase18_time_provenance_source_not_frozen';
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: Exclude<
      Phase18TimeProvenanceBlockerV1,
      'phase18_time_provenance_source_not_frozen'
    >;
  }>;
