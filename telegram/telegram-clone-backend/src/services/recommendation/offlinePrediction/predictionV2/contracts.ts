import { z } from 'zod';

import { decisionActionKeySchema } from '../../decisionLog/contracts';
import type { VerifiedSyntheticOutcomeEvidenceV1 } from '../../outcomes/syntheticOutcomeEvidenceV1';
import type {
  CrossFittedTrainingConfigV1,
  OfflineRewardDefinitionV1,
  Phase11ModelStateResourceConfigV1,
} from '../contracts/artifacts';
import { OFFLINE_REWARD_HEADS_V1, offlinePrimitivePredictionsSchema } from '../contracts/reward';
import type { VerifiedFullSupportPitActionSnapshotV2 } from '../snapshotV2';
import type { ByteStreamFactoryV2, VerifiedTargetDistributionEvidenceV2 } from '../targetEvidence';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().trim().min(1);
const finite = z.number().finite();
const coefficientSchema = z.object({ feature: nonEmpty, value: finite }).strict();

export const PREDICTION_V2_ROW_ORDER =
  'verified_target_stream_position_major_v2' as const;
export const PREDICTION_SPOOL_LIMITS_VERSION = 'prediction_spool_limits_v2' as const;
export const PREDICTION_V2_RUNTIME_CONFIG_VERSION =
  'prediction_v2_runtime_config_v1' as const;

export const crossFittedModelBundleV2Schema = z.object({
  contractVersion: z.literal('cross_fitted_model_bundle_v2'),
  datasetVersion: nonEmpty,
  snapshotManifestSha256: sha256,
  targetManifestSha256: sha256,
  targetVerificationReceiptSha256: sha256,
  syntheticOutcomeEvidenceSha256: sha256,
  syntheticAuxiliaryTrainingRootSha256: sha256,
  trainingSpoolSha256: sha256,
  trainingConfigSha256: sha256,
  resourceConfigSha256: sha256,
  spoolResourceConfigSha256: sha256,
  runtimeConfigVersion: z.literal(PREDICTION_V2_RUNTIME_CONFIG_VERSION),
  runtimeConfigSha256: sha256,
  rowOrder: z.literal(PREDICTION_V2_ROW_ORDER),
  rewardDefinitionSha256: sha256,
  foldCount: z.literal(2),
  folds: z.array(z.object({
    foldId: z.number().int().min(0).max(1),
    trainingDecisionIds: z.array(z.string().uuid()).min(1),
    holdoutDecisionIds: z.array(z.string().uuid()).min(1),
    trainingRowKeys: z.array(nonEmpty).min(1),
    holdoutRowKeys: z.array(nonEmpty).min(1),
    heads: z.array(z.object({
      head: z.enum(OFFLINE_REWARD_HEADS_V1),
      intercept: finite,
      coefficients: z.array(coefficientSchema),
    }).strict()).length(OFFLINE_REWARD_HEADS_V1.length),
    foldModelSha256: sha256,
  }).strict()).length(2),
  crossFitted: z.literal(true),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
  modelBundleSha256: sha256,
}).strict();

