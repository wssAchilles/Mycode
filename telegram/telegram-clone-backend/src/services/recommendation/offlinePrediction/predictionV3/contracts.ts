import { z } from 'zod';

import {
  VIEWER_CLUSTER_UNIT_VERSION,
} from '../../decisionContext/contracts';
import type { VerifiedDecisionContextEvidenceV1 } from '../../decisionContext/verify';
import { decisionActionKeySchema } from '../../decisionLog/contracts';
import type { VerifiedSyntheticOutcomeEvidenceV1 } from '../../outcomes/syntheticOutcomeEvidenceV1';
import type { OfflineRewardDefinitionV1 } from '../contracts/artifacts';
import {
  OFFLINE_REWARD_HEADS_V1,
  offlinePrimitivePredictionsSchema,
} from '../contracts/reward';
import type { VerifiedFullSupportPitActionSnapshotV2 } from '../snapshotV2';
import type { SyntheticDecisionLogV1 } from '../streamingV2/contracts';
import type {
  ByteStreamFactoryV2,
  VerifiedTargetDistributionEvidenceV2,
} from '../targetEvidence';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().trim().min(1).max(512);
const finite = z.number().finite();
const foldId = z.union([z.literal(0), z.literal(1)]);
const coefficientSchema = z.object({ feature: nonEmpty, value: finite }).strict();

export const PREDICTION_V3_FOLD_ASSIGNMENT_VERSION =
  'inference_cluster_sha256_mod_k_v1' as const;
export const PREDICTION_V3_FOLD_ASSIGNMENT_DOMAIN =
  'viewer_cluster_holdout_plan_v1' as const;
export const VIEWER_CLUSTER_HOLDOUT_PLAN_V1 = 'viewer_cluster_holdout_plan_v1' as const;
export const VIEWER_CLUSTER_FOLD_ASSIGNMENT_V1 =
  PREDICTION_V3_FOLD_ASSIGNMENT_VERSION;
export const VIEWER_CLUSTER_HOLDOUT_DOMAIN_V1 =
  PREDICTION_V3_FOLD_ASSIGNMENT_DOMAIN;
export const PREDICTION_V3_FOLD_COUNT = 2 as const;
export const PREDICTION_V3_ROW_ORDER =
  'canonical_decision_id_then_served_position_then_action_identity_v1' as const;
export const PREDICTION_V3_RESOURCE_LIMITS_VERSION =
  'cohort_prediction_resource_limits_v1' as const;
export const PREDICTION_V3_RUNTIME_CONFIG_VERSION =
  'cohort_prediction_runtime_config_v1' as const;
export const PREDICTION_V3_WORK_MODEL_VERSION =
  'cohort_prediction_producer_verifier_work_model_v1' as const;

export const PREDICTION_V3_RESOURCE_LIMITS = Object.freeze({
  maximumDecisions: 64,
  minimumViewerClusters: 2,
  maximumViewerClusters: 64,
  maximumSlots: 256,
  maximumSupportActionRows: 4_096,
  maximumCandidateBaseRows: 4_096,
  maximumFeaturesPerFold: 128,
  maximumCombinedSpoolRecords: 16_384,
  maximumCombinedSpoolBytes: 33_554_432,
  maximumLineBytes: 65_536,
  maximumProducerAndVerifierMathWorkUnits: 16_777_216,
} as const);

export const PREDICTION_V3_RUNTIME_CONFIG = Object.freeze({
  contractVersion: PREDICTION_V3_RUNTIME_CONFIG_VERSION,
  foldAssignmentVersion: PREDICTION_V3_FOLD_ASSIGNMENT_VERSION,
  foldAssignmentDomain: PREDICTION_V3_FOLD_ASSIGNMENT_DOMAIN,
  foldCount: PREDICTION_V3_FOLD_COUNT,
  epochs: 3,
  headOrder: OFFLINE_REWARD_HEADS_V1,
  learningRate: 0.1,
  l2Lambda: 0.01,
  auxiliaryRowCount: 0,
} as const);

