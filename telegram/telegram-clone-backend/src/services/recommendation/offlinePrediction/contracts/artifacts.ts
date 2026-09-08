import { createHash } from 'crypto';

import { z } from 'zod';

import { canonicalDecisionJson, decisionActionKeySchema } from '../../decisionLog/contracts';
import {
  canonicalUtcMillisSchema,
  OFFLINE_FEATURE_SCHEMA_VERSION,
  offlineFeatureInputSchema,
} from '../features/encode';
import {
  FOLD_ASSIGNMENT_VERSION,
} from '../trainer/folds';
import { OFFLINE_TRAINER_VERSION } from '../trainer/logistic';
import {
  OFFLINE_REWARD_HEADS_V1,
  offlineObservedLabelsSchema,
  offlinePrimitivePredictionsSchema,
} from './reward';

export const OFFLINE_SNAPSHOT_MANIFEST_VERSION =
  'offline_prediction_snapshot_manifest_v1' as const;
export const CROSS_FITTED_MODEL_BUNDLE_VERSION = 'cross_fitted_model_bundle_v1' as const;
export const PREDICTION_ARTIFACT_STREAM_VERSION =
  'cross_fitted_prediction_artifact_stream_v1' as const;
export const PREDICTION_SET_MANIFEST_VERSION =
  'cross_fitted_prediction_set_manifest_v1' as const;
export const PREDICTION_SET_VERIFIER_VERSION =
  'cross_fitted_prediction_set_verifier_v1' as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().trim().min(1);
const finite = z.number().finite();

const featureRowBase = {
  decisionId: z.string().uuid(),
  actionKey: decisionActionKeySchema.refine((key) => key.servedPosition <= 64),
  decisionAt: canonicalUtcMillisSchema,
  featureAt: canonicalUtcMillisSchema,
  referenceAt: canonicalUtcMillisSchema,
  featureInput: offlineFeatureInputSchema,
};

export const offlineTrainingExampleSchema = z.object({
  contractVersion: z.literal('offline_prediction_training_example_v1'),
  ...featureRowBase,
  outcomeContractVersion: z.literal('outcome_contract_v1'),
  outcomeStatus: z.literal('observed'),
  outcomeHorizonMs: z.number().int().nonnegative(),
  observedThrough: canonicalUtcMillisSchema,
  labels: offlineObservedLabelsSchema,
}).strict();

export const offlinePredictionRequestSchema = z.object({
  contractVersion: z.literal('offline_prediction_request_v1'),
  ...featureRowBase,
}).strict();

export const offlineSnapshotManifestSchema = z.object({
  contractVersion: z.literal(OFFLINE_SNAPSHOT_MANIFEST_VERSION),
  datasetVersion: nonEmpty,
  featureSchemaVersion: z.literal(OFFLINE_FEATURE_SCHEMA_VERSION),
  trainingExampleSchemaVersion: z.literal('offline_prediction_training_example_v1'),
  predictionRequestSchemaVersion: z.literal('offline_prediction_request_v1'),
  sourceValidNdjsonSha256: sha256,
  predictionRequestNdjsonSha256: sha256,
  datasetManifestSha256: sha256,
  targetDistributionNdjsonSha256: sha256,
  targetDistributionManifestSha256: sha256,
  targetDistributionVerificationReceiptSha256: sha256,
  immutableSourceVersion: nonEmpty,
  trainingRowCount: z.number().int().nonnegative(),
  predictionRequestRowCount: z.number().int().nonnegative(),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
  snapshotManifestSha256: sha256,
}).strict();

export const offlineRewardDefinitionSchema = z.object({
  contractVersion: z.literal('offline_reward_definition_v1'),
  objective: nonEmpty,
  definitionVersion: nonEmpty,
  horizonMs: z.number().int().nonnegative(),
  weights: z.object({
    click: finite,
    like: finite,
    reply: finite,
    repost: finite,
    quote: finite,
    share: finite,
    dismiss: finite,
    blockAuthor: finite,
    report: finite,
  }).strict(),
  dwell: z.object({
    weight: finite,
    capMs: finite.positive(),
    scaleMs: finite.positive(),
  }).strict(),
}).strict();

