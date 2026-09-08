import type { SyntheticSegmentAssignmentV1 } from '../../decisionContext/syntheticContextV1';
import { VIEWER_CLUSTER_UNIT_VERSION } from '../../decisionContext/contracts';
import {
  PREDICTION_V3_RESOURCE_LIMITS,
  type VerifiedCrossFittedCohortPredictionSetV3,
} from '../predictionV3/contracts';
import type { SyntheticDecisionLogV1 } from '../streamingV2/contracts';

type ActionKey = SyntheticDecisionLogV1['actions'][number]['actionKey'];

export const SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1 = Object.freeze({
  version: 'synthetic_cohort_trajectory_resource_limits_v1' as const,
  maximumDecisions: PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions,
  maximumViewerClusters: PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters,
  maximumSlots: PREDICTION_V3_RESOURCE_LIMITS.maximumSlots,
  maximumSupportActionRows: PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows,
  maximumPredictionRecords: PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolRecords,
  maximumUpstreamCombinedSpoolBytes: PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolBytes,
  maximumBufferedStepBytes: 1_048_576,
  maximumJoinWorkUnits: 20_480,
} as const);

export type VerifiedSyntheticCohortTrajectoryStepV1 = Readonly<{
  contractVersion: 'verified_synthetic_cohort_trajectory_step_v1';
  predictionSetVersion: string;
  predictionVerificationReceiptSha256: string;
  decisionId: string;
  requestId: string;
  servedPosition: number;
  prefixActionKeys: readonly ActionKey[];
  loggedActionKey: ActionKey;
  behaviorProbability: number;
  behaviorSupportActions: readonly ActionKey[];
  targetDistribution: readonly Readonly<{
    actionKey: ActionKey;
    probability: number;
  }>[];
  reward: number;
  qHat: readonly Readonly<{
    actionKey: ActionKey;
    value: number;
  }>[];
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
  }>;
}>;

export type SyntheticCohortTrajectoryStepSummaryV1 = Readonly<{
  decisionId: string;
  requestId: string;
  inferenceClusterId: string;
  foldId: 0 | 1;
  servedPosition: number;
  joinedStepSha256: string;
}>;

export type SyntheticCohortTrajectoryResourceDiagnosticsV1 = Readonly<{
  preflightCompletedBeforeCursor: true;
  decisionCount: number;
  viewerClusterCount: number;
  slotCount: number;
  supportActionRowCount: number;
  predictionPhysicalRecordCount: number;
  upstreamCombinedSpoolByteCount: number;
  joinWorkUnits: number;
  peakBufferedActions: number;
  peakBufferedRecords: number;
  peakBufferedBytes: number;
}>;

export type VerifiedSyntheticCohortTrajectoryEvidenceV1 = Readonly<{
  contractVersion: 'verified_synthetic_cohort_trajectory_evidence_v1';
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
  expectedDecisionCount: number;
  expectedViewerClusterCount: number;
  expectedStepCount: number;
  expectedPredictionCount: number;
  steps: readonly SyntheticCohortTrajectoryStepSummaryV1[];
  resourceLimitsVersion: typeof SYNTHETIC_COHORT_TRAJECTORY_RESOURCE_LIMITS_V1.version;
  resourceDiagnostics: SyntheticCohortTrajectoryResourceDiagnosticsV1;
  sourceClusterUnitVersion: typeof VIEWER_CLUSTER_UNIT_VERSION;
  viewerClusterCrossFitProvenancePresent: true;
  commonTimeShockHandlingVerified: false;
  multiwayClusterProvenancePresent: false;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
}>;

export type VerifySyntheticCohortTrajectoryEvidenceResultV1 =
  | Readonly<{ status: 'verified'; evidence: VerifiedSyntheticCohortTrajectoryEvidenceV1 }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>;

export type SyntheticCohortTrajectoryReplayVisitorV1 = Readonly<{
  onStep: (step: VerifiedSyntheticCohortTrajectoryStepV1) => Promise<void> | void;
  commit: () => Promise<void> | void;
  abort: (blocker: string) => Promise<void> | void;
}>;

export type SyntheticCohortTrajectoryReplayBindingV1 = Readonly<{
  predictionSet: VerifiedCrossFittedCohortPredictionSetV3;
}>;
