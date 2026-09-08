import { z } from 'zod';

import { VIEWER_CLUSTER_UNIT_VERSION } from '../../decisionContext/contracts';
import type { VerifiedPhase18MultiwayHoldoutPlanAuditV1 } from '../../ope/inference/qualification/v8/multiwayHoldout';
import type { VerifiedPhase18SyntheticViewerTimeProvenanceV1 } from '../../ope/inference/qualification/v8/timeProvenance';
import { decisionActionKeySchema } from '../../decisionLog/contracts';
import type { OfflineRewardDefinitionV1 } from '../contracts/artifacts';
import {
  OFFLINE_REWARD_HEADS_V1,
  offlinePrimitivePredictionsSchema,
} from '../contracts/reward';
import type { VerifiedCrossFittedCohortPredictionSetV3 } from '../predictionV3';
import type { VerifiedFullSupportPitActionSnapshotV2 } from '../snapshotV2';
import type { ByteStreamFactoryV2 } from '../targetEvidence';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().trim().min(1).max(512);
const finite = z.number().finite();
const coefficientSchema = z.object({ feature: nonEmpty, value: finite }).strict();

export const PREDICTION_V4_TRAINING_EVIDENCE_SCOPE =
  'mechanical_training_e2e_only' as const;
export const PREDICTION_V4_ROW_ORDER =
  'canonical_decision_then_position_then_action_identity_v1' as const;
export const PREDICTION_V4_RESOURCE_LIMITS_VERSION =
  'synthetic_multiway_prediction_resource_limits_v1' as const;
export const PREDICTION_V4_RUNTIME_CONFIG_VERSION =
  'synthetic_multiway_prediction_runtime_config_v1' as const;
export const PREDICTION_V4_WORK_MODEL_VERSION =
  'synthetic_multiway_prediction_work_model_v1' as const;

export const PREDICTION_V4_RESOURCE_LIMITS = Object.freeze({
  requiredDecisions: 4,
  requiredViewerClusters: 2,
  requiredTimeClusters: 2,
  requiredEvaluationCells: 4,
  requiredSlots: 8,
  maximumSupportActionRows: 20,
  maximumLabelRows: 8,
  maximumFeaturesPerCell: 128,
  maximumPredictionRecords: 44,
  maximumCombinedSpoolRecords: 64,
  maximumLineBytes: 65_536,
  maximumCombinedSpoolBytes: 33_554_432,
  maximumCanonicalInputBytes: 33_554_432,
  maximumProducerAndVerifierMathWorkUnits: 16_777_216,
} as const);

export const PREDICTION_V4_RUNTIME_CONFIG = Object.freeze({
  contractVersion: PREDICTION_V4_RUNTIME_CONFIG_VERSION,
  epochs: 3,
  headOrder: OFFLINE_REWARD_HEADS_V1,
  learningRate: 0.1,
  l2Lambda: 0.01,
} as const);

export const multiwayPredictionRuntimeConfigV4Schema = z.object({
  contractVersion: z.literal(PREDICTION_V4_RUNTIME_CONFIG_VERSION),
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
}).strict();

const modelCellV4Schema = z.object({
  cellSha256: sha256,
  viewerClusterId: nonEmpty,
  timeClusterId: nonEmpty,
  evaluationDecisionIds: z.array(z.string().uuid()).length(1),
  trainingDecisionIds: z.array(z.string().uuid()).length(1),
  guardBandDecisionIds: z.array(z.string().uuid()).length(2),
  excludedDecisionIds: z.array(z.string().uuid()).length(3),
  trainingRowKeys: z.array(sha256).min(1)
    .max(PREDICTION_V4_RESOURCE_LIMITS.maximumLabelRows),
  evaluationRowKeys: z.array(sha256).min(1)
    .max(PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows),
  guardBandRowKeys: z.array(sha256).min(1)
    .max(PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows),
  featureKeys: z.array(nonEmpty)
    .max(PREDICTION_V4_RESOURCE_LIMITS.maximumFeaturesPerCell),
  heads: z.array(z.object({
    head: z.enum(OFFLINE_REWARD_HEADS_V1),
    intercept: finite,
    coefficients: z.array(coefficientSchema)
      .max(PREDICTION_V4_RESOURCE_LIMITS.maximumFeaturesPerCell),
  }).strict()).length(OFFLINE_REWARD_HEADS_V1.length),
  sameViewerLeakageExcludedInTraining: z.literal(true),
  sameTimeLeakageExcludedInTraining: z.literal(true),
  guardBandExcludedFromTraining: z.literal(true),
  modelCellSha256: sha256,
}).strict();