export const cohortPredictionRuntimeConfigV3Schema = z.object({
  contractVersion: z.literal(PREDICTION_V3_RUNTIME_CONFIG_VERSION),
  foldAssignmentVersion: z.literal(PREDICTION_V3_FOLD_ASSIGNMENT_VERSION),
  foldAssignmentDomain: z.literal(PREDICTION_V3_FOLD_ASSIGNMENT_DOMAIN),
  foldCount: z.literal(PREDICTION_V3_FOLD_COUNT),
  epochs: z.literal(3),
  headOrder: z.tuple(OFFLINE_REWARD_HEADS_V1.map((head) => z.literal(head)) as [
    z.ZodLiteral<'click'>,
    z.ZodLiteral<'like'>,
    z.ZodLiteral<'reply'>,
    z.ZodLiteral<'repost'>,
    z.ZodLiteral<'quote'>,
    z.ZodLiteral<'share'>,
    z.ZodLiteral<'dismiss'>,
    z.ZodLiteral<'blockAuthor'>,
    z.ZodLiteral<'report'>,
    z.ZodLiteral<'dwell'>,
  ]),
  learningRate: z.literal(0.1),
  l2Lambda: z.literal(0.01),
  auxiliaryRowCount: z.literal(0),
}).strict();

export const cohortPredictionResourceLimitsV3Schema = z.object({
  limitsVersion: z.literal(PREDICTION_V3_RESOURCE_LIMITS_VERSION),
  maximumDecisions: z.literal(PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions),
  minimumViewerClusters: z.literal(PREDICTION_V3_RESOURCE_LIMITS.minimumViewerClusters),
  maximumViewerClusters: z.literal(PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters),
  maximumSlots: z.literal(PREDICTION_V3_RESOURCE_LIMITS.maximumSlots),
  maximumSupportActionRows: z.literal(PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows),
  maximumCandidateBaseRows: z.literal(PREDICTION_V3_RESOURCE_LIMITS.maximumCandidateBaseRows),
  maximumFeaturesPerFold: z.literal(PREDICTION_V3_RESOURCE_LIMITS.maximumFeaturesPerFold),
  maximumCombinedSpoolRecords: z.literal(
    PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolRecords,
  ),
  maximumCombinedSpoolBytes: z.literal(
    PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolBytes,
  ),
  maximumLineBytes: z.literal(PREDICTION_V3_RESOURCE_LIMITS.maximumLineBytes),
  maximumProducerAndVerifierMathWorkUnits: z.literal(
    PREDICTION_V3_RESOURCE_LIMITS.maximumProducerAndVerifierMathWorkUnits,
  ),
}).strict();

export const viewerClusterHoldoutAssignmentV1Schema = z.object({
  inferenceClusterId: nonEmpty,
  foldId,
  decisionIds: z.array(z.string().uuid()).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions),
}).strict();

export const viewerClusterHoldoutFoldV1Schema = z.object({
  foldId,
  trainingInferenceClusterIds: z.array(nonEmpty).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters),
  holdoutInferenceClusterIds: z.array(nonEmpty).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters),
  trainingDecisionIds: z.array(z.string().uuid()).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions),
  holdoutDecisionIds: z.array(z.string().uuid()).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions),
  trainingClusterSetSha256: sha256,
  holdoutClusterSetSha256: sha256,
  trainingDecisionSetSha256: sha256,
  holdoutDecisionSetSha256: sha256,
}).strict();

export const viewerClusterHoldoutPlanV1Schema = z.object({
  contractVersion: z.literal(VIEWER_CLUSTER_HOLDOUT_PLAN_V1),
  datasetVersion: nonEmpty,
  decisionContextEvidenceSha256: sha256,
  assignmentVersion: z.literal(VIEWER_CLUSTER_FOLD_ASSIGNMENT_V1),
  assignmentDomain: z.literal(VIEWER_CLUSTER_HOLDOUT_DOMAIN_V1),
  foldCount: z.literal(PREDICTION_V3_FOLD_COUNT),
  decisionCount: z.number().int().min(1).max(PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions),
  viewerClusterCount: z.number().int()
    .min(PREDICTION_V3_RESOURCE_LIMITS.minimumViewerClusters)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters),
  assignments: z.array(viewerClusterHoldoutAssignmentV1Schema)
    .min(PREDICTION_V3_RESOURCE_LIMITS.minimumViewerClusters)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters),
  folds: z.array(viewerClusterHoldoutFoldV1Schema).length(PREDICTION_V3_FOLD_COUNT),
  sameViewerLeakageExcluded: z.literal(true),
  qualificationEvidenceEligible: z.literal(false),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
  holdoutPlanSha256: sha256,
}).strict();