export const crossFittedTrainingConfigSchema = z.object({
  contractVersion: z.literal('cross_fitted_training_config_v1'),
  trainerVersion: z.literal(OFFLINE_TRAINER_VERSION),
  featureSchemaVersion: z.literal(OFFLINE_FEATURE_SCHEMA_VERSION),
  foldAssignmentVersion: z.literal(FOLD_ASSIGNMENT_VERSION),
  initialization: z.literal('zeros_v1'),
  loss: z.literal('soft_label_binary_cross_entropy_v1'),
  gradientReduction: z.literal('mean_over_training_rows_v1'),
  l2Penalty: z.literal('lambda_over_2_times_weight_l2_v1'),
  regularizeIntercept: z.literal(false),
  classWeighting: z.literal('none'),
  shuffle: z.literal(false),
  earlyStopping: z.literal(false),
  foldCount: z.number().int().min(2).max(32),
  epochs: z.number().int().min(1).max(1_000),
  learningRate: finite.positive(),
  l2Lambda: finite.nonnegative(),
}).strict();

export type CrossFittedTrainingConfigV1 = z.infer<typeof crossFittedTrainingConfigSchema>;
export type OfflineRewardDefinitionV1 = z.infer<typeof offlineRewardDefinitionSchema>;
export type OfflineTrainingExampleV1 = z.infer<typeof offlineTrainingExampleSchema>;
export type OfflinePredictionRequestV1 = z.infer<typeof offlinePredictionRequestSchema>;
export type OfflineSnapshotManifestV1 = z.infer<typeof offlineSnapshotManifestSchema>;

export function createCrossFittedTrainingConfigV1(
  values: Pick<CrossFittedTrainingConfigV1, 'foldCount' | 'epochs' | 'learningRate' | 'l2Lambda'>,
): CrossFittedTrainingConfigV1 {
  return {
    contractVersion: 'cross_fitted_training_config_v1',
    trainerVersion: OFFLINE_TRAINER_VERSION,
    featureSchemaVersion: OFFLINE_FEATURE_SCHEMA_VERSION,
    foldAssignmentVersion: FOLD_ASSIGNMENT_VERSION,
    initialization: 'zeros_v1',
    loss: 'soft_label_binary_cross_entropy_v1',
    gradientReduction: 'mean_over_training_rows_v1',
    l2Penalty: 'lambda_over_2_times_weight_l2_v1',
    regularizeIntercept: false,
    classWeighting: 'none',
    shuffle: false,
    earlyStopping: false,
    ...values,
  };
}

export const PHASE11_MODEL_STATE_LIMITS_VERSION = 'phase11_model_state_limits_v1' as const;

const phase11ModelStateLimitsSchema = z.object({
  maxCoefficientsPerHead: z.number().int().safe().positive(),
  maxTotalCoefficientCount: z.number().int().safe().positive(),
  maxModelBytes: z.number().int().safe().positive(),
  maxGradientBytes: z.number().int().safe().positive(),
  maxTrainingDecisionsPerFold: z.number().int().safe().positive(),
  maxHoldoutDecisionsPerFold: z.number().int().safe().positive(),
  maxTrainingRowsPerFold: z.number().int().safe().positive(),
  maxHoldoutRowsPerFold: z.number().int().safe().positive(),
}).strict();

