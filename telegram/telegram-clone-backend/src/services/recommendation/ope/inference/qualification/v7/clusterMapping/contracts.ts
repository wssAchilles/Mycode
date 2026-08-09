import { VIEWER_CLUSTER_UNIT_VERSION } from '../../../../../decisionContext/contracts';
import type { SyntheticSegmentAssignmentV1 } from '../../../../../decisionContext/syntheticContextV1';
import { OPE_V4_RESOURCE_LIMITS } from '../../../../v4';
import type { ClusterScoreSummaryV1, ClusterScoreV1 } from '../../../contracts';

export const VERIFIED_PHASE17_SYNTHETIC_VIEWER_CLUSTER_MAPPING_AUDIT_V1 =
  'verified_phase17_synthetic_viewer_cluster_mapping_audit_v1' as const;

export const PHASE17_CLUSTER_MAPPING_RESOURCE_LIMITS_V1 = Object.freeze({
  maximumSlotContributions: OPE_V4_RESOURCE_LIMITS.maximumSlots,
  maximumClusters: OPE_V4_RESOURCE_LIMITS.maximumViewerClusters,
  maximumCanonicalContributionBytes: OPE_V4_RESOURCE_LIMITS.maximumCanonicalStepBytes,
  maximumCanonicalInputBytes: OPE_V4_RESOURCE_LIMITS.maximumCanonicalInputBytes,
  maximumMappingWorkUnits: 2 * OPE_V4_RESOURCE_LIMITS.maximumSlots
    + OPE_V4_RESOURCE_LIMITS.maximumViewerClusters,
} as const);

export type Phase17ClusterScoreSummaryResultV1 =
  | Readonly<{ status: 'evaluated'; summary: ClusterScoreSummaryV1 }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>;

export type VerifiedPhase17SyntheticViewerClusterMappingAuditV1 = Readonly<{
  contractVersion: typeof VERIFIED_PHASE17_SYNTHETIC_VIEWER_CLUSTER_MAPPING_AUDIT_V1;
  estimand: 'mean_reward_per_logged_slot_v1';
  sourceClusterUnitVersion: typeof VIEWER_CLUSTER_UNIT_VERSION;
  mappingStatus: 'verified_synthetic_viewer_cluster_mapping_only';
  viewerClusterCrossFitProvenancePresent: true;
  independentViewerClustersVerified: false;
  commonTimeShockHandlingVerified: false;
  multiwayClusterProvenancePresent: false;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  scope: Readonly<{
    objective: string;
    segmentAssignments: readonly SyntheticSegmentAssignmentV1[];
    scopeSha256: string;
  }>;
  predictionBinding: Readonly<{
    predictionSetVersion: string;
    predictionVerificationReceiptSha256: string;
    holdoutPlanSha256: string;
  }>;
  sourceBindings: Readonly<{
    receiptSha256: string;
    stateBindingSha256: string;
    trajectoryEvidenceSha256: string;
    modelBundleSha256: string;
    predictionStreamSha256: string;
    snapshotManifestSha256: string;
    targetManifestSha256: string;
    targetVerificationReceiptSha256: string;
    targetDistributionNdjsonSha256: string;
    decisionContextEvidenceSha256: string;
    syntheticDecisionLogRootSha256: string;
    syntheticOutcomeEvidenceRootSha256: string;
    contributionHashChainSha256: string;
    aggregateStateSha256: string;
  }>;
  clusterRows: readonly ClusterScoreV1[];
  clusterScoreSummaryResult: Phase17ClusterScoreSummaryResultV1;
  resourceDiagnostics: Readonly<{
    slotContributions: number;
    clusters: number;
    canonicalInputBytes: number;
    mappingWorkUnits: number;
    peakBufferedClusters: number;
  }>;
  mappingSha256: string;
}>;

export type Phase17ClusterMappingBlockerV1 =
  | 'phase17_mapping_source_unverified'
  | 'phase17_mapping_resource_limit_exceeded'
  | 'phase17_mapping_incomplete_cohort'
  | 'phase17_mapping_dr_incomplete'
  | 'phase17_mapping_contribution_invalid'
  | 'phase17_mapping_contribution_chain_mismatch'
  | 'phase17_mapping_prediction_binding_mismatch'
  | 'phase17_mapping_scope_mismatch';

export type Phase17ClusterMappingBuildResultV1 =
  | Readonly<{
    status: 'verified';
    audit: VerifiedPhase17SyntheticViewerClusterMappingAuditV1;
  }>
  | Readonly<{ status: 'not_evaluable'; blocker: Phase17ClusterMappingBlockerV1 }>;