const foldModelV3Schema = z.object({
  foldId,
  trainingInferenceClusterIds: z.array(nonEmpty).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters),
  holdoutInferenceClusterIds: z.array(nonEmpty).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters),
  trainingDecisionIds: z.array(z.string().uuid()).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions),
  holdoutDecisionIds: z.array(z.string().uuid()).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions),
  trainingRowKeys: z.array(nonEmpty).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSlots),
  holdoutRowKeys: z.array(nonEmpty).min(1)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSlots),
  featureKeys: z.array(nonEmpty).max(PREDICTION_V3_RESOURCE_LIMITS.maximumFeaturesPerFold),
  heads: z.array(z.object({
    head: z.enum(OFFLINE_REWARD_HEADS_V1),
    intercept: finite,
    coefficients: z.array(coefficientSchema)
      .max(PREDICTION_V3_RESOURCE_LIMITS.maximumFeaturesPerFold),
  }).strict()).length(OFFLINE_REWARD_HEADS_V1.length),
  foldModelSha256: sha256,
}).strict();

export const crossFittedCohortModelBundleV3Schema = z.object({
  contractVersion: z.literal('cross_fitted_cohort_model_bundle_v3'),
  datasetVersion: nonEmpty,
  snapshotManifestSha256: sha256,
  targetManifestSha256: sha256,
  targetVerificationReceiptSha256: sha256,
  decisionContextEvidenceSha256: sha256,
  syntheticDecisionLogRootSha256: sha256,
  syntheticOutcomeEvidenceRootSha256: sha256,
  holdoutPlanSha256: sha256,
  trainingSpoolSha256: sha256,
  trainingConfigSha256: sha256,
  resourceLimitsVersion: z.literal(PREDICTION_V3_RESOURCE_LIMITS_VERSION),
  resourceLimitsSha256: sha256,
  runtimeConfigVersion: z.literal(PREDICTION_V3_RUNTIME_CONFIG_VERSION),
  runtimeConfigSha256: sha256,
  rowOrder: z.literal(PREDICTION_V3_ROW_ORDER),
  rewardDefinitionSha256: sha256,
  foldCount: z.literal(PREDICTION_V3_FOLD_COUNT),
  auxiliaryRowCount: z.literal(0),
  folds: z.array(foldModelV3Schema).length(2),
  crossFitted: z.literal(true),
  sameViewerLeakageExcluded: z.literal(true),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
  modelBundleSha256: sha256,
}).strict();

export const cohortPredictionRecordV3Schema = z.discriminatedUnion('recordType', [
  z.object({
    recordType: z.literal('decision_start'),
    contractVersion: z.literal('cross_fitted_cohort_prediction_stream_v3'),
    decisionId: z.string().uuid(),
    requestId: z.string().uuid(),
    decisionLogSha256: sha256,
    candidatePoolSha256: sha256,
    syntheticDecisionLogSha256: sha256,
    syntheticOutcomeEvidenceSha256: sha256,
    inferenceClusterId: nonEmpty,
    clusterUnitVersion: z.literal(VIEWER_CLUSTER_UNIT_VERSION),
    foldId,
    modelBundleSha256: sha256,
    expectedStepCount: z.number().int().positive()
      .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSlots),
    servable: z.literal(false),
  }).strict(),
  z.object({
    recordType: z.literal('step_start'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    expectedActionCount: z.number().int().positive()
      .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows),
  }).strict(),
  z.object({
    recordType: z.literal('prediction'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    actionKey: decisionActionKeySchema,
    foldId,
    primitivePredictions: offlinePrimitivePredictionsSchema,
    qHat: finite,
  }).strict(),
  z.object({
    recordType: z.literal('step_end'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    actualActionCount: z.number().int().positive()
      .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows),
    stepSha256: sha256,
  }).strict(),
  z.object({
    recordType: z.literal('decision_end'),
    decisionId: z.string().uuid(),
    actualStepCount: z.number().int().positive()
      .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSlots),
    actualPredictionCount: z.number().int().positive()
      .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows),
    decisionSha256: sha256,
  }).strict(),
]);