export const phase11ModelStateResourceConfigV1Schema = z.object({
  contractVersion: z.literal('phase11_model_state_resource_config_v1'),
  limitsVersion: z.literal(PHASE11_MODEL_STATE_LIMITS_VERSION),
  foldCount: z.number().int().safe().min(2).max(32),
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
  rowOrder: z.literal('canonical_decision_id_then_action_identity_v1'),
  foldOrder: z.literal('ascending_fold_id_v1'),
  featureOrder: z.literal('utf8_byte_order_v1'),
  accumulationOrder: z.literal('row_then_head_then_feature_v1'),
  numericStorage: z.literal('float64_model_and_gradient_v1'),
  limits: phase11ModelStateLimitsSchema,
}).strict();

export type Phase11ModelStateResourceConfigV1 = z.infer<
  typeof phase11ModelStateResourceConfigV1Schema
>;

const phase11CanonicalModelStateV1Schema = z.object({
  folds: z.array(z.object({
    foldId: z.number().int().safe().nonnegative(),
    trainingDecisionIds: z.array(nonEmpty),
    holdoutDecisionIds: z.array(nonEmpty),
    trainingRowKeys: z.array(nonEmpty),
    holdoutRowKeys: z.array(nonEmpty),
    heads: z.array(z.object({
      head: z.enum(OFFLINE_REWARD_HEADS_V1),
      intercept: finite,
      coefficients: z.array(z.object({
        feature: nonEmpty,
        value: finite,
      }).strict()),
    }).strict()),
  }).strict()),
}).strict();

export function phase11ModelStateResourceConfigV1(
  values: { foldCount: number } & z.infer<typeof phase11ModelStateLimitsSchema>,
): Phase11ModelStateResourceConfigV1 {
  const { foldCount, ...limits } = values;
  return phase11ModelStateResourceConfigV1Schema.parse({
    contractVersion: 'phase11_model_state_resource_config_v1',
    limitsVersion: PHASE11_MODEL_STATE_LIMITS_VERSION,
    foldCount,
    headOrder: OFFLINE_REWARD_HEADS_V1,
    rowOrder: 'canonical_decision_id_then_action_identity_v1',
    foldOrder: 'ascending_fold_id_v1',
    featureOrder: 'utf8_byte_order_v1',
    accumulationOrder: 'row_then_head_then_feature_v1',
    numericStorage: 'float64_model_and_gradient_v1',
    limits,
  });
}