export const multiwayCrossFittedModelBundleV4Schema = z.object({
  contractVersion: z.literal('synthetic_multiway_cross_fitted_model_bundle_v4'),
  datasetVersion: nonEmpty,
  sourcePredictionSetVersion: sha256,
  sourcePredictionVerificationReceiptSha256: sha256,
  snapshotManifestSha256: sha256,
  targetManifestSha256: sha256,
  targetVerificationReceiptSha256: sha256,
  decisionContextEvidenceSha256: sha256,
  syntheticDecisionLogRootSha256: sha256,
  syntheticOutcomeEvidenceRootSha256: sha256,
  viewerHoldoutPlanSha256: sha256,
  phase18ProvenanceSha256: sha256,
  phase18PlanSha256: sha256,
  viewerMembershipSha256: sha256,
  timeMembershipSha256: sha256,
  trainingSpoolSha256: sha256,
  trainingConfigSha256: sha256,
  resourceLimitsVersion: z.literal(PREDICTION_V4_RESOURCE_LIMITS_VERSION),
  resourceLimitsSha256: sha256,
  runtimeConfigVersion: z.literal(PREDICTION_V4_RUNTIME_CONFIG_VERSION),
  runtimeConfigSha256: sha256,
  rowOrder: z.literal(PREDICTION_V4_ROW_ORDER),
  rewardDefinitionSha256: sha256,
  viewerClusterCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.requiredViewerClusters),
  timeClusterCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.requiredTimeClusters),
  evaluationCellCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.requiredEvaluationCells),
  cells: z.array(modelCellV4Schema)
    .length(PREDICTION_V4_RESOURCE_LIMITS.requiredEvaluationCells),
  crossFitted: z.literal(true),
  unionExclusionApplied: z.literal(true),
  trainingApplied: z.literal(true),
  trainingEvidenceScope: z.literal(PREDICTION_V4_TRAINING_EVIDENCE_SCOPE),
  multiwayQHatProvenanceStatus: z.literal('verified_synthetic_only'),
  commonTimeShockHandlingVerified: z.literal(false),
  candidateEvidenceEligible: z.literal(false),
  qualificationEvidenceEligible: z.literal(false),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
  modelBundleSha256: sha256,
}).strict();

