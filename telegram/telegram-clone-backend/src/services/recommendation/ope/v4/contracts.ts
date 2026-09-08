import { VIEWER_CLUSTER_UNIT_VERSION } from '../../decisionContext/contracts';
import type { SyntheticSegmentAssignmentV1 } from '../../decisionContext/syntheticContextV1';
import { PREDICTION_V3_RESOURCE_LIMITS } from '../../offlinePrediction/predictionV3/contracts';
import { OPE_V3_ESTIMAND } from '../v3/contracts';

export const OPE_V4_ESTIMAND = OPE_V3_ESTIMAND;
export const OPE_V4_RESOURCE_LIMITS_VERSION = 'ope_v4_resource_limits_v1' as const;
export const OPE_V4_RESOURCE_LIMITS = Object.freeze({
  maximumDecisions: PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions,
  maximumViewerClusters: PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters,
  maximumSlots: PREDICTION_V3_RESOURCE_LIMITS.maximumSlots,
  maximumSupportActionRows: PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows,
  maximumCanonicalStepBytes: 1_048_576,
  maximumCanonicalInputBytes: PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolBytes,
  maximumOpeWorkUnits: PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows
    + 2 * PREDICTION_V3_RESOURCE_LIMITS.maximumSlots
    + PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions
    + PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters,
} as const);

export type OpeSlotContributionV4 = Readonly<{
  contractVersion: 'ope_v4_slot_contribution_v1';
  estimand: typeof OPE_V4_ESTIMAND;
  stateBindingSha256: string;
  priorContributionSha256: string;
  contributionSha256: string;
  decisionId: string;
  requestId: string;
  servedPosition: number;
  prefixLogWeight: number;
  logWeight: number;
  prefixWeight: number;
  weight: number;
  behaviorProbability: number;
  targetProbability: number;
  reward: number;
  ipsContribution: number;
  drContribution: number;
  binding: Readonly<{
    datasetVersion: string;
    inferenceClusterId: string;
    clusterUnitVersion: typeof VIEWER_CLUSTER_UNIT_VERSION;
    viewerAccountPseudonym: string;
    foldId: 0 | 1;
    segmentAssignments: readonly SyntheticSegmentAssignmentV1[];
    objective: string;
    sourceDecisionLogSha256: string;
    sourceCandidatePoolSha256: string;
    syntheticDecisionLogSha256: string;
    syntheticOutcomeEvidenceSha256: string;
    decisionContextEvidenceSha256: string;
    snapshotManifestSha256: string;
    targetManifestSha256: string;
    targetVerificationReceiptSha256: string;
    holdoutPlanSha256: string;
    predictionSetVersion: string;
    predictionVerificationReceiptSha256: string;
  }>;
}>;

export type VerifiedOpeAggregateReceiptV4 = Readonly<{
  contractVersion: 'verified_ope_v4_aggregate_receipt_v1';
  estimand: typeof OPE_V4_ESTIMAND;
  resourceLimitsVersion: typeof OPE_V4_RESOURCE_LIMITS_VERSION;
  resourceConfigSha256: string;
  stateBindingSha256: string;
  trajectoryEvidenceSha256: string;
  predictionSetVersion: string;
  predictionVerificationReceiptSha256: string;
  modelBundleSha256: string;
  predictionStreamSha256: string;
  snapshotManifestSha256: string;
  targetManifestSha256: string;
  targetVerificationReceiptSha256: string;
  targetDistributionNdjsonSha256: string;
  decisionContextEvidenceSha256: string;
  syntheticDecisionLogRootSha256: string;
  syntheticOutcomeEvidenceRootSha256: string;
  holdoutPlanSha256: string;
  rewardDefinitionSha256: string;
  sourceClusterUnitVersion: typeof VIEWER_CLUSTER_UNIT_VERSION;
  contributionHashChainSha256: string;
  aggregateStateSha256: string;
  expectedDecisionCount: number;
  observedDecisionCount: number;
  expectedViewerClusterCount: number;
  observedViewerClusterCount: number;
  expectedSlotCount: number;
  observedSlotCount: number;
  drSlotCount: number;
  viewerClusterCrossFitProvenancePresent: true;
  commonTimeShockHandlingVerified: false;
  multiwayClusterProvenancePresent: false;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  resourceDiagnostics: Readonly<{
    preflightCompletedBeforeReplay: true;
    decisions: number;
    viewerClusters: number;
    slots: number;
    supportActionRows: number;
    sourceCombinedSpoolBytes: number;
    evidenceCanonicalBytes: number;
    contributionCanonicalBytes: number;
    maximumCanonicalStepBytes: number;
    aggregateStateEntries: number;
    opeWorkUnits: number;
  }>;
  receiptSha256: string;
}>;

export type EvaluateSyntheticCohortOpeResultV4 =
  | Readonly<{
    status: 'verified';
    contributions: readonly OpeSlotContributionV4[];
    receipt: VerifiedOpeAggregateReceiptV4;
  }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>;