export const cohortPredictionSetManifestV3Schema = z.object({
  contractVersion: z.literal('cross_fitted_cohort_prediction_set_manifest_v3'),
  datasetVersion: nonEmpty,
  predictionStreamSha256: sha256,
  physicalRecordCount: z.number().int().positive()
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolRecords),
  decisionCount: z.number().int().positive()
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions),
  viewerClusterCount: z.number().int()
    .min(PREDICTION_V3_RESOURCE_LIMITS.minimumViewerClusters)
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters),
  stepCount: z.number().int().positive().max(PREDICTION_V3_RESOURCE_LIMITS.maximumSlots),
  predictionCount: z.number().int().positive()
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows),
  candidateBaseCount: z.number().int().positive()
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumCandidateBaseRows),
  trainingRowCount: z.number().int().positive()
    .max(PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows),
  auxiliaryRowCount: z.literal(0),
  modelBundleSha256: sha256,
  snapshotManifestSha256: sha256,
  targetManifestSha256: sha256,
  targetVerificationReceiptSha256: sha256,
  decisionContextEvidenceSha256: sha256,
  syntheticDecisionLogRootSha256: sha256,
  syntheticOutcomeEvidenceRootSha256: sha256,
  holdoutPlanSha256: sha256,
  trainingConfigSha256: sha256,
  resourceLimitsVersion: z.literal(PREDICTION_V3_RESOURCE_LIMITS_VERSION),
  resourceLimitsSha256: sha256,
  runtimeConfigVersion: z.literal(PREDICTION_V3_RUNTIME_CONFIG_VERSION),
  runtimeConfigSha256: sha256,
  rowOrder: z.literal(PREDICTION_V3_ROW_ORDER),
  rewardDefinitionSha256: sha256,
  predictionSetVersion: sha256,
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
}).strict();

export type CohortPredictionRuntimeConfigV3 = z.infer<
  typeof cohortPredictionRuntimeConfigV3Schema
>;
export type CohortPredictionResourceLimitsV3 = z.infer<
  typeof cohortPredictionResourceLimitsV3Schema
>;
export type ViewerClusterHoldoutAssignmentV1 = z.infer<
  typeof viewerClusterHoldoutAssignmentV1Schema
>;
export type ViewerClusterHoldoutFoldV1 = z.infer<
  typeof viewerClusterHoldoutFoldV1Schema
>;
export type ViewerClusterHoldoutPlanV1 = z.infer<
  typeof viewerClusterHoldoutPlanV1Schema
>;
export type VerifiedViewerClusterHoldoutPlanV1 = ViewerClusterHoldoutPlanV1;
export type CrossFittedCohortModelBundleV3 = z.infer<
  typeof crossFittedCohortModelBundleV3Schema
>;
export type CohortPredictionRecordV3 = z.infer<typeof cohortPredictionRecordV3Schema>;
export type CohortPredictionSetManifestV3 = z.infer<
  typeof cohortPredictionSetManifestV3Schema
>;

export type CohortPredictionDecisionInputV3 = {
  syntheticDecisionLog: SyntheticDecisionLogV1;
  outcomeEvidence: VerifiedSyntheticOutcomeEvidenceV1;
};

export type CrossFittedCohortPredictionInputV3 = {
  targetEvidence: VerifiedTargetDistributionEvidenceV2;
  snapshot: VerifiedFullSupportPitActionSnapshotV2;
  decisionContextEvidence: VerifiedDecisionContextEvidenceV1;
  decisions: readonly CohortPredictionDecisionInputV3[];
  rewardDefinition: OfflineRewardDefinitionV1;
};