export const multiwayPredictionRecordV4Schema = z.discriminatedUnion('recordType', [
  z.object({
    recordType: z.literal('decision_start'),
    contractVersion: z.literal('synthetic_multiway_prediction_stream_v4'),
    decisionId: z.string().uuid(),
    requestId: z.string().uuid(),
    inferenceClusterId: nonEmpty,
    clusterUnitVersion: z.literal(VIEWER_CLUSTER_UNIT_VERSION),
    timeClusterId: nonEmpty,
    cellSha256: sha256,
    modelCellSha256: sha256,
    modelBundleSha256: sha256,
    expectedStepCount: z.number().int().positive().max(64),
    servable: z.literal(false),
  }).strict(),
  z.object({
    recordType: z.literal('step_start'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    expectedActionCount: z.number().int().positive()
      .max(PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows),
  }).strict(),
  z.object({
    recordType: z.literal('prediction'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    actionKey: decisionActionKeySchema,
    viewerClusterId: nonEmpty,
    timeClusterId: nonEmpty,
    cellSha256: sha256,
    modelCellSha256: sha256,
    primitivePredictions: offlinePrimitivePredictionsSchema,
    qHat: finite,
  }).strict(),
  z.object({
    recordType: z.literal('step_end'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    actualActionCount: z.number().int().positive()
      .max(PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows),
    stepSha256: sha256,
  }).strict(),
  z.object({
    recordType: z.literal('decision_end'),
    decisionId: z.string().uuid(),
    actualStepCount: z.number().int().positive().max(64),
    actualPredictionCount: z.number().int().positive()
      .max(PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows),
    decisionSha256: sha256,
  }).strict(),
]);

export const multiwayPredictionSetManifestV4Schema = z.object({
  contractVersion: z.literal('synthetic_multiway_prediction_set_manifest_v4'),
  datasetVersion: nonEmpty,
  predictionStreamSha256: sha256,
  physicalRecordCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.maximumPredictionRecords),
  decisionCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.requiredDecisions),
  viewerClusterCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.requiredViewerClusters),
  timeClusterCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.requiredTimeClusters),
  evaluationCellCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.requiredEvaluationCells),
  stepCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.requiredSlots),
  predictionCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows),
  trainingRowCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows),
  labelRowCount: z.literal(PREDICTION_V4_RESOURCE_LIMITS.maximumLabelRows),
  modelBundleSha256: sha256,
  sourcePredictionSetVersion: sha256,
  sourcePredictionVerificationReceiptSha256: sha256,
  snapshotManifestSha256: sha256,
  targetManifestSha256: sha256,
  targetVerificationReceiptSha256: sha256,
  decisionContextEvidenceSha256: sha256,
  syntheticDecisionLogRootSha256: sha256,
  syntheticOutcomeEvidenceRootSha256: sha256,
  viewerHoldoutPlanSha256: sha256,
  phase18ProvenanceSha256: sha256,
  phase18PlanSha256: sha256,
  viewerMembershipSha256: sha256,
  timeMembershipSha256: sha256,
  trainingConfigSha256: sha256,
  resourceLimitsVersion: z.literal(PREDICTION_V4_RESOURCE_LIMITS_VERSION),
  resourceLimitsSha256: sha256,
  runtimeConfigVersion: z.literal(PREDICTION_V4_RUNTIME_CONFIG_VERSION),
  runtimeConfigSha256: sha256,
  rowOrder: z.literal(PREDICTION_V4_ROW_ORDER),
  rewardDefinitionSha256: sha256,
  trainingApplied: z.literal(true),
  trainingEvidenceScope: z.literal(PREDICTION_V4_TRAINING_EVIDENCE_SCOPE),
  multiwayQHatProvenanceStatus: z.literal('verified_synthetic_only'),
  commonTimeShockHandlingVerified: z.literal(false),
  candidateEvidenceEligible: z.literal(false),
  qualificationEvidenceEligible: z.literal(false),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
  predictionSetVersion: sha256,
}).strict();

export type MultiwayCrossFittedModelBundleV4 = z.infer<
  typeof multiwayCrossFittedModelBundleV4Schema
>;
export type MultiwayPredictionRecordV4 = z.infer<typeof multiwayPredictionRecordV4Schema>;
export type MultiwayPredictionSetManifestV4 = z.infer<
  typeof multiwayPredictionSetManifestV4Schema
>;

export type MultiwayPredictionInputV4 = Readonly<{
  predictionSet: VerifiedCrossFittedCohortPredictionSetV3;
  snapshot: VerifiedFullSupportPitActionSnapshotV2;
  rewardDefinition: OfflineRewardDefinitionV1;
  provenance: VerifiedPhase18SyntheticViewerTimeProvenanceV1;
  plan: VerifiedPhase18MultiwayHoldoutPlanAuditV1;
}>;

export type MultiwayPredictionResourceDiagnosticsV4 = Readonly<{
  preflightCompletedBeforeSpoolAndTraining: true;
  decisionCount: 4;
  viewerClusterCount: 2;
  timeClusterCount: 2;
  evaluationCellCount: 4;
  slotCount: 8;
  supportActionRowCount: 20;
  labelRowCount: 8;
  trainingSpoolRecordCount: 20;
  predictionRecordCount: 44;
  combinedSpoolRecordCount: 64;
  combinedSpoolByteCount: number;
  peakLineBytes: number;
  maximumCellFeatureCount: number;
  workModelVersion: typeof PREDICTION_V4_WORK_MODEL_VERSION;
  producerAndVerifierMathWorkUnits: number;
  producerAndVerifierTrainingSpoolReplayPasses: 8;
  producerAndVerifierTrainingSpoolReplayRows: 160;
  verificationPredictionStreamReadRows: 88;
  verificationPredictionStreamComparisonRows: 44;
}>;