export const predictionRecordV2Schema = z.discriminatedUnion('recordType', [
  z.object({
    recordType: z.literal('decision_start'),
    contractVersion: z.literal('cross_fitted_prediction_stream_v2'),
    decisionId: z.string().uuid(),
    decisionLogSha256: sha256,
    candidatePoolSha256: sha256,
    modelBundleSha256: sha256,
    expectedStepCount: z.number().int().positive().max(64),
    servable: z.literal(false),
  }).strict(),
  z.object({
    recordType: z.literal('step_start'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    expectedActionCount: z.number().int().positive().max(2048),
  }).strict(),
  z.object({
    recordType: z.literal('prediction'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    actionKey: decisionActionKeySchema,
    foldId: z.number().int().min(0).max(1),
    primitivePredictions: offlinePrimitivePredictionsSchema,
    qHat: finite,
  }).strict(),
  z.object({
    recordType: z.literal('step_end'),
    decisionId: z.string().uuid(),
    servedPosition: z.number().int().positive().max(64),
    actualActionCount: z.number().int().positive().max(2048),
    stepSha256: sha256,
  }).strict(),
  z.object({
    recordType: z.literal('decision_end'),
    decisionId: z.string().uuid(),
    actualStepCount: z.number().int().positive().max(64),
    actualPredictionCount: z.number().int().positive(),
    decisionSha256: sha256,
  }).strict(),
]);

export const predictionSetManifestV2Schema = z.object({
  contractVersion: z.literal('cross_fitted_prediction_set_manifest_v2'),
  datasetVersion: nonEmpty,
  predictionStreamSha256: sha256,
  physicalRecordCount: z.number().int().positive(),
  decisionCount: z.number().int().positive(),
  stepCount: z.number().int().positive(),
  predictionCount: z.number().int().positive(),
  modelBundleSha256: sha256,
  snapshotManifestSha256: sha256,
  targetManifestSha256: sha256,
  targetVerificationReceiptSha256: sha256,
  syntheticOutcomeEvidenceSha256: sha256,
  syntheticAuxiliaryTrainingRootSha256: sha256,
  resourceConfigSha256: sha256,
  spoolResourceConfigSha256: sha256,
  runtimeConfigVersion: z.literal(PREDICTION_V2_RUNTIME_CONFIG_VERSION),
  runtimeConfigSha256: sha256,
  rowOrder: z.literal(PREDICTION_V2_ROW_ORDER),
  rewardDefinitionSha256: sha256,
  predictionSetVersion: sha256,
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
}).strict();

export type CrossFittedModelBundleV2 = z.infer<typeof crossFittedModelBundleV2Schema>;
export type PredictionRecordV2 = z.infer<typeof predictionRecordV2Schema>;
export type PredictionSetManifestV2 = z.infer<typeof predictionSetManifestV2Schema>;

export type PredictionSpoolLimitsV2 = {
  maxLineBytes: number;
  maxFileBytes: number;
  maxRecords: number;
};

export type CrossFittedPredictionInputV2 = {
  snapshot: VerifiedFullSupportPitActionSnapshotV2;
  targetEvidence: VerifiedTargetDistributionEvidenceV2;
  outcomeEvidence: VerifiedSyntheticOutcomeEvidenceV1;
  trainingConfig: CrossFittedTrainingConfigV1;
  resourceConfig: Phase11ModelStateResourceConfigV1;
  rewardDefinition: OfflineRewardDefinitionV1;
  spoolLimits?: PredictionSpoolLimitsV2;
};

export type ProducedCrossFittedPredictionSetV2 = {
  contractVersion: 'produced_cross_fitted_prediction_set_v2';
  bundle: CrossFittedModelBundleV2;
  modelBundleRaw: string;
  manifest: PredictionSetManifestV2;
  predictionSetManifestRaw: string;
  predictionStream: ByteStreamFactoryV2;
  artifactState: 'pre_publish';
  diagnostics: PredictionSpoolDiagnosticsV2;
  dispose: () => Promise<void>;
};

export type PredictionSpoolDiagnosticsV2 = {
  passCount: number;
  peakLineBytes: number;
  peakStepActions: number;
  peakStepBytes: number;
  records: number;
  bytes: number;
};

export type CrossFittedPredictionVerificationReceiptV2 = {
  contractVersion: 'cross_fitted_prediction_verification_receipt_v2';
  verifierVersion: 'cross_fitted_prediction_set_verifier_v2';
  predictionSetVersion: string;
  modelBundleSha256: string;
  predictionStreamSha256: string;
  snapshotManifestSha256: string;
  targetManifestSha256: string;
  targetVerificationReceiptSha256: string;
  syntheticOutcomeEvidenceSha256: string;
  syntheticAuxiliaryTrainingRootSha256: string;
  resourceConfigSha256: string;
  spoolResourceConfigSha256: string;
  runtimeConfigVersion: typeof PREDICTION_V2_RUNTIME_CONFIG_VERSION;
  runtimeConfigSha256: string;
  rowOrder: typeof PREDICTION_V2_ROW_ORDER;
  passCount: number;
  receiptSha256: string;
};

export type VerifiedCrossFittedPredictionSetV2 = {
  contractVersion: 'verified_cross_fitted_prediction_set_v2';
  manifest: PredictionSetManifestV2;
  receipt: CrossFittedPredictionVerificationReceiptV2;
  realDatasetEligible: false;
  servable: false;
};

export type VerifiedPredictionStepV2 = {
  contractVersion: 'verified_prediction_step_v2';
  predictionSetVersion: string;
  verificationReceiptSha256: string;
  decisionId: string;
  servedPosition: number;
  qHat: Array<{
    actionKey: z.infer<typeof decisionActionKeySchema>;
    value: number;
  }>;
};

export type VerifiedPredictionCursorV2 = {
  readonly contractVersion: 'verified_prediction_cursor_v2';
};
