import { SYNTHETIC_CLUSTER_UNIT_VERSION } from '../../../../../decisionContext/contracts';
import type { SyntheticSegmentAssignmentV1 } from '../../../../../decisionContext/syntheticContextV1';
import type { ClusterScoreSummaryV1, ClusterScoreV1 } from '../../../contracts';

export const VERIFIED_PHASE15_SYNTHETIC_CLUSTER_STATISTIC_MAPPING_AUDIT_V1 =
  'verified_phase15_synthetic_cluster_statistic_mapping_audit_v1' as const;

export const PHASE15_CLUSTER_MAPPING_RESOURCE_LIMITS_V1 = Object.freeze({
  maximumSlotContributions: 8_192,
  maximumClusters: 4_096,
  maximumCanonicalContributionBytes: 1_048_576,
  maximumCanonicalInputBytes: 33_554_432,
  maximumMappingWorkUnits: 20_480,
} as const);

export type Phase15ClusterScoreSummaryResultV1 =
  | Readonly<{ status: 'evaluated'; summary: ClusterScoreSummaryV1 }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>;

export type VerifiedPhase15SyntheticClusterStatisticMappingAuditV1 = Readonly<{
  contractVersion: typeof VERIFIED_PHASE15_SYNTHETIC_CLUSTER_STATISTIC_MAPPING_AUDIT_V1;
  estimand: 'mean_reward_per_logged_slot_v1';
  sourceClusterUnitVersion: typeof SYNTHETIC_CLUSTER_UNIT_VERSION;
  mappingStatus: 'verified_synthetic_mapping_only';
  viewerClusterProvenancePresent: false;
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
    verificationReceiptSha256: string;
  }>;
  sourceBindings: Readonly<{
    receiptSha256: string;
    stateBindingSha256: string;
    trajectoryCohortSha256: string;
    outcomeEvidenceRootsSha256: string;
    contextEvidenceRootsSha256: string;
    targetEvidenceRootsSha256: string;
    predictionEvidenceRootsSha256: string;
    contributionHashChainSha256: string;
    aggregateStateSha256: string;
  }>;
  clusterRows: readonly ClusterScoreV1[];
  clusterScoreSummaryResult: Phase15ClusterScoreSummaryResultV1;
  resourceDiagnostics: Readonly<{
    slotContributions: number;
    clusters: number;
    canonicalInputBytes: number;
    mappingWorkUnits: number;
    peakBufferedClusters: number;
  }>;
  mappingSha256: string;
}>;

export type Phase15ClusterMappingBlockerV1 =
  | 'phase15_mapping_source_unverified'
  | 'phase15_mapping_resource_limit_exceeded'
  | 'phase15_mapping_incomplete_cohort'
  | 'phase15_mapping_dr_incomplete'
  | 'phase15_mapping_contribution_invalid'
  | 'phase15_mapping_contribution_chain_mismatch'
  | 'phase15_mapping_prediction_binding_mismatch'
  | 'phase15_mapping_scope_mismatch';

export type Phase15ClusterMappingBuildResultV1 =
  | {
    status: 'verified';
    audit: VerifiedPhase15SyntheticClusterStatisticMappingAuditV1;
  }
  | { status: 'not_evaluable'; blocker: Phase15ClusterMappingBlockerV1 };