export function evaluatePhase11ModelStateBudgetV1(
  rawConfig: unknown,
  rawState: unknown,
): {
  status: 'within_budget';
  role: 'allocation_budget_only';
  canMintVerifiedPredictionReceipt: false;
  resourceConfigSha256: string;
  usage: {
    coefficientCount: number;
    scalarCount: number;
    modelBytes: number;
    gradientBytes: number;
    foldCount: number;
    trainingDecisionCount: number;
    holdoutDecisionCount: number;
    trainingRowCount: number;
    holdoutRowCount: number;
  };
}
  | { status: 'not_evaluable'; blocker: string } {
  const config = phase11ModelStateResourceConfigV1Schema.safeParse(rawConfig);
  const state = phase11CanonicalModelStateV1Schema.safeParse(rawState);
  if (!config.success || !state.success) {
    return { status: 'not_evaluable', blocker: 'model_state_contract_invalid' };
  }
  const compareText = (left: string, right: string): number => Buffer.compare(
    Buffer.from(left), Buffer.from(right),
  );
  const canonicalList = (values: string[]): boolean => (
    new Set(values).size === values.length
    && values.every((value, index) => index === 0 || compareText(values[index - 1]!, value) < 0)
  );
  if (
    state.data.folds.length !== config.data.foldCount
    || state.data.folds.some((fold, index) => fold.foldId !== index)
    || state.data.folds.some((fold) => (
      fold.heads.length !== OFFLINE_REWARD_HEADS_V1.length
      || fold.heads.some((head, index) => head.head !== OFFLINE_REWARD_HEADS_V1[index])
      || !canonicalList(fold.trainingDecisionIds)
      || !canonicalList(fold.holdoutDecisionIds)
      || !canonicalList(fold.trainingRowKeys)
      || !canonicalList(fold.holdoutRowKeys)
      || fold.heads.some((head) => !canonicalList(
        head.coefficients.map((coefficient) => coefficient.feature),
      ))
    ))
  ) return { status: 'not_evaluable', blocker: 'model_state_order_mismatch' };
  if (state.data.folds.some((fold) => (
    fold.trainingDecisionIds.length === 0 || fold.trainingRowKeys.length === 0
  ))) return { status: 'not_evaluable', blocker: 'empty_training_fold' };
  if (state.data.folds.some((fold) => (
    fold.holdoutDecisionIds.length === 0 || fold.holdoutRowKeys.length === 0
  ))) return { status: 'not_evaluable', blocker: 'empty_holdout_fold' };
  const coefficientCount = state.data.folds.reduce((foldTotal, fold) => (
    foldTotal + fold.heads.reduce((headTotal, head) => (
      headTotal + head.coefficients.length
    ), 0)
  ), 0);
  const scalarCount = coefficientCount
    + state.data.folds.length * OFFLINE_REWARD_HEADS_V1.length;
  const modelBytes = scalarCount * Float64Array.BYTES_PER_ELEMENT;
  const gradientBytes = scalarCount * Float64Array.BYTES_PER_ELEMENT;
  if (![coefficientCount, scalarCount, modelBytes, gradientBytes].every(Number.isSafeInteger)) {
    return { status: 'not_evaluable', blocker: 'model_state_resource_limit_exceeded' };
  }
  const limits = config.data.limits;
  if (
    coefficientCount > limits.maxTotalCoefficientCount
    || modelBytes > limits.maxModelBytes
    || gradientBytes > limits.maxGradientBytes
    || state.data.folds.some((fold) => (
      fold.trainingDecisionIds.length > limits.maxTrainingDecisionsPerFold
      || fold.holdoutDecisionIds.length > limits.maxHoldoutDecisionsPerFold
      || fold.trainingRowKeys.length > limits.maxTrainingRowsPerFold
      || fold.holdoutRowKeys.length > limits.maxHoldoutRowsPerFold
      || fold.heads.some((head) => (
        head.coefficients.length > limits.maxCoefficientsPerHead
      ))
    ))
  ) return { status: 'not_evaluable', blocker: 'model_state_resource_limit_exceeded' };
  const usage = {
    coefficientCount,
    scalarCount,
    modelBytes,
    gradientBytes,
    foldCount: state.data.folds.length,
    trainingDecisionCount: state.data.folds.reduce(
      (sum, fold) => sum + fold.trainingDecisionIds.length, 0,
    ),
    holdoutDecisionCount: state.data.folds.reduce(
      (sum, fold) => sum + fold.holdoutDecisionIds.length, 0,
    ),
    trainingRowCount: state.data.folds.reduce(
      (sum, fold) => sum + fold.trainingRowKeys.length, 0,
    ),
    holdoutRowCount: state.data.folds.reduce(
      (sum, fold) => sum + fold.holdoutRowKeys.length, 0,
    ),
  };
  return {
    status: 'within_budget',
    role: 'allocation_budget_only',
    canMintVerifiedPredictionReceipt: false,
    resourceConfigSha256: createHash('sha256')
      .update(canonicalDecisionJson(config.data))
      .digest('hex'),
    usage,
  };
}

const coefficientSchema = z.object({ key: nonEmpty, value: finite }).strict();
const headModelSchema = z.object({
  head: z.enum(OFFLINE_REWARD_HEADS_V1),
  intercept: finite,
  coefficients: z.array(coefficientSchema),
}).strict();