export type CohortPredictionResourceDiagnosticsV3 = {
  preflightCompletedBeforeSpool: true;
  decisionCount: number;
  viewerClusterCount: number;
  slotCount: number;
  supportActionRowCount: number;
  candidateBaseRowCount: number;
  trainingRowCount: number;
  predictionRecordCount: number;
  combinedSpoolRecordCount: number;
  combinedSpoolByteCount: number;
  peakLineBytes: number;
  maximumFoldFeatureCount: number;
  workModelVersion: typeof PREDICTION_V3_WORK_MODEL_VERSION;
  producerAndVerifierMathWorkUnits: number;
  targetEvidenceReplayPasses: 4;
  targetEvidenceReplayRecords: number;
  snapshotEvidenceReplayPasses: 2;
  snapshotEvidenceReplayRecords: number;
  trainingSpoolReplayPasses: 12;
  trainingSpoolReplayRows: number;
  verificationPredictionStreamReadRows: number;
  verificationPredictionStreamComparisonRows: number;
};

export type ProducedCrossFittedCohortPredictionSetV3 = {
  contractVersion: 'produced_cross_fitted_cohort_prediction_set_v3';
  holdoutPlan: VerifiedViewerClusterHoldoutPlanV1;
  bundle: CrossFittedCohortModelBundleV3;
  modelBundleRaw: string;
  manifest: CohortPredictionSetManifestV3;
  predictionSetManifestRaw: string;
  predictionStream: ByteStreamFactoryV2;
  artifactState: 'pre_publish';
  diagnostics: CohortPredictionResourceDiagnosticsV3;
  dispose: () => Promise<void>;
};

export type CohortPredictionVerificationReceiptV3 = {
  contractVersion: 'cross_fitted_cohort_prediction_verification_receipt_v3';
  verifierVersion: 'cross_fitted_cohort_prediction_set_verifier_v3';
  predictionSetVersion: string;
  modelBundleSha256: string;
  predictionStreamSha256: string;
  snapshotManifestSha256: string;
  targetManifestSha256: string;
  targetVerificationReceiptSha256: string;
  decisionContextEvidenceSha256: string;
  syntheticDecisionLogRootSha256: string;
  syntheticOutcomeEvidenceRootSha256: string;
  holdoutPlanSha256: string;
  trainingConfigSha256: string;
  resourceLimitsVersion: typeof PREDICTION_V3_RESOURCE_LIMITS_VERSION;
  resourceLimitsSha256: string;
  runtimeConfigVersion: typeof PREDICTION_V3_RUNTIME_CONFIG_VERSION;
  runtimeConfigSha256: string;
  rowOrder: typeof PREDICTION_V3_ROW_ORDER;
  rewardDefinitionSha256: string;
  decisionCount: number;
  viewerClusterCount: number;
  stepCount: number;
  predictionCount: number;
  trainingRowCount: number;
  combinedSpoolRecordCount: number;
  combinedSpoolByteCount: number;
  workModelVersion: typeof PREDICTION_V3_WORK_MODEL_VERSION;
  producerAndVerifierMathWorkUnits: number;
  targetEvidenceReplayPasses: 4;
  targetEvidenceReplayRecords: number;
  snapshotEvidenceReplayPasses: 2;
  snapshotEvidenceReplayRecords: number;
  trainingSpoolReplayPasses: 12;
  trainingSpoolReplayRows: number;
  verificationPredictionStreamReadRows: number;
  verificationPredictionStreamComparisonRows: number;
  receiptSha256: string;
};

export type VerifiedCrossFittedCohortPredictionSetV3 = {
  contractVersion: 'verified_cross_fitted_cohort_prediction_set_v3';
  holdoutPlan: VerifiedViewerClusterHoldoutPlanV1;
  manifest: CohortPredictionSetManifestV3;
  receipt: CohortPredictionVerificationReceiptV3;
  realDatasetEligible: false;
  servable: false;
};

export type VerifiedCohortPredictionStepV3 = {
  contractVersion: 'verified_cohort_prediction_step_v3';
  predictionSetVersion: string;
  verificationReceiptSha256: string;
  decisionId: string;
  requestId: string;
  inferenceClusterId: string;
  clusterUnitVersion: typeof VIEWER_CLUSTER_UNIT_VERSION;
  foldId: 0 | 1;
  servedPosition: number;
  qHat: Array<{
    actionKey: z.infer<typeof decisionActionKeySchema>;
    value: number;
  }>;
};

export type VerifiedCohortPredictionCursorV3 = {
  readonly contractVersion: 'verified_cohort_prediction_cursor_v3';
};