export type ProducedMultiwayPredictionSetV4 = Readonly<{
  contractVersion: 'produced_synthetic_multiway_prediction_set_v4';
  bundle: MultiwayCrossFittedModelBundleV4;
  modelBundleRaw: string;
  manifest: MultiwayPredictionSetManifestV4;
  predictionSetManifestRaw: string;
  predictionStream: ByteStreamFactoryV2;
  artifactState: 'pre_publish';
  diagnostics: MultiwayPredictionResourceDiagnosticsV4;
  dispose: () => Promise<void>;
}>;

export type MultiwayPredictionVerificationReceiptV4 = Readonly<{
  contractVersion: 'synthetic_multiway_prediction_verification_receipt_v4';
  verifierVersion: 'synthetic_multiway_prediction_set_verifier_v4';
  predictionSetVersion: string;
  modelBundleSha256: string;
  predictionStreamSha256: string;
  sourcePredictionSetVersion: string;
  sourcePredictionVerificationReceiptSha256: string;
  snapshotManifestSha256: string;
  targetManifestSha256: string;
  targetVerificationReceiptSha256: string;
  decisionContextEvidenceSha256: string;
  syntheticDecisionLogRootSha256: string;
  syntheticOutcomeEvidenceRootSha256: string;
  viewerHoldoutPlanSha256: string;
  phase18ProvenanceSha256: string;
  phase18PlanSha256: string;
  viewerMembershipSha256: string;
  timeMembershipSha256: string;
  trainingConfigSha256: string;
  resourceLimitsVersion: typeof PREDICTION_V4_RESOURCE_LIMITS_VERSION;
  resourceLimitsSha256: string;
  runtimeConfigVersion: typeof PREDICTION_V4_RUNTIME_CONFIG_VERSION;
  runtimeConfigSha256: string;
  rowOrder: typeof PREDICTION_V4_ROW_ORDER;
  rewardDefinitionSha256: string;
  trainingApplied: true;
  trainingEvidenceScope: typeof PREDICTION_V4_TRAINING_EVIDENCE_SCOPE;
  multiwayQHatProvenanceStatus: 'verified_synthetic_only';
  commonTimeShockHandlingVerified: false;
  decisionCount: 4;
  viewerClusterCount: 2;
  timeClusterCount: 2;
  evaluationCellCount: 4;
  stepCount: 8;
  predictionCount: 20;
  trainingRowCount: 20;
  labelRowCount: 8;
  combinedSpoolRecordCount: 64;
  combinedSpoolByteCount: number;
  workModelVersion: typeof PREDICTION_V4_WORK_MODEL_VERSION;
  producerAndVerifierMathWorkUnits: number;
  producerAndVerifierTrainingSpoolReplayPasses: 8;
  producerAndVerifierTrainingSpoolReplayRows: 160;
  verificationPredictionStreamReadRows: 88;
  verificationPredictionStreamComparisonRows: 44;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  receiptSha256: string;
}>;

export type VerifiedMultiwayPredictionSetV4 = Readonly<{
  contractVersion: 'verified_synthetic_multiway_prediction_set_v4';
  manifest: MultiwayPredictionSetManifestV4;
  receipt: MultiwayPredictionVerificationReceiptV4;
  trainingApplied: true;
  trainingEvidenceScope: typeof PREDICTION_V4_TRAINING_EVIDENCE_SCOPE;
  multiwayQHatProvenanceStatus: 'verified_synthetic_only';
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
}>;

export type ProduceMultiwayPredictionResultV4 =
  | Readonly<{ status: 'produced'; artifact: ProducedMultiwayPredictionSetV4 }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>;

export type VerifyMultiwayPredictionResultV4 =
  | Readonly<{ status: 'verified'; predictionSet: VerifiedMultiwayPredictionSetV4 }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>;