export const crossFittedModelBundleSchema = z.object({
  contractVersion: z.literal(CROSS_FITTED_MODEL_BUNDLE_VERSION),
  datasetVersion: nonEmpty,
  trainingExamplesNdjsonSha256: sha256,
  trainingDatasetManifestSha256: sha256,
  snapshotManifestSha256: sha256,
  rewardDefinitionSha256: sha256,
  featureSchemaVersion: z.literal(OFFLINE_FEATURE_SCHEMA_VERSION),
  trainerVersion: z.literal(OFFLINE_TRAINER_VERSION),
  foldAssignmentVersion: z.literal(FOLD_ASSIGNMENT_VERSION),
  foldCount: z.number().int().min(2).max(32),
  trainingConfigSha256: sha256,
  foldConfigSha256: sha256,
  folds: z.array(z.object({
    foldId: z.number().int().nonnegative(),
    trainingDecisionIds: z.array(z.string().uuid()),
    holdoutDecisionIds: z.array(z.string().uuid()),
    trainingDecisionSetSha256: sha256,
    holdoutDecisionSetSha256: sha256,
    heads: z.array(headModelSchema).length(OFFLINE_REWARD_HEADS_V1.length),
    foldModelSha256: sha256,
  }).strict()),
  crossFitted: z.literal(true),
  servable: z.literal(false),
  modelBundleSha256: sha256,
}).strict();

export const predictionArtifactRecordSchema = z.discriminatedUnion('recordType', [
  z.object({
    recordType: z.literal('artifact_start'),
    contractVersion: z.literal(PREDICTION_ARTIFACT_STREAM_VERSION),
    decisionId: z.string().uuid(),
    decisionLogSha256: sha256,
    candidatePoolSha256: sha256,
    modelBundleSha256: sha256,
    objective: nonEmpty,
    rewardDefinitionVersion: nonEmpty,
    horizonMs: z.number().int().nonnegative(),
    featureSchemaVersion: z.literal(OFFLINE_FEATURE_SCHEMA_VERSION),
    expectedPredictionCount: z.number().int().positive(),
    servable: z.literal(false),
  }).strict(),
  z.object({
    recordType: z.literal('prediction'),
    decisionId: z.string().uuid(),
    actionKey: decisionActionKeySchema,
    foldId: z.number().int().nonnegative(),
    primitivePredictions: offlinePrimitivePredictionsSchema,
    qHat: finite,
  }).strict(),
  z.object({
    recordType: z.literal('artifact_end'),
    decisionId: z.string().uuid(),
    expectedPredictionCount: z.number().int().positive(),
    actualPredictionCount: z.number().int().positive(),
    perDecisionArtifactSha256: sha256,
  }).strict(),
]);

export const predictionSetManifestSchema = z.object({
  contractVersion: z.literal(PREDICTION_SET_MANIFEST_VERSION),
  datasetVersion: nonEmpty,
  artifactStreamSha256: sha256,
  artifactCount: z.number().int().positive(),
  predictionCount: z.number().int().positive(),
  perDecisionArtifacts: z.array(z.object({
    decisionId: z.string().uuid(),
    perDecisionArtifactSha256: sha256,
  }).strict()),
  modelBundleSha256: sha256,
  trainingExamplesNdjsonSha256: sha256,
  trainingDatasetManifestSha256: sha256,
  snapshotManifestSha256: sha256,
  targetDistributionNdjsonSha256: sha256,
  targetDistributionManifestSha256: sha256,
  targetDistributionVerificationReceiptSha256: sha256,
  objective: nonEmpty,
  rewardDefinitionVersion: nonEmpty,
  rewardDefinitionSha256: sha256,
  horizonMs: z.number().int().nonnegative(),
  featureSchemaVersion: z.literal(OFFLINE_FEATURE_SCHEMA_VERSION),
  predictionSetVersion: sha256,
  servable: z.literal(false),
}).strict();

export type CrossFittedModelBundleV1 = z.infer<typeof crossFittedModelBundleSchema>;
export type PredictionArtifactRecordV1 = z.infer<typeof predictionArtifactRecordSchema>;
export type PredictionSetManifestV1 = z.infer<typeof predictionSetManifestSchema>;
