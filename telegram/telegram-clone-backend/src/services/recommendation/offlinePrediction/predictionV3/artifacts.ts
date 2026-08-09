import { createHash } from 'crypto';

import { z } from 'zod';

import {
  canonicalDecisionJson,
  decisionLogSha256,
} from '../../decisionLog/contracts';
import {
  VIEWER_CLUSTER_UNIT_VERSION,
} from '../../decisionContext/contracts';
import {
  isVerifiedDecisionContextEvidenceV1,
  type VerifiedDecisionContextEvidenceV1,
} from '../../decisionContext/verify';
import {
  isVerifiedSyntheticOutcomeEvidenceV1,
  type VerifiedSyntheticOutcomeEvidenceV1,
} from '../../outcomes/syntheticOutcomeEvidenceV1';
import { canonicalWireJsonV1 } from '../artifacts/canonical';
import { offlineRewardDefinitionSchema } from '../contracts/artifacts';
import {
  OFFLINE_REWARD_HEADS_V1,
  encodeOfflineLabelsV1,
  type OfflinePrimitivePredictionsV1,
  type OfflineRewardHeadV1,
} from '../contracts/reward';
import {
  createCanonicalSpoolWriterV2,
  readCanonicalSpoolRecordsV2,
  type CanonicalSpoolV2,
} from '../predictionV2/spool';
import {
  isVerifiedFullSupportPitActionSnapshotV2,
  replayVerifiedSnapshotPositionFeaturesV2,
  type ExpandedSnapshotPositionFeatureV2,
  type VerifiedFullSupportPitActionSnapshotV2,
} from '../snapshotV2';
import {
  syntheticDecisionLogV1Schema,
  type SyntheticDecisionLogV1,
} from '../streamingV2/contracts';
import {
  isVerifiedTargetDistributionEvidenceV2,
  replayVerifiedTargetDistributionV2,
  type ByteStreamFactoryV2,
  type VerifiedTargetDistributionDecisionV2,
  type VerifiedTargetDistributionEvidenceV2,
  type VerifiedTargetDistributionStepV2,
} from '../targetEvidence';
import { stableSigmoid } from '../trainer/logistic';
import {
  PREDICTION_V3_FOLD_COUNT,
  PREDICTION_V3_RESOURCE_LIMITS,
  PREDICTION_V3_RESOURCE_LIMITS_VERSION,
  PREDICTION_V3_ROW_ORDER,
  PREDICTION_V3_RUNTIME_CONFIG,
  PREDICTION_V3_RUNTIME_CONFIG_VERSION,
  PREDICTION_V3_WORK_MODEL_VERSION,
  cohortPredictionRecordV3Schema,
  cohortPredictionSetManifestV3Schema,
  crossFittedCohortModelBundleV3Schema,
  type CohortPredictionRecordV3,
  type CohortPredictionResourceDiagnosticsV3,
  type CohortPredictionSetManifestV3,
  type CohortPredictionVerificationReceiptV3,
  type CrossFittedCohortModelBundleV3,
  type ProducedCrossFittedCohortPredictionSetV3,
  type VerifiedCrossFittedCohortPredictionSetV3,
  type VerifiedViewerClusterHoldoutPlanV1,
} from './contracts';
import {
  buildViewerClusterHoldoutPlanV1,
  isVerifiedViewerClusterHoldoutPlanV1,
  viewerClusterHoldoutPlanBindingV1,
  type ViewerClusterHoldoutPlanBindingV1,
} from './holdoutPlan';

const featureMapSchema = z.record(z.string(), z.number().finite());
const foldIdSchema = z.union([z.literal(0), z.literal(1)]);
const labelsSchema = z.object(Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [
  head,
  z.number().finite().min(0).max(1),
])) as Record<OfflineRewardHeadV1, z.ZodNumber>).strict();

const trainingSpoolRecordV3Schema = z.object({
  contractVersion: z.literal('cohort_prediction_training_spool_record_v3'),
  decisionId: z.string().uuid(),
  inferenceClusterId: z.string().trim().min(1).max(512),
  foldId: foldIdSchema,
  actionKey: z.object({
    candidateNamespace: z.enum(['serving_post_id', 'model_post_id']),
    candidateId: z.string().trim().min(1),
    servedPosition: z.number().int().positive().max(64),
  }).strict(),
  rowKey: z.string().trim().min(1),
  features: featureMapSchema,
  labels: labelsSchema.optional(),
}).strict();

type TrainingSpoolRecordV3 = z.infer<typeof trainingSpoolRecordV3Schema>;
type HeadModel = { intercept: number; coefficients: Record<string, number> };
type FoldModels = Record<OfflineRewardHeadV1, HeadModel>;
type CapturedInput = {
  targetEvidence: unknown;
  snapshot: unknown;
  decisionContextEvidence: unknown;
  decisions: unknown;
  rewardDefinition: unknown;
};
type NormalizedDecision = Readonly<{
  syntheticDecisionLog: SyntheticDecisionLogV1;
  outcomeEvidence: VerifiedSyntheticOutcomeEvidenceV1;
  syntheticDecisionLogSha256: string;
}>;
type NormalizedInput = Readonly<{
  targetEvidence: VerifiedTargetDistributionEvidenceV2;
  snapshot: VerifiedFullSupportPitActionSnapshotV2;
  decisionContextEvidence: VerifiedDecisionContextEvidenceV1;
  decisions: readonly NormalizedDecision[];
  rewardDefinition: z.infer<typeof offlineRewardDefinitionSchema>;
  holdoutPlan: VerifiedViewerClusterHoldoutPlanV1;
  holdoutBinding: ViewerClusterHoldoutPlanBindingV1;
  syntheticDecisionLogRootSha256: string;
  syntheticOutcomeEvidenceRootSha256: string;
  trainingConfigSha256: string;
  resourceLimitsSha256: string;
  runtimeConfigSha256: string;
}>;
export type CohortPredictionOpeSourceBindingV3 = Readonly<{
  targetEvidence: VerifiedTargetDistributionEvidenceV2;
  decisionContextEvidence: VerifiedDecisionContextEvidenceV1;
  decisions: readonly NormalizedDecision[];
  holdoutPlan: VerifiedViewerClusterHoldoutPlanV1;
  syntheticDecisionLogRootSha256: string;
  syntheticOutcomeEvidenceRootSha256: string;
}>;
type TargetStepSummary = Readonly<{
  servedPosition: number;
  prefixActionKeys: readonly VerifiedTargetDistributionStepV2['prefixActionKeys'][number][];
  actions: readonly VerifiedTargetDistributionStepV2['actions'][number][];
}>;
type TargetDecisionSummary = Readonly<{
  decisionId: string;
  requestId: string;
  decisionLogSha256: string;
  candidatePoolSha256: string;
  steps: readonly TargetStepSummary[];
}>;
type FoldInspection = Readonly<{
  foldId: 0 | 1;
  featureKeys: readonly string[];
  trainingInferenceClusterIds: readonly string[];
  holdoutInferenceClusterIds: readonly string[];
  trainingDecisionIds: readonly string[];
  holdoutDecisionIds: readonly string[];
  trainingRowKeys: readonly string[];
  holdoutRowKeys: readonly string[];
  trainingLabelRowCount: number;
  predictionRowCount: number;
}>;
type Preflight = Readonly<{
  targetDecisions: readonly TargetDecisionSummary[];
  trainingRecords: readonly TrainingSpoolRecordV3[];
  folds: readonly FoldInspection[];
  decisionCount: number;
  viewerClusterCount: number;
  slotCount: number;
  supportActionRowCount: number;
  candidateBaseRowCount: number;
  trainingRowCount: number;
  predictionRecordCount: number;
  combinedSpoolRecordCount: number;
  conservativeCombinedSpoolByteCount: number;
  maximumFoldFeatureCount: number;
  producerAndVerifierMathWorkUnits: number;
  targetEvidenceReplayRecords: number;
  snapshotEvidenceReplayRecords: number;
  trainingSpoolReplayRows: number;
  verificationPredictionStreamReadRows: number;
  verificationPredictionStreamComparisonRows: number;
  qHatAbsoluteBound: number;
}>;

export type ProduceCrossFittedCohortPredictionSetResultV3 =
  | Readonly<{ status: 'produced'; artifact: ProducedCrossFittedCohortPredictionSetV3 }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>;

export type VerifyCrossFittedCohortPredictionSetResultV3 =
  | Readonly<{ status: 'verified'; predictionSet: VerifiedCrossFittedCohortPredictionSetV3 }>
  | Readonly<{ status: 'not_evaluable'; blocker: string }>;

const TRAINING_CONFIG_V3 = Object.freeze({
  contractVersion: 'viewer_cluster_cross_fitted_training_config_v1',
  initialization: 'zeros_v1',
  loss: 'soft_label_binary_cross_entropy_v1',
  gradientReduction: 'mean_over_training_rows_v1',
  regularizeIntercept: false,
  classWeighting: 'none',
  shuffle: false,
  earlyStopping: false,
  featureDictionaryScope: 'training_viewers_per_fold_v1',
  foldCount: PREDICTION_V3_FOLD_COUNT,
  epochs: PREDICTION_V3_RUNTIME_CONFIG.epochs,
  learningRate: PREDICTION_V3_RUNTIME_CONFIG.learningRate,
  l2Lambda: PREDICTION_V3_RUNTIME_CONFIG.l2Lambda,
  headOrder: OFFLINE_REWARD_HEADS_V1,
  auxiliaryRowCount: 0,
});
const TARGET_EVIDENCE_REPLAY_PASSES = 4 as const;
const SNAPSHOT_EVIDENCE_REPLAY_PASSES = 2 as const;
const TRAINING_SPOOL_REPLAY_PASSES = 12 as const;
const RESOURCE_LIMITS_V3 = Object.freeze({
  limitsVersion: PREDICTION_V3_RESOURCE_LIMITS_VERSION,
  ...PREDICTION_V3_RESOURCE_LIMITS,
});
const SPOOL_LIMITS_V3 = Object.freeze({
  maxLineBytes: PREDICTION_V3_RESOURCE_LIMITS.maximumLineBytes,
  maxFileBytes: PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolBytes,
  maxRecords: PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolRecords,
});
const MAX_QHAT_ABSOLUTE_VALUE = 1e12;
const MAX_NUMERIC_WIRE_VALUE = 1.2345678901234567e-100;
const MAX_QHAT_WIRE_VALUE = -1.2345678901234567e-100;
const ZERO_SHA256 = '0'.repeat(64);

class SuppliedPredictionStreamError extends Error {}

const verifiedSets = new WeakSet<object>();
const verifiedSetDigests = new WeakMap<object, string>();
const verifiedSetBindings = new WeakMap<object, Readonly<{
  predictionStream: ByteStreamFactoryV2;
  spoolLimits: typeof SPOOL_LIMITS_V3;
  sources: NormalizedInput;
}>>();

const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left),
  Buffer.from(right),
);
const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const same = (left: unknown, right: unknown): boolean => (
  canonicalDecisionJson(left) === canonicalDecisionJson(right)
);
const actionIdentity = (value: TrainingSpoolRecordV3['actionKey']): string => (
  canonicalDecisionJson(value)
);
const rowKeyV3 = (decisionId: string, actionKey: TrainingSpoolRecordV3['actionKey']): string => [
  decisionId,
  actionKey.servedPosition.toString().padStart(2, '0'),
  actionIdentity(actionKey),
].join('\u0000');
const stepKeyV3 = (decisionId: string, servedPosition: number): string => (
  `${decisionId}\u0000${servedPosition}`
);

export async function produceCrossFittedCohortPredictionSetV3(
  raw: unknown,
): Promise<ProduceCrossFittedCohortPredictionSetResultV3> {
  const normalized = normalizeInput(raw);
  if ('blocker' in normalized) return reject(normalized.blocker);
  return buildArtifacts(normalized.input);
}

export async function verifyCrossFittedCohortPredictionSetV3(
  raw: unknown,
): Promise<VerifyCrossFittedCohortPredictionSetResultV3> {
  const normalized = normalizeInput(raw);
  if ('blocker' in normalized) return reject(normalized.blocker);
  const artifacts = captureArtifactInput(raw);
  if (!artifacts) return reject('prediction_v3_artifact_contract_invalid');
  if (
    Buffer.byteLength(artifacts.modelBundleRaw) - 1
      > PREDICTION_V3_RESOURCE_LIMITS.maximumLineBytes
    || Buffer.byteLength(artifacts.predictionSetManifestRaw) - 1
      > PREDICTION_V3_RESOURCE_LIMITS.maximumLineBytes
  ) return reject('resource_limit_exceeded');
  const suppliedBundle = parseCanonicalSingle(
    artifacts.modelBundleRaw,
    crossFittedCohortModelBundleV3Schema,
  );
  const suppliedManifest = parseCanonicalSingle(
    artifacts.predictionSetManifestRaw,
    cohortPredictionSetManifestV3Schema,
  );
  if (!suppliedBundle || !suppliedManifest || typeof artifacts.predictionStream !== 'function') {
    return reject('prediction_v3_artifact_contract_invalid');
  }

  const rebuilt = await buildArtifacts(normalized.input);
  if (rebuilt.status !== 'produced') return rebuilt;
  try {
    if (
      artifacts.modelBundleRaw !== rebuilt.artifact.modelBundleRaw
      || artifacts.predictionSetManifestRaw !== rebuilt.artifact.predictionSetManifestRaw
      || !same(suppliedBundle, rebuilt.artifact.bundle)
      || !same(suppliedManifest, rebuilt.artifact.manifest)
    ) return reject('prediction_v3_retraining_mismatch');
    const verifiedPredictionStream = await compareAndCaptureCanonicalStreams(
      artifacts.predictionStream,
      rebuilt.artifact.predictionStream,
    );
    if (!verifiedPredictionStream) return reject('prediction_v3_stream_mismatch');

    const diagnostics = rebuilt.artifact.diagnostics;
    const receiptPreimage = {
      contractVersion: 'cross_fitted_cohort_prediction_verification_receipt_v3' as const,
      verifierVersion: 'cross_fitted_cohort_prediction_set_verifier_v3' as const,
      predictionSetVersion: suppliedManifest.predictionSetVersion,
      modelBundleSha256: suppliedBundle.modelBundleSha256,
      predictionStreamSha256: suppliedManifest.predictionStreamSha256,
      snapshotManifestSha256: suppliedManifest.snapshotManifestSha256,
      targetManifestSha256: suppliedManifest.targetManifestSha256,
      targetVerificationReceiptSha256: suppliedManifest.targetVerificationReceiptSha256,
      decisionContextEvidenceSha256: suppliedManifest.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256: suppliedManifest.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256: suppliedManifest.syntheticOutcomeEvidenceRootSha256,
      holdoutPlanSha256: suppliedManifest.holdoutPlanSha256,
      trainingConfigSha256: suppliedManifest.trainingConfigSha256,
      resourceLimitsVersion: PREDICTION_V3_RESOURCE_LIMITS_VERSION,
      resourceLimitsSha256: suppliedManifest.resourceLimitsSha256,
      runtimeConfigVersion: PREDICTION_V3_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: suppliedManifest.runtimeConfigSha256,
      rowOrder: PREDICTION_V3_ROW_ORDER,
      rewardDefinitionSha256: suppliedManifest.rewardDefinitionSha256,
      decisionCount: suppliedManifest.decisionCount,
      viewerClusterCount: suppliedManifest.viewerClusterCount,
      stepCount: suppliedManifest.stepCount,
      predictionCount: suppliedManifest.predictionCount,
      trainingRowCount: suppliedManifest.trainingRowCount,
      combinedSpoolRecordCount: diagnostics.combinedSpoolRecordCount,
      combinedSpoolByteCount: diagnostics.combinedSpoolByteCount,
      workModelVersion: diagnostics.workModelVersion,
      producerAndVerifierMathWorkUnits: diagnostics.producerAndVerifierMathWorkUnits,
      targetEvidenceReplayPasses: diagnostics.targetEvidenceReplayPasses,
      targetEvidenceReplayRecords: diagnostics.targetEvidenceReplayRecords,
      snapshotEvidenceReplayPasses: diagnostics.snapshotEvidenceReplayPasses,
      snapshotEvidenceReplayRecords: diagnostics.snapshotEvidenceReplayRecords,
      trainingSpoolReplayPasses: diagnostics.trainingSpoolReplayPasses,
      trainingSpoolReplayRows: diagnostics.trainingSpoolReplayRows,
      verificationPredictionStreamReadRows:
        diagnostics.verificationPredictionStreamReadRows,
      verificationPredictionStreamComparisonRows:
        diagnostics.verificationPredictionStreamComparisonRows,
    };
    const receipt: CohortPredictionVerificationReceiptV3 = recursivelyFreeze({
      ...receiptPreimage,
      receiptSha256: digest(receiptPreimage),
    });
    const predictionSet = recursivelyFreeze({
      contractVersion: 'verified_cross_fitted_cohort_prediction_set_v3' as const,
      holdoutPlan: rebuilt.artifact.holdoutPlan,
      manifest: suppliedManifest,
      receipt,
      realDatasetEligible: false as const,
      servable: false as const,
    });
    verifiedSets.add(predictionSet);
    verifiedSetDigests.set(predictionSet, digest(predictionSet));
    verifiedSetBindings.set(predictionSet, recursivelyFreeze({
      predictionStream: verifiedPredictionStream,
      spoolLimits: SPOOL_LIMITS_V3,
      sources: normalized.input,
    }));
    return recursivelyFreeze({ status: 'verified' as const, predictionSet });
  } catch (error) {
    return reject(stableBlocker(error));
  } finally {
    await rebuilt.artifact.dispose().catch(() => undefined);
  }
}

export function isVerifiedCrossFittedCohortPredictionSetV3(
  value: unknown,
): value is VerifiedCrossFittedCohortPredictionSetV3 {
  try {
    if (!value || typeof value !== 'object' || !verifiedSets.has(value)) return false;
    const candidate = value as VerifiedCrossFittedCohortPredictionSetV3;
    const binding = verifiedSetBindings.get(value);
    return binding !== undefined
      && recursivelyFrozen(candidate)
      && verifiedSetDigests.get(value) === digest(candidate)
      && isVerifiedViewerClusterHoldoutPlanV1(candidate.holdoutPlan)
      && sourcesStillVerified(binding.sources);
  } catch {
    return false;
  }
}

export function cohortPredictionSetReplayBindingV3(
  value: unknown,
): Readonly<{
  predictionStream: ByteStreamFactoryV2;
  spoolLimits: typeof SPOOL_LIMITS_V3;
}> | undefined {
  if (!isVerifiedCrossFittedCohortPredictionSetV3(value)) return undefined;
  const binding = verifiedSetBindings.get(value);
  if (!binding) return undefined;
  return Object.freeze({
    predictionStream: binding.predictionStream,
    spoolLimits: binding.spoolLimits,
  });
}

// Intentionally omitted from predictionV3/index.ts. This capability is only for
// same-process synthetic OPE replay over the exact sources retained by the verifier.
export function cohortPredictionSetOpeSourceBindingV3(
  value: unknown,
): CohortPredictionOpeSourceBindingV3 | undefined {
  if (!isVerifiedCrossFittedCohortPredictionSetV3(value)) return undefined;
  const sources = verifiedSetBindings.get(value)?.sources;
  if (!sources) return undefined;
  return Object.freeze({
    targetEvidence: sources.targetEvidence,
    decisionContextEvidence: sources.decisionContextEvidence,
    decisions: sources.decisions,
    holdoutPlan: sources.holdoutPlan,
    syntheticDecisionLogRootSha256: sources.syntheticDecisionLogRootSha256,
    syntheticOutcomeEvidenceRootSha256: sources.syntheticOutcomeEvidenceRootSha256,
  });
}

async function buildArtifacts(
  input: NormalizedInput,
): Promise<ProduceCrossFittedCohortPredictionSetResultV3> {
  let trainingSpool: CanonicalSpoolV2 | undefined;
  let predictionSpool: CanonicalSpoolV2 | undefined;
  try {
    const checked = await preflight(input);
    if ('blocker' in checked) return reject(checked.blocker);
    const plan = checked.preflight;

    trainingSpool = await writeTrainingSpool(plan.trainingRecords);
    const trained = await trainFromSpool(trainingSpool, plan);
    if ('blocker' in trained) return reject(trained.blocker);

    const rewardDefinitionSha256 = digest(input.rewardDefinition);
    const bundlePreimage = {
      contractVersion: 'cross_fitted_cohort_model_bundle_v3' as const,
      datasetVersion: input.targetEvidence.manifest.datasetVersion,
      snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
      targetManifestSha256: input.targetEvidence.targetManifestSha256,
      targetVerificationReceiptSha256: input.targetEvidence.receipt.verificationReceiptSha256,
      decisionContextEvidenceSha256:
        input.decisionContextEvidence.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256: input.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256: input.syntheticOutcomeEvidenceRootSha256,
      holdoutPlanSha256: input.holdoutPlan.holdoutPlanSha256,
      trainingSpoolSha256: trainingSpool.sha256,
      trainingConfigSha256: input.trainingConfigSha256,
      resourceLimitsVersion: PREDICTION_V3_RESOURCE_LIMITS_VERSION,
      resourceLimitsSha256: input.resourceLimitsSha256,
      runtimeConfigVersion: PREDICTION_V3_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: input.runtimeConfigSha256,
      rowOrder: PREDICTION_V3_ROW_ORDER,
      rewardDefinitionSha256,
      foldCount: PREDICTION_V3_FOLD_COUNT,
      auxiliaryRowCount: 0 as const,
      folds: trained.folds,
      crossFitted: true as const,
      sameViewerLeakageExcluded: true as const,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    const parsedBundle = crossFittedCohortModelBundleV3Schema.safeParse({
      ...bundlePreimage,
      modelBundleSha256: digest(bundlePreimage),
    });
    if (!parsedBundle.success) return reject('prediction_v3_model_bundle_invalid');
    const bundle = parsedBundle.data;
    assertCanonicalLineWithinLimit(bundle);

    const predicted = await writePredictionSpool(input, plan, bundle, trained.models);
    if ('blocker' in predicted) return reject(predicted.blocker);
    predictionSpool = predicted.spool;
    const combinedSpoolRecordCount = trainingSpool.recordCount + predictionSpool.recordCount;
    const combinedSpoolByteCount = trainingSpool.byteCount + predictionSpool.byteCount;
    if (
      combinedSpoolRecordCount !== plan.combinedSpoolRecordCount
      || combinedSpoolRecordCount > PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolRecords
      || combinedSpoolByteCount > plan.conservativeCombinedSpoolByteCount
      || combinedSpoolByteCount > PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolBytes
    ) return reject('resource_limit_exceeded');

    const manifestPreimage = {
      contractVersion: 'cross_fitted_cohort_prediction_set_manifest_v3' as const,
      datasetVersion: input.targetEvidence.manifest.datasetVersion,
      predictionStreamSha256: predictionSpool.sha256,
      physicalRecordCount: predictionSpool.recordCount,
      decisionCount: plan.decisionCount,
      viewerClusterCount: plan.viewerClusterCount,
      stepCount: plan.slotCount,
      predictionCount: predicted.predictionCount,
      candidateBaseCount: plan.candidateBaseRowCount,
      trainingRowCount: plan.trainingRowCount,
      auxiliaryRowCount: 0 as const,
      modelBundleSha256: bundle.modelBundleSha256,
      snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
      targetManifestSha256: input.targetEvidence.targetManifestSha256,
      targetVerificationReceiptSha256: input.targetEvidence.receipt.verificationReceiptSha256,
      decisionContextEvidenceSha256:
        input.decisionContextEvidence.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256: input.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256: input.syntheticOutcomeEvidenceRootSha256,
      holdoutPlanSha256: input.holdoutPlan.holdoutPlanSha256,
      trainingConfigSha256: input.trainingConfigSha256,
      resourceLimitsVersion: PREDICTION_V3_RESOURCE_LIMITS_VERSION,
      resourceLimitsSha256: input.resourceLimitsSha256,
      runtimeConfigVersion: PREDICTION_V3_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: input.runtimeConfigSha256,
      rowOrder: PREDICTION_V3_ROW_ORDER,
      rewardDefinitionSha256,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    const parsedManifest = cohortPredictionSetManifestV3Schema.safeParse({
      ...manifestPreimage,
      predictionSetVersion: digest(manifestPreimage),
    });
    if (!parsedManifest.success) return reject('prediction_v3_manifest_invalid');
    const manifest = parsedManifest.data;
    assertCanonicalLineWithinLimit(manifest);

    const modelBundleRaw = `${canonicalWireJsonV1(bundle)}\n`;
    const predictionSetManifestRaw = `${canonicalWireJsonV1(manifest)}\n`;
    const diagnostics: CohortPredictionResourceDiagnosticsV3 = recursivelyFreeze({
      preflightCompletedBeforeSpool: true as const,
      decisionCount: plan.decisionCount,
      viewerClusterCount: plan.viewerClusterCount,
      slotCount: plan.slotCount,
      supportActionRowCount: plan.supportActionRowCount,
      candidateBaseRowCount: plan.candidateBaseRowCount,
      trainingRowCount: plan.trainingRowCount,
      predictionRecordCount: plan.predictionRecordCount,
      combinedSpoolRecordCount,
      combinedSpoolByteCount,
      peakLineBytes: Math.max(trainingSpool.peakLineBytes, predictionSpool.peakLineBytes),
      maximumFoldFeatureCount: plan.maximumFoldFeatureCount,
      workModelVersion: PREDICTION_V3_WORK_MODEL_VERSION,
      producerAndVerifierMathWorkUnits: plan.producerAndVerifierMathWorkUnits,
      targetEvidenceReplayPasses: 4 as const,
      targetEvidenceReplayRecords: plan.targetEvidenceReplayRecords,
      snapshotEvidenceReplayPasses: 2 as const,
      snapshotEvidenceReplayRecords: plan.snapshotEvidenceReplayRecords,
      trainingSpoolReplayPasses: 12 as const,
      trainingSpoolReplayRows: plan.trainingSpoolReplayRows,
      verificationPredictionStreamReadRows: plan.verificationPredictionStreamReadRows,
      verificationPredictionStreamComparisonRows:
        plan.verificationPredictionStreamComparisonRows,
    });
    const ownedPredictionSpool = predictionSpool;
    predictionSpool = undefined;
    return recursivelyFreeze({
      status: 'produced' as const,
      artifact: {
        contractVersion: 'produced_cross_fitted_cohort_prediction_set_v3' as const,
        holdoutPlan: input.holdoutPlan,
        bundle,
        modelBundleRaw,
        manifest,
        predictionSetManifestRaw,
        predictionStream: ownedPredictionSpool.stream,
        artifactState: 'pre_publish' as const,
        diagnostics,
        dispose: ownedPredictionSpool.cleanup,
      },
    });
  } catch (error) {
    return reject(stableBlocker(error));
  } finally {
    await trainingSpool?.cleanup().catch(() => undefined);
    await predictionSpool?.cleanup().catch(() => undefined);
  }
}

function normalizeInput(raw: unknown):
  | Readonly<{ input: NormalizedInput }>
  | Readonly<{ blocker: string }> {
  const captured = captureInput(raw);
  if (!captured) return { blocker: 'prediction_v3_input_contract_invalid' };
  try {
    if (!isVerifiedTargetDistributionEvidenceV2(captured.targetEvidence)) {
      return { blocker: 'target_verified_brand_missing' };
    }
    if (!isVerifiedFullSupportPitActionSnapshotV2(captured.snapshot)) {
      return { blocker: 'snapshot_verified_brand_missing' };
    }
    if (!isVerifiedDecisionContextEvidenceV1(captured.decisionContextEvidence)) {
      return { blocker: 'prediction_v3_decision_context_unverified' };
    }
    const targetEvidence = captured.targetEvidence;
    const snapshot = captured.snapshot;
    const decisionContextEvidence = captured.decisionContextEvidence;
    if (
      snapshot.targetDistributionNdjsonSha256
        !== targetEvidence.receipt.distributionNdjsonSha256
      || snapshot.manifest.targetManifestSha256 !== targetEvidence.targetManifestSha256
      || snapshot.manifest.targetVerificationReceiptSha256
        !== targetEvidence.receipt.verificationReceiptSha256
    ) return { blocker: 'prediction_v3_target_snapshot_binding_mismatch' };

    const reward = offlineRewardDefinitionSchema.safeParse(captured.rewardDefinition);
    if (!reward.success) return { blocker: 'prediction_v3_reward_contract_invalid' };
    if (!Array.isArray(captured.decisions)) {
      return { blocker: 'prediction_v3_input_contract_invalid' };
    }
    const decisionCount = Reflect.get(captured.decisions, 'length');
    if (
      !Number.isSafeInteger(decisionCount)
      || decisionCount === 0
      || decisionCount > PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions
    ) return { blocker: 'resource_limit_exceeded' };
    const rawDecisions: unknown[] = [];
    for (let index = 0; index < decisionCount; index += 1) {
      rawDecisions.push(Reflect.get(captured.decisions, String(index)));
    }

    const normalizedDecisions: NormalizedDecision[] = [];
    const seenDecisionIds = new Set<string>();
    for (const rawDecision of rawDecisions) {
      const capturedDecision = captureDecisionInput(rawDecision);
      if (!capturedDecision) return { blocker: 'prediction_v3_input_contract_invalid' };
      const parsedLog = syntheticDecisionLogV1Schema.safeParse(
        capturedDecision.syntheticDecisionLog,
      );
      if (!parsedLog.success) return { blocker: 'prediction_v3_decision_log_invalid' };
      if (!isVerifiedSyntheticOutcomeEvidenceV1(capturedDecision.outcomeEvidence)) {
        return { blocker: 'verified_synthetic_outcome_required' };
      }
      const log = parsedLog.data;
      const outcome = capturedDecision.outcomeEvidence;
      const logSha256 = digest(log);
      const { contractVersion: _ignored, ...rewardWithoutContract } = reward.data;
      if (
        seenDecisionIds.has(log.decisionId)
        || outcome.decisionId !== log.decisionId
        || outcome.requestId !== log.requestId
        || outcome.syntheticDecisionLogSha256 !== logSha256
        || outcome.objective !== reward.data.objective
        || !same(outcome.rewardDefinition, rewardWithoutContract)
      ) return { blocker: 'prediction_v3_decision_binding_mismatch' };
      seenDecisionIds.add(log.decisionId);
      normalizedDecisions.push(recursivelyFreeze({
        syntheticDecisionLog: recursivelyFreeze(log),
        outcomeEvidence: outcome,
        syntheticDecisionLogSha256: logSha256,
      }));
    }
    normalizedDecisions.sort((left, right) => compareText(
      left.syntheticDecisionLog.decisionId,
      right.syntheticDecisionLog.decisionId,
    ));

    const contextByDecisionId = new Map(decisionContextEvidence.decisions.map((entry) => [
      entry.decisionId,
      entry,
    ]));
    const canonicalSegments = decisionContextEvidence.decisions[0]?.segments;
    if (
      contextByDecisionId.size !== normalizedDecisions.length
      || decisionContextEvidence.datasetVersion !== targetEvidence.manifest.datasetVersion
      || canonicalSegments === undefined
      || decisionContextEvidence.decisions.some((entry) => !same(
        entry.segments,
        canonicalSegments,
      ))
    ) return { blocker: 'prediction_v3_source_membership_mismatch' };
    for (const entry of normalizedDecisions) {
      const log = entry.syntheticDecisionLog;
      const context = contextByDecisionId.get(log.decisionId);
      if (
        !context
        || context.requestId !== log.requestId
        || context.decisionAt !== log.decisionAt
        || context.decisionLogSha256 !== log.sourceDecisionLogSha256
        || context.candidatePoolSha256 !== log.sourceCandidatePoolSha256
        || decisionLogSha256(context.decisionLog) !== context.decisionLogSha256
        || entry.outcomeEvidence.datasetVersion !== decisionContextEvidence.datasetVersion
      ) return { blocker: 'prediction_v3_decision_binding_mismatch' };
      if (
        context.subject.kind !== 'viewer'
        || entry.outcomeEvidence.traceUserId !== context.subject.viewerAccountPseudonym
      ) return { blocker: 'prediction_v3_viewer_identity_mismatch' };
    }

    if (
      targetEvidence.manifest.decisionCount !== normalizedDecisions.length
      || snapshot.manifest.decisionCount !== normalizedDecisions.length
      || targetEvidence.manifest.stepCount < 1
      || targetEvidence.manifest.stepCount > PREDICTION_V3_RESOURCE_LIMITS.maximumSlots
      || targetEvidence.manifest.actionProbabilityCount < 1
      || targetEvidence.manifest.actionProbabilityCount
        > PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows
      || snapshot.manifest.candidateBaseCount < 1
      || snapshot.manifest.candidateBaseCount
        > PREDICTION_V3_RESOURCE_LIMITS.maximumCandidateBaseRows
    ) return { blocker: 'resource_limit_exceeded' };

    const planResult = buildViewerClusterHoldoutPlanV1({ decisionContextEvidence });
    if (planResult.status !== 'verified') return { blocker: planResult.blocker };
    const holdoutBinding = viewerClusterHoldoutPlanBindingV1(planResult.plan);
    if (!holdoutBinding) return { blocker: 'prediction_v3_fold_contract_invalid' };

    const syntheticDecisionLogRootSha256 = digest({
      contractVersion: 'synthetic_decision_log_cohort_root_v1',
      members: normalizedDecisions.map((entry) => ({
        decisionId: entry.syntheticDecisionLog.decisionId,
        syntheticDecisionLogSha256: entry.syntheticDecisionLogSha256,
      })),
    });
    const syntheticOutcomeEvidenceRootSha256 = digest({
      contractVersion: 'synthetic_outcome_evidence_cohort_root_v1',
      members: normalizedDecisions.map((entry) => ({
        decisionId: entry.syntheticDecisionLog.decisionId,
        syntheticOutcomeEvidenceSha256:
          entry.outcomeEvidence.syntheticOutcomeEvidenceSha256,
      })),
    });
    return {
      input: recursivelyFreeze({
        targetEvidence,
        snapshot,
        decisionContextEvidence,
        decisions: normalizedDecisions,
        rewardDefinition: recursivelyFreeze(reward.data),
        holdoutPlan: planResult.plan,
        holdoutBinding,
        syntheticDecisionLogRootSha256,
        syntheticOutcomeEvidenceRootSha256,
        trainingConfigSha256: digest(TRAINING_CONFIG_V3),
        resourceLimitsSha256: digest(RESOURCE_LIMITS_V3),
        runtimeConfigSha256: digest(PREDICTION_V3_RUNTIME_CONFIG),
      }),
    };
  } catch {
    return { blocker: 'prediction_v3_input_contract_invalid' };
  }
}

async function preflight(
  input: NormalizedInput,
): Promise<Readonly<{ preflight: Preflight }> | Readonly<{ blocker: string }>> {
  const targetResult = await collectTargetSummaries(input);
  if ('blocker' in targetResult) return targetResult;
  const trainingResult = await collectTrainingRecords(input, targetResult.targetDecisions);
  if ('blocker' in trainingResult) return trainingResult;
  try {
    const targetDecisions = targetResult.targetDecisions;
    const trainingRecords = trainingResult.trainingRecords;
    const folds = inspectFolds(input, trainingRecords);
    if ('blocker' in folds) return folds;
    const decisionCount = targetDecisions.length;
    const viewerClusterCount = input.holdoutPlan.viewerClusterCount;
    const slotCount = targetDecisions.reduce((sum, entry) => sum + entry.steps.length, 0);
    const supportActionRowCount = trainingRecords.length;
    const candidateBaseRowCount = input.snapshot.manifest.candidateBaseCount;
    const trainingRowCount = supportActionRowCount;
    const predictionRecordCount = supportActionRowCount + 2 * slotCount + 2 * decisionCount;
    const combinedSpoolRecordCount = trainingRowCount + predictionRecordCount;
    if (
      ![
        decisionCount,
        viewerClusterCount,
        slotCount,
        supportActionRowCount,
        candidateBaseRowCount,
        predictionRecordCount,
        combinedSpoolRecordCount,
      ].every(Number.isSafeInteger)
      || decisionCount > PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions
      || viewerClusterCount < PREDICTION_V3_RESOURCE_LIMITS.minimumViewerClusters
      || viewerClusterCount > PREDICTION_V3_RESOURCE_LIMITS.maximumViewerClusters
      || slotCount > PREDICTION_V3_RESOURCE_LIMITS.maximumSlots
      || supportActionRowCount > PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows
      || candidateBaseRowCount > PREDICTION_V3_RESOURCE_LIMITS.maximumCandidateBaseRows
      || combinedSpoolRecordCount
        > PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolRecords
    ) return { blocker: 'resource_limit_exceeded' };

    const qHatAbsoluteBound = deriveQHatAbsoluteBound(input.rewardDefinition);
    if (
      !Number.isFinite(qHatAbsoluteBound)
      || qHatAbsoluteBound > MAX_QHAT_ABSOLUTE_VALUE
      || !numericTrainingEnvelopeIsFinite(folds.folds)
    ) return { blocker: 'prediction_v3_numerical_bound_invalid' };

    const producerAndVerifierMathWorkUnits = calculateProducerAndVerifierMathWorkUnits(
      folds.folds,
      supportActionRowCount,
    );
    const targetEvidenceReplayRecords = TARGET_EVIDENCE_REPLAY_PASSES
      * (input.targetEvidence.receipt.verifiedPhysicalRecordCount
        + input.targetEvidence.receipt.verifiedDecisionCount);
    const snapshotEvidenceReplayRecords = SNAPSHOT_EVIDENCE_REPLAY_PASSES
      * input.snapshot.manifest.physicalRecordCount;
    const trainingSpoolReplayRows = TRAINING_SPOOL_REPLAY_PASSES * trainingRowCount;
    const verificationPredictionStreamReadRows = 2 * predictionRecordCount;
    const verificationPredictionStreamComparisonRows = predictionRecordCount;
    if (
      ![
        producerAndVerifierMathWorkUnits,
        targetEvidenceReplayRecords,
        snapshotEvidenceReplayRecords,
        trainingSpoolReplayRows,
        verificationPredictionStreamReadRows,
        verificationPredictionStreamComparisonRows,
      ].every(Number.isSafeInteger)
      || producerAndVerifierMathWorkUnits
        > PREDICTION_V3_RESOURCE_LIMITS.maximumProducerAndVerifierMathWorkUnits
    ) return { blocker: 'resource_limit_exceeded' };

    const maximumFoldFeatureCount = Math.max(
      ...folds.folds.map((fold) => fold.featureKeys.length),
    );
    const conservativeCombinedSpoolByteCount = estimateConservativeSpoolBytes(
      input,
      targetDecisions,
      trainingRecords,
      trainingResult.trainingCanonicalBytes,
      qHatAbsoluteBound,
    );
    assertConservativeModelAndManifestLines(input, folds.folds, targetDecisions);
    if (
      conservativeCombinedSpoolByteCount
        > PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolBytes
    ) return { blocker: 'resource_limit_exceeded' };

    return {
      preflight: recursivelyFreeze({
        targetDecisions,
        trainingRecords,
        folds: folds.folds,
        decisionCount,
        viewerClusterCount,
        slotCount,
        supportActionRowCount,
        candidateBaseRowCount,
        trainingRowCount,
        predictionRecordCount,
        combinedSpoolRecordCount,
        conservativeCombinedSpoolByteCount,
        maximumFoldFeatureCount,
        producerAndVerifierMathWorkUnits,
        targetEvidenceReplayRecords,
        snapshotEvidenceReplayRecords,
        trainingSpoolReplayRows,
        verificationPredictionStreamReadRows,
        verificationPredictionStreamComparisonRows,
        qHatAbsoluteBound,
      }),
    };
  } catch (error) {
    return { blocker: stableBlocker(error) };
  }
}

async function collectTargetSummaries(
  input: NormalizedInput,
): Promise<Readonly<{ targetDecisions: readonly TargetDecisionSummary[] }>
  | Readonly<{ blocker: string }>> {
  const contexts = new Map(input.decisionContextEvidence.decisions.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const decisions = new Map(input.decisions.map((entry) => [
    entry.syntheticDecisionLog.decisionId,
    entry,
  ]));
  const summaries = new Map<string, {
    decisionId: string;
    requestId: string;
    decisionLogSha256: string;
    candidatePoolSha256: string;
    steps: TargetStepSummary[];
  }>();
  let currentDecisionId: string | undefined;
  let localBlocker: string | undefined;
  const replay = await replayVerifiedTargetDistributionV2(input.targetEvidence, {
    onDecisionStart: (decision: VerifiedTargetDistributionDecisionV2) => {
      try {
        const context = contexts.get(decision.source.decisionId);
        const source = decisions.get(decision.source.decisionId);
        if (
          currentDecisionId !== undefined
          || summaries.has(decision.source.decisionId)
          || !context
          || !source
          || decision.source.requestId !== context.requestId
          || decision.source.decisionAt !== context.decisionAt
          || decision.decisionLogSha256 !== context.decisionLogSha256
          || decision.candidatePoolSha256 !== context.candidatePoolSha256
          || source.syntheticDecisionLog.sourceDecisionLogSha256
            !== decision.decisionLogSha256
          || source.syntheticDecisionLog.sourceCandidatePoolSha256
            !== decision.candidatePoolSha256
        ) throw new Error('prediction_v3_decision_binding_mismatch');
        currentDecisionId = decision.source.decisionId;
        summaries.set(currentDecisionId, {
          decisionId: currentDecisionId,
          requestId: decision.source.requestId,
          decisionLogSha256: decision.decisionLogSha256,
          candidatePoolSha256: decision.candidatePoolSha256,
          steps: [],
        });
      } catch (error) {
        localBlocker = stableBlocker(error);
        throw error;
      }
    },
    onStep: (_decision, step: VerifiedTargetDistributionStepV2) => {
      try {
        const summary = currentDecisionId ? summaries.get(currentDecisionId) : undefined;
        if (
          !summary
          || step.servedPosition !== summary.steps.length + 1
          || step.actions.length === 0
          || step.actions.some((entry) => entry.actionKey.servedPosition !== step.servedPosition)
          || new Set(step.actions.map((entry) => actionIdentity(entry.actionKey))).size
            !== step.actions.length
        ) throw new Error('prediction_v3_target_order_invalid');
        summary.steps.push({
          servedPosition: step.servedPosition,
          prefixActionKeys: [...step.prefixActionKeys],
          actions: [...step.actions].sort((left, right) => compareText(
            actionIdentity(left.actionKey),
            actionIdentity(right.actionKey),
          )),
        });
      } catch (error) {
        localBlocker = stableBlocker(error);
        throw error;
      }
    },
    onDecisionEnd: (decision) => {
      try {
        if (currentDecisionId !== decision.source.decisionId) {
          throw new Error('prediction_v3_target_order_invalid');
        }
        currentDecisionId = undefined;
      } catch (error) {
        localBlocker = stableBlocker(error);
        throw error;
      }
    },
    commit: () => undefined,
    abort: () => undefined,
  });
  if (replay.status !== 'verified') {
    return { blocker: localBlocker ?? replay.blocker };
  }
  const ordered = [...summaries.values()].sort((left, right) => compareText(
    left.decisionId,
    right.decisionId,
  ));
  if (currentDecisionId !== undefined || ordered.length !== input.decisions.length) {
    return { blocker: 'prediction_v3_source_membership_mismatch' };
  }
  for (const summary of ordered) {
    const source = decisions.get(summary.decisionId);
    if (!source || source.syntheticDecisionLog.actions.length !== summary.steps.length) {
      return { blocker: 'prediction_v3_target_membership_mismatch' };
    }
    for (const [index, logged] of source.syntheticDecisionLog.actions.entries()) {
      const step = summary.steps[index];
      const expectedPrefix = source.syntheticDecisionLog.actions
        .slice(0, index)
        .map((entry) => entry.actionKey);
      if (
        !step
        || !same(step.prefixActionKeys, expectedPrefix)
        || !step.actions.some((entry) => same(entry.actionKey, logged.actionKey))
      ) {
        return { blocker: 'prediction_v3_target_membership_mismatch' };
      }
    }
  }
  return { targetDecisions: recursivelyFreeze(ordered) };
}

async function collectTrainingRecords(
  input: NormalizedInput,
  targetDecisions: readonly TargetDecisionSummary[],
): Promise<Readonly<{
  trainingRecords: readonly TrainingSpoolRecordV3[];
  trainingCanonicalBytes: number;
}>
  | Readonly<{ blocker: string }>> {
  const targets = new Map(targetDecisions.map((decision) => [decision.decisionId, decision]));
  const targetActionIdentities = new Map<string, ReadonlySet<string>>();
  for (const decision of targetDecisions) {
    for (const step of decision.steps) {
      targetActionIdentities.set(
        stepKeyV3(decision.decisionId, step.servedPosition),
        new Set(step.actions.map((entry) => actionIdentity(entry.actionKey))),
      );
    }
  }
  const contexts = new Map(input.decisionContextEvidence.decisions.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const decisions = new Map(input.decisions.map((entry) => [
    entry.syntheticDecisionLog.decisionId,
    entry,
  ]));
  const outcomesByDecision = new Map(input.decisions.map((entry) => [
    entry.syntheticDecisionLog.decisionId,
    new Map(entry.outcomeEvidence.outcomes.map((outcome) => [
      actionIdentity(outcome.actionKey),
      outcome,
    ])),
  ]));
  const recordsByKey = new Map<string, TrainingSpoolRecordV3>();
  const seenOutcomes = new Map<string, Set<string>>();
  let trainingCanonicalBytes = 0;
  let localBlocker: string | undefined;
  const replay = await replayVerifiedSnapshotPositionFeaturesV2(
    input.snapshot,
    input.targetEvidence,
    {
      onPositionFeature: (feature: ExpandedSnapshotPositionFeatureV2) => {
        try {
          const target = targets.get(feature.decisionId);
          const context = contexts.get(feature.decisionId);
          const decision = decisions.get(feature.decisionId);
          const foldId = input.holdoutBinding.foldIdByDecisionId.get(feature.decisionId);
          const step = target?.steps[feature.servedPosition - 1];
          const identity = actionIdentity(feature.row.actionKey);
          if (
            !target
            || !context
            || !decision
            || foldId === undefined
            || step?.servedPosition !== feature.servedPosition
            || feature.row.decisionId !== feature.decisionId
            || !targetActionIdentities.get(
              stepKeyV3(feature.decisionId, feature.servedPosition),
            )?.has(identity)
          ) throw new Error('prediction_v3_snapshot_membership_mismatch');
          const key = rowKeyV3(feature.decisionId, feature.row.actionKey);
          if (recordsByKey.has(key)) throw new Error('prediction_v3_snapshot_membership_mismatch');
          const features = validateAndCanonicalizeFeatures(feature.row.features);
          const outcome = outcomesByDecision.get(feature.decisionId)?.get(identity);
          if (outcome) {
            const seen = seenOutcomes.get(feature.decisionId) ?? new Set<string>();
            seen.add(identity);
            seenOutcomes.set(feature.decisionId, seen);
          }
          const parsed = trainingSpoolRecordV3Schema.safeParse({
            contractVersion: 'cohort_prediction_training_spool_record_v3',
            decisionId: feature.decisionId,
            inferenceClusterId: context.inferenceClusterId,
            foldId,
            actionKey: feature.row.actionKey,
            rowKey: key,
            features,
            ...(outcome ? {
              labels: encodeOfflineLabelsV1(
                outcome.outcome.labels,
                input.rewardDefinition.dwell.capMs,
              ),
            } : {}),
          });
          if (!parsed.success) throw new Error('prediction_v3_training_row_invalid');
          const rowBytes = canonicalLineBytes(parsed.data);
          if (
            rowBytes > PREDICTION_V3_RESOURCE_LIMITS.maximumCombinedSpoolBytes
              - trainingCanonicalBytes
          ) throw new Error('resource_limit_exceeded');
          trainingCanonicalBytes += rowBytes;
          recordsByKey.set(key, parsed.data);
          if (recordsByKey.size > PREDICTION_V3_RESOURCE_LIMITS.maximumSupportActionRows) {
            throw new Error('resource_limit_exceeded');
          }
        } catch (error) {
          localBlocker = stableBlocker(error);
          throw error;
        }
      },
      commit: () => undefined,
      abort: () => undefined,
    },
  );
  if (replay.status !== 'verified') return { blocker: localBlocker ?? replay.blocker };
  const records: TrainingSpoolRecordV3[] = [];
  for (const decision of targetDecisions) {
    for (const step of decision.steps) {
      for (const action of step.actions) {
        const record = recordsByKey.get(rowKeyV3(decision.decisionId, action.actionKey));
        if (!record) return { blocker: 'prediction_v3_snapshot_membership_mismatch' };
        records.push(record);
      }
    }
  }
  const expectedRows = targetDecisions.reduce((sum, decision) => sum + decision.steps.reduce(
    (stepSum, step) => stepSum + step.actions.length,
    0,
  ), 0);
  if (records.length !== expectedRows) {
    return { blocker: 'prediction_v3_snapshot_membership_mismatch' };
  }
  for (const decision of input.decisions) {
    const decisionId = decision.syntheticDecisionLog.decisionId;
    if ((seenOutcomes.get(decisionId)?.size ?? 0) !== decision.outcomeEvidence.outcomes.length) {
      return { blocker: 'prediction_v3_target_labels_incomplete' };
    }
  }
  return { trainingRecords: recursivelyFreeze(records), trainingCanonicalBytes };
}

function inspectFolds(
  input: NormalizedInput,
  records: readonly TrainingSpoolRecordV3[],
): Readonly<{ folds: readonly FoldInspection[] }> | Readonly<{ blocker: string }> {
  try {
    const folds: FoldInspection[] = [];
    for (let rawFoldId = 0; rawFoldId < PREDICTION_V3_FOLD_COUNT; rawFoldId += 1) {
      const foldId = rawFoldId as 0 | 1;
      const planFold = input.holdoutPlan.folds.find((entry) => entry.foldId === foldId);
      if (!planFold) return { blocker: 'prediction_v3_fold_contract_invalid' };
      const trainingDecisionIds = new Set(planFold.trainingDecisionIds);
      const holdoutDecisionIds = new Set(planFold.holdoutDecisionIds);
      const trainingRows = records.filter((row) => (
        row.foldId !== foldId && row.labels !== undefined
      ));
      const holdoutRows = records.filter((row) => (
        row.foldId === foldId && row.labels !== undefined
      ));
      if (
        trainingRows.length === 0
        || holdoutRows.length === 0
        || trainingRows.some((row) => !trainingDecisionIds.has(row.decisionId))
        || holdoutRows.some((row) => !holdoutDecisionIds.has(row.decisionId))
      ) return { blocker: 'prediction_v3_fold_contract_invalid' };

      const featureKeys = [...new Set(records
        .filter((row) => row.foldId !== foldId)
        .flatMap((row) => Object.keys(row.features)))]
        .sort(compareText);
      if (featureKeys.length > PREDICTION_V3_RESOURCE_LIMITS.maximumFeaturesPerFold) {
        return { blocker: 'resource_limit_exceeded' };
      }
      folds.push({
        foldId,
        featureKeys,
        trainingInferenceClusterIds: [...planFold.trainingInferenceClusterIds],
        holdoutInferenceClusterIds: [...planFold.holdoutInferenceClusterIds],
        trainingDecisionIds: [...planFold.trainingDecisionIds],
        holdoutDecisionIds: [...planFold.holdoutDecisionIds],
        trainingRowKeys: trainingRows.map((row) => row.rowKey).sort(compareText),
        holdoutRowKeys: holdoutRows.map((row) => row.rowKey).sort(compareText),
        trainingLabelRowCount: trainingRows.length,
        predictionRowCount: records.filter((row) => row.foldId === foldId).length,
      });
    }
    if (
      folds.length !== PREDICTION_V3_FOLD_COUNT
      || folds.some((fold, index) => fold.foldId !== index)
    ) return { blocker: 'prediction_v3_fold_contract_invalid' };
    return { folds: recursivelyFreeze(folds) };
  } catch {
    return { blocker: 'prediction_v3_fold_contract_invalid' };
  }
}

function validateAndCanonicalizeFeatures(
  raw: Readonly<Record<string, number>>,
): Record<string, number> {
  const entries = Object.entries(raw).sort(([left], [right]) => compareText(left, right));
  if (entries.some(([key, value]) => (
    key.length === 0
    || key !== key.trim()
    || Buffer.byteLength(key) > 512
    || !Number.isFinite(value)
    || value < 0
    || value > 1
  ))) throw new Error('prediction_v3_feature_contract_invalid');
  return Object.fromEntries(entries);
}

function deriveQHatAbsoluteBound(
  reward: NormalizedInput['rewardDefinition'],
): number {
  const booleanBound = Object.values(reward.weights).reduce((sum, weight) => (
    sum + Math.abs(weight)
  ), 0);
  const dwellBound = Math.abs(reward.dwell.weight)
    * reward.dwell.capMs / reward.dwell.scaleMs;
  return booleanBound + dwellBound;
}

function numericTrainingEnvelopeIsFinite(folds: readonly FoldInspection[]): boolean {
  const shrink = 1 - PREDICTION_V3_RUNTIME_CONFIG.learningRate
    * PREDICTION_V3_RUNTIME_CONFIG.l2Lambda;
  let coefficientBound = 0;
  for (let epoch = 0; epoch < PREDICTION_V3_RUNTIME_CONFIG.epochs; epoch += 1) {
    coefficientBound = Math.abs(shrink) * coefficientBound
      + PREDICTION_V3_RUNTIME_CONFIG.learningRate;
  }
  const interceptBound = PREDICTION_V3_RUNTIME_CONFIG.epochs
    * PREDICTION_V3_RUNTIME_CONFIG.learningRate;
  return [coefficientBound, interceptBound].every(Number.isFinite)
    && folds.every((fold) => Number.isFinite(
      interceptBound + fold.featureKeys.length * coefficientBound,
    ));
}

function calculateProducerAndVerifierMathWorkUnits(
  folds: readonly FoldInspection[],
  supportActionRowCount: number,
): number {
  const epochs = PREDICTION_V3_RUNTIME_CONFIG.epochs;
  const heads = OFFLINE_REWARD_HEADS_V1.length;
  const sumNf = folds.reduce((sum, fold) => (
    sum + fold.trainingLabelRowCount * fold.featureKeys.length
  ), 0);
  const sumN = folds.reduce((sum, fold) => sum + fold.trainingLabelRowCount, 0);
  const sumFPlusOne = folds.reduce((sum, fold) => sum + fold.featureKeys.length + 1, 0);
  const sumEf = folds.reduce((sum, fold) => (
    sum + fold.predictionRowCount * fold.featureKeys.length
  ), 0);
  const buildWorkUnits = 2 * epochs * heads * sumNf
    + epochs * heads * sumN
    + (2 * epochs + 2) * heads * sumFPlusOne
    + heads * sumEf
    + 2 * heads * supportActionRowCount;
  return 2 * buildWorkUnits;
}

function estimateConservativeSpoolBytes(
  input: NormalizedInput,
  decisions: readonly TargetDecisionSummary[],
  trainingRecords: readonly TrainingSpoolRecordV3[],
  trainingCanonicalBytes: number,
  _qHatAbsoluteBound: number,
): number {
  let bytes = trainingCanonicalBytes;
  const recordsByDecision = groupTrainingRecords(trainingRecords);
  const contexts = new Map(input.decisionContextEvidence.decisions.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const normalized = new Map(input.decisions.map((entry) => [
    entry.syntheticDecisionLog.decisionId,
    entry,
  ]));
  const primitivePredictions = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [
    head,
    MAX_NUMERIC_WIRE_VALUE,
  ])) as OfflinePrimitivePredictionsV1;
  for (const decision of decisions) {
    const context = contexts.get(decision.decisionId);
    const source = normalized.get(decision.decisionId);
    const foldId = input.holdoutBinding.foldIdByDecisionId.get(decision.decisionId);
    if (
      !context
      || context.clusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION
      || !source
      || foldId === undefined
    ) {
      throw new Error('prediction_v3_decision_binding_mismatch');
    }
    bytes += canonicalLineBytes({
      recordType: 'decision_start',
      contractVersion: 'cross_fitted_cohort_prediction_stream_v3',
      decisionId: decision.decisionId,
      requestId: decision.requestId,
      decisionLogSha256: decision.decisionLogSha256,
      candidatePoolSha256: decision.candidatePoolSha256,
      syntheticDecisionLogSha256: source.syntheticDecisionLogSha256,
      syntheticOutcomeEvidenceSha256:
        source.outcomeEvidence.syntheticOutcomeEvidenceSha256,
      inferenceClusterId: context.inferenceClusterId,
      clusterUnitVersion: context.clusterUnitVersion,
      foldId,
      modelBundleSha256: ZERO_SHA256,
      expectedStepCount: decision.steps.length,
      servable: false,
    } satisfies CohortPredictionRecordV3);
    const byPosition = recordsByDecision.get(decision.decisionId)
      ?? new Map<number, TrainingSpoolRecordV3[]>();
    for (const step of decision.steps) {
      const rows = byPosition.get(step.servedPosition) ?? [];
      bytes += canonicalLineBytes({
        recordType: 'step_start',
        decisionId: decision.decisionId,
        servedPosition: step.servedPosition,
        expectedActionCount: rows.length,
      } satisfies CohortPredictionRecordV3);
      for (const row of rows) {
        bytes += canonicalLineBytes({
          recordType: 'prediction',
          decisionId: decision.decisionId,
          servedPosition: step.servedPosition,
          actionKey: row.actionKey,
          foldId,
          primitivePredictions,
          qHat: MAX_QHAT_WIRE_VALUE,
        } satisfies CohortPredictionRecordV3);
      }
      bytes += canonicalLineBytes({
        recordType: 'step_end',
        decisionId: decision.decisionId,
        servedPosition: step.servedPosition,
        actualActionCount: rows.length,
        stepSha256: ZERO_SHA256,
      } satisfies CohortPredictionRecordV3);
    }
    bytes += canonicalLineBytes({
      recordType: 'decision_end',
      decisionId: decision.decisionId,
      actualStepCount: decision.steps.length,
      actualPredictionCount: [...byPosition.values()].reduce((sum, rows) => sum + rows.length, 0),
      decisionSha256: ZERO_SHA256,
    } satisfies CohortPredictionRecordV3);
  }
  return bytes;
}

function assertConservativeModelAndManifestLines(
  input: NormalizedInput,
  folds: readonly FoldInspection[],
  decisions: readonly TargetDecisionSummary[],
): void {
  const numericWireTemplate = '-0.12345678901234567890123456789';
  const headTemplate = (featureKeys: readonly string[]) => OFFLINE_REWARD_HEADS_V1.map((head) => ({
    head,
    intercept: numericWireTemplate,
    coefficients: featureKeys.map((feature) => ({
      feature,
      value: numericWireTemplate,
    })),
  }));
  const foldTemplates = folds.map((fold) => ({
    foldId: fold.foldId,
    trainingInferenceClusterIds: fold.trainingInferenceClusterIds,
    holdoutInferenceClusterIds: fold.holdoutInferenceClusterIds,
    trainingDecisionIds: fold.trainingDecisionIds,
    holdoutDecisionIds: fold.holdoutDecisionIds,
    trainingRowKeys: fold.trainingRowKeys,
    holdoutRowKeys: fold.holdoutRowKeys,
    featureKeys: fold.featureKeys,
    heads: headTemplate(fold.featureKeys),
    foldModelSha256: ZERO_SHA256,
  }));
  assertCanonicalLineWithinLimit({
    contractVersion: 'cross_fitted_cohort_model_bundle_v3',
    datasetVersion: input.targetEvidence.manifest.datasetVersion,
    snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
    targetManifestSha256: input.targetEvidence.targetManifestSha256,
    targetVerificationReceiptSha256: input.targetEvidence.receipt.verificationReceiptSha256,
    decisionContextEvidenceSha256:
      input.decisionContextEvidence.decisionContextEvidenceSha256,
    syntheticDecisionLogRootSha256: input.syntheticDecisionLogRootSha256,
    syntheticOutcomeEvidenceRootSha256: input.syntheticOutcomeEvidenceRootSha256,
    holdoutPlanSha256: input.holdoutPlan.holdoutPlanSha256,
    trainingSpoolSha256: ZERO_SHA256,
    trainingConfigSha256: input.trainingConfigSha256,
    resourceLimitsVersion: PREDICTION_V3_RESOURCE_LIMITS_VERSION,
    resourceLimitsSha256: input.resourceLimitsSha256,
    runtimeConfigVersion: PREDICTION_V3_RUNTIME_CONFIG_VERSION,
    runtimeConfigSha256: input.runtimeConfigSha256,
    rowOrder: PREDICTION_V3_ROW_ORDER,
    rewardDefinitionSha256: digest(input.rewardDefinition),
    foldCount: PREDICTION_V3_FOLD_COUNT,
    auxiliaryRowCount: 0,
    folds: foldTemplates,
    crossFitted: true,
    sameViewerLeakageExcluded: true,
    realDatasetEligible: false,
    servable: false,
    modelBundleSha256: ZERO_SHA256,
  });
  assertCanonicalLineWithinLimit({
    contractVersion: 'cross_fitted_cohort_prediction_set_manifest_v3',
    datasetVersion: input.targetEvidence.manifest.datasetVersion,
    predictionStreamSha256: ZERO_SHA256,
    physicalRecordCount: trainingRecordsPredictionCount(decisions),
    decisionCount: decisions.length,
    viewerClusterCount: input.holdoutPlan.viewerClusterCount,
    stepCount: decisions.reduce((sum, decision) => sum + decision.steps.length, 0),
    predictionCount: input.targetEvidence.manifest.actionProbabilityCount,
    candidateBaseCount: input.snapshot.manifest.candidateBaseCount,
    trainingRowCount: input.targetEvidence.manifest.actionProbabilityCount,
    auxiliaryRowCount: 0,
    modelBundleSha256: ZERO_SHA256,
    snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
    targetManifestSha256: input.targetEvidence.targetManifestSha256,
    targetVerificationReceiptSha256: input.targetEvidence.receipt.verificationReceiptSha256,
    decisionContextEvidenceSha256:
      input.decisionContextEvidence.decisionContextEvidenceSha256,
    syntheticDecisionLogRootSha256: input.syntheticDecisionLogRootSha256,
    syntheticOutcomeEvidenceRootSha256: input.syntheticOutcomeEvidenceRootSha256,
    holdoutPlanSha256: input.holdoutPlan.holdoutPlanSha256,
    trainingConfigSha256: input.trainingConfigSha256,
    resourceLimitsVersion: PREDICTION_V3_RESOURCE_LIMITS_VERSION,
    resourceLimitsSha256: input.resourceLimitsSha256,
    runtimeConfigVersion: PREDICTION_V3_RUNTIME_CONFIG_VERSION,
    runtimeConfigSha256: input.runtimeConfigSha256,
    rowOrder: PREDICTION_V3_ROW_ORDER,
    rewardDefinitionSha256: digest(input.rewardDefinition),
    predictionSetVersion: ZERO_SHA256,
    realDatasetEligible: false,
    servable: false,
  });
}

async function writeTrainingSpool(
  records: readonly TrainingSpoolRecordV3[],
): Promise<CanonicalSpoolV2> {
  const writer = await createCanonicalSpoolWriterV2(SPOOL_LIMITS_V3);
  try {
    for (const record of records) await writer.write(record);
    return await writer.finish();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

async function trainFromSpool(
  spool: CanonicalSpoolV2,
  preflightResult: Preflight,
): Promise<Readonly<{
  models: ReadonlyMap<0 | 1, FoldModels>;
  folds: CrossFittedCohortModelBundleV3['folds'];
}> | Readonly<{ blocker: string }>> {
  const models = new Map<0 | 1, FoldModels>();
  const builtFolds: CrossFittedCohortModelBundleV3['folds'] = [];
  try {
    for (const fold of preflightResult.folds) {
      const foldModels = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [head, {
        intercept: 0,
        coefficients: Object.fromEntries(fold.featureKeys.map((key) => [key, 0])),
      }])) as FoldModels;
      for (let epoch = 0; epoch < PREDICTION_V3_RUNTIME_CONFIG.epochs; epoch += 1) {
        const gradients = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [head, {
          intercept: 0,
          coefficients: Object.fromEntries(fold.featureKeys.map((key) => [key, 0])),
        }])) as FoldModels;
        let rowCount = 0;
        for await (const entry of readCanonicalSpoolRecordsV2(spool.stream, SPOOL_LIMITS_V3)) {
          const row = trainingSpoolRecordV3Schema.parse(entry.value);
          if (!row.labels || row.foldId === fold.foldId) continue;
          rowCount += 1;
          for (const head of OFFLINE_REWARD_HEADS_V1) {
            const model = foldModels[head];
            let logit = model.intercept;
            for (const key of fold.featureKeys) {
              logit += model.coefficients[key]! * (row.features[key] ?? 0);
            }
            const residual = stableSigmoid(logit) - row.labels[head];
            gradients[head].intercept += residual;
            for (const key of fold.featureKeys) {
              gradients[head].coefficients[key]! += residual * (row.features[key] ?? 0);
            }
          }
        }
        if (rowCount !== fold.trainingLabelRowCount || rowCount === 0) {
          return { blocker: 'prediction_v3_fold_contract_invalid' };
        }
        for (const head of OFFLINE_REWARD_HEADS_V1) {
          const model = foldModels[head];
          model.intercept = positiveZero(
            model.intercept - PREDICTION_V3_RUNTIME_CONFIG.learningRate
              * gradients[head].intercept / rowCount,
          );
          for (const key of fold.featureKeys) {
            const gradient = gradients[head].coefficients[key]! / rowCount
              + PREDICTION_V3_RUNTIME_CONFIG.l2Lambda * model.coefficients[key]!;
            model.coefficients[key] = positiveZero(
              model.coefficients[key]!
                - PREDICTION_V3_RUNTIME_CONFIG.learningRate * gradient,
            );
          }
          if (
            !Number.isFinite(model.intercept)
            || Object.values(model.coefficients).some((value) => !Number.isFinite(value))
          ) return { blocker: 'prediction_v3_numerical_error' };
        }
      }
      const heads = OFFLINE_REWARD_HEADS_V1.map((head) => ({
        head,
        intercept: foldModels[head].intercept,
        coefficients: fold.featureKeys.map((feature) => ({
          feature,
          value: foldModels[head].coefficients[feature]!,
        })),
      }));
      const foldPreimage = {
        foldId: fold.foldId,
        trainingInferenceClusterIds: [...fold.trainingInferenceClusterIds],
        holdoutInferenceClusterIds: [...fold.holdoutInferenceClusterIds],
        trainingDecisionIds: [...fold.trainingDecisionIds],
        holdoutDecisionIds: [...fold.holdoutDecisionIds],
        trainingRowKeys: [...fold.trainingRowKeys],
        holdoutRowKeys: [...fold.holdoutRowKeys],
        featureKeys: [...fold.featureKeys],
        heads,
      };
      builtFolds.push({ ...foldPreimage, foldModelSha256: digest(foldPreimage) });
      models.set(fold.foldId, foldModels);
    }
  } catch (error) {
    return { blocker: stableBlocker(error) };
  }
  return { models, folds: builtFolds };
}

async function writePredictionSpool(
  input: NormalizedInput,
  preflightResult: Preflight,
  bundle: CrossFittedCohortModelBundleV3,
  models: ReadonlyMap<0 | 1, FoldModels>,
): Promise<Readonly<{
  spool: CanonicalSpoolV2;
  predictionCount: number;
}> | Readonly<{ blocker: string }>> {
  const writer = await createCanonicalSpoolWriterV2(SPOOL_LIMITS_V3);
  const recordsByDecision = groupTrainingRecords(preflightResult.trainingRecords);
  const contexts = new Map(input.decisionContextEvidence.decisions.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const sources = new Map(input.decisions.map((entry) => [
    entry.syntheticDecisionLog.decisionId,
    entry,
  ]));
  let predictionCount = 0;
  try {
    for (const decision of preflightResult.targetDecisions) {
      const context = contexts.get(decision.decisionId);
      const source = sources.get(decision.decisionId);
      const foldId = input.holdoutBinding.foldIdByDecisionId.get(decision.decisionId);
      const foldModels = foldId === undefined ? undefined : models.get(foldId);
      const modelFold = foldId === undefined
        ? undefined
        : bundle.folds.find((entry) => entry.foldId === foldId);
      if (
        !context
        || context.clusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION
        || !source
        || foldId === undefined
        || !foldModels
        || !modelFold
      ) {
        throw new Error('prediction_v3_model_missing');
      }
      const decisionHash = createHash('sha256');
      const writeDecisionRecord = async (record: CohortPredictionRecordV3): Promise<string> => {
        const parsed = cohortPredictionRecordV3Schema.safeParse(record);
        if (!parsed.success) throw new Error('prediction_v3_stream_contract_invalid');
        const line = `${canonicalWireJsonV1(parsed.data)}\n`;
        if (Buffer.byteLength(line) - 1 > PREDICTION_V3_RESOURCE_LIMITS.maximumLineBytes) {
          throw new Error('resource_limit_exceeded');
        }
        await writer.write(parsed.data);
        return line;
      };
      const start = {
        recordType: 'decision_start' as const,
        contractVersion: 'cross_fitted_cohort_prediction_stream_v3' as const,
        decisionId: decision.decisionId,
        requestId: decision.requestId,
        decisionLogSha256: decision.decisionLogSha256,
        candidatePoolSha256: decision.candidatePoolSha256,
        syntheticDecisionLogSha256: source.syntheticDecisionLogSha256,
        syntheticOutcomeEvidenceSha256:
          source.outcomeEvidence.syntheticOutcomeEvidenceSha256,
        inferenceClusterId: context.inferenceClusterId,
        clusterUnitVersion: context.clusterUnitVersion,
        foldId,
        modelBundleSha256: bundle.modelBundleSha256,
        expectedStepCount: decision.steps.length,
        servable: false as const,
      } satisfies CohortPredictionRecordV3;
      decisionHash.update(await writeDecisionRecord(start));

      const byPosition = recordsByDecision.get(decision.decisionId)
        ?? new Map<number, TrainingSpoolRecordV3[]>();
      let decisionPredictionCount = 0;
      for (const step of decision.steps) {
        const rows = byPosition.get(step.servedPosition) ?? [];
        if (
          rows.length !== step.actions.length
          || rows.some((row, index) => (
            actionIdentity(row.actionKey) !== actionIdentity(step.actions[index]!.actionKey)
          ))
        ) throw new Error('prediction_v3_step_membership_mismatch');
        const stepHash = createHash('sha256');
        const stepStart = {
          recordType: 'step_start' as const,
          decisionId: decision.decisionId,
          servedPosition: step.servedPosition,
          expectedActionCount: rows.length,
        } satisfies CohortPredictionRecordV3;
        const stepStartLine = await writeDecisionRecord(stepStart);
        stepHash.update(stepStartLine);
        decisionHash.update(stepStartLine);

        for (const row of rows) {
          const primitivePredictions = Object.fromEntries(
            OFFLINE_REWARD_HEADS_V1.map((head) => [
              head,
              predict(foldModels[head], row.features, modelFold.featureKeys),
            ]),
          ) as OfflinePrimitivePredictionsV1;
          const qHat = primitiveQHat(primitivePredictions, input.rewardDefinition);
          if (Math.abs(qHat) > preflightResult.qHatAbsoluteBound + Number.EPSILON) {
            throw new Error('prediction_v3_numerical_error');
          }
          const prediction = {
            recordType: 'prediction' as const,
            decisionId: decision.decisionId,
            servedPosition: step.servedPosition,
            actionKey: row.actionKey,
            foldId,
            primitivePredictions,
            qHat,
          } satisfies CohortPredictionRecordV3;
          const predictionLine = await writeDecisionRecord(prediction);
          stepHash.update(predictionLine);
          decisionHash.update(predictionLine);
          decisionPredictionCount += 1;
          predictionCount += 1;
        }

        const stepEnd = {
          recordType: 'step_end' as const,
          decisionId: decision.decisionId,
          servedPosition: step.servedPosition,
          actualActionCount: rows.length,
          stepSha256: stepHash.digest('hex'),
        } satisfies CohortPredictionRecordV3;
        decisionHash.update(await writeDecisionRecord(stepEnd));
      }
      const expectedDecisionPredictions = [...byPosition.values()].reduce(
        (sum, rows) => sum + rows.length,
        0,
      );
      if (decisionPredictionCount !== expectedDecisionPredictions || decisionPredictionCount === 0) {
        throw new Error('prediction_v3_prediction_incomplete');
      }
      await writeDecisionRecord({
        recordType: 'decision_end',
        decisionId: decision.decisionId,
        actualStepCount: decision.steps.length,
        actualPredictionCount: decisionPredictionCount,
        decisionSha256: decisionHash.digest('hex'),
      });
    }
    if (predictionCount !== preflightResult.supportActionRowCount) {
      throw new Error('prediction_v3_prediction_incomplete');
    }
    return { spool: await writer.finish(), predictionCount };
  } catch (error) {
    await writer.abort().catch(() => undefined);
    return { blocker: stableBlocker(error) };
  }
}

function predict(
  model: HeadModel,
  features: Readonly<Record<string, number>>,
  featureKeys: readonly string[],
): number {
  let logit = model.intercept;
  for (const key of featureKeys) {
    logit += model.coefficients[key]! * (features[key] ?? 0);
  }
  const prediction = stableSigmoid(logit);
  if (!Number.isFinite(prediction) || prediction < 0 || prediction > 1) {
    throw new Error('prediction_v3_numerical_error');
  }
  return positiveZero(prediction);
}

function primitiveQHat(
  predictions: OfflinePrimitivePredictionsV1,
  reward: NormalizedInput['rewardDefinition'],
): number {
  let value = 0;
  for (const head of OFFLINE_REWARD_HEADS_V1) {
    if (head !== 'dwell') value += reward.weights[head] * predictions[head];
  }
  value += reward.dwell.weight * predictions.dwell
    * reward.dwell.capMs / reward.dwell.scaleMs;
  if (!Number.isFinite(value) || Math.abs(value) > MAX_QHAT_ABSOLUTE_VALUE) {
    throw new Error('prediction_v3_numerical_error');
  }
  return positiveZero(value);
}

function groupTrainingRecords(
  records: readonly TrainingSpoolRecordV3[],
): Map<string, Map<number, TrainingSpoolRecordV3[]>> {
  const grouped = new Map<string, Map<number, TrainingSpoolRecordV3[]>>();
  for (const record of records) {
    const byPosition = grouped.get(record.decisionId)
      ?? new Map<number, TrainingSpoolRecordV3[]>();
    const rows = byPosition.get(record.actionKey.servedPosition)
      ?? ([] as TrainingSpoolRecordV3[]);
    rows.push(record);
    byPosition.set(record.actionKey.servedPosition, rows);
    grouped.set(record.decisionId, byPosition);
  }
  return grouped;
}

function trainingRecordsPredictionCount(decisions: readonly TargetDecisionSummary[]): number {
  const slots = decisions.reduce((sum, decision) => sum + decision.steps.length, 0);
  const predictions = decisions.reduce((sum, decision) => sum + decision.steps.reduce(
    (stepSum, step) => stepSum + step.actions.length,
    0,
  ), 0);
  return predictions + 2 * slots + 2 * decisions.length;
}

function canonicalLineBytes(record: unknown): number {
  const bytes = Buffer.byteLength(`${canonicalWireJsonV1(record)}\n`);
  if (bytes - 1 > PREDICTION_V3_RESOURCE_LIMITS.maximumLineBytes) {
    throw new Error('resource_limit_exceeded');
  }
  return bytes;
}

function assertCanonicalLineWithinLimit(record: unknown): void {
  canonicalLineBytes(record);
}

async function compareAndCaptureCanonicalStreams(
  left: ByteStreamFactoryV2,
  right: ByteStreamFactoryV2,
): Promise<ByteStreamFactoryV2 | undefined> {
  const leftIterator = readCanonicalSpoolRecordsV2(
    isolateSuppliedPredictionStream(left),
    SPOOL_LIMITS_V3,
  )[Symbol.asyncIterator]();
  const rightIterator = readCanonicalSpoolRecordsV2(right, SPOOL_LIMITS_V3)[Symbol.asyncIterator]();
  const verifiedLines: string[] = [];
  let verifiedBytes = 0;
  try {
    while (true) {
      const [leftEntry, rightEntry] = await Promise.all([leftIterator.next(), rightIterator.next()]);
      if (leftEntry.done || rightEntry.done) {
        if (leftEntry.done !== rightEntry.done) return undefined;
        const captured = Object.freeze([...verifiedLines]);
        return () => (async function* stableVerifiedPredictionStream() {
          for (const line of captured) yield line;
        }());
      }
      if (leftEntry.value.raw !== rightEntry.value.raw) return undefined;
      const line = `${leftEntry.value.raw}\n`;
      const lineBytes = Buffer.byteLength(line);
      if (lineBytes > SPOOL_LIMITS_V3.maxFileBytes - verifiedBytes) {
        throw new Error('prediction_spool_resource_limit_exceeded');
      }
      verifiedBytes += lineBytes;
      verifiedLines.push(line);
    }
  } finally {
    await Promise.allSettled([
      leftIterator.return?.(undefined),
      rightIterator.return?.(undefined),
    ]);
  }
}

function isolateSuppliedPredictionStream(
  factory: ByteStreamFactoryV2,
): ByteStreamFactoryV2 {
  return () => (async function* isolatedStream() {
    let iterator: AsyncIterator<string | Uint8Array> | undefined;
    try {
      const stream = factory();
      const iteratorFactory = stream && Reflect.get(stream, Symbol.asyncIterator);
      if (typeof iteratorFactory !== 'function') throw new Error('invalid stream');
      const candidate = Reflect.apply(iteratorFactory, stream, []);
      if (!candidate || typeof candidate !== 'object') throw new Error('invalid iterator');
      iterator = candidate as AsyncIterator<string | Uint8Array>;
    } catch {
      throw new SuppliedPredictionStreamError();
    }
    if (!iterator) throw new SuppliedPredictionStreamError();
    const sourceIterator = iterator;
    try {
      while (true) {
        let next: IteratorResult<string | Uint8Array>;
        try {
          const nextMethod = Reflect.get(sourceIterator, 'next');
          if (typeof nextMethod !== 'function') throw new Error('invalid iterator');
          const candidate = await Reflect.apply(nextMethod, sourceIterator, []);
          if (!candidate || typeof candidate !== 'object') throw new Error('invalid result');
          next = {
            done: Boolean(Reflect.get(candidate, 'done')),
            value: Reflect.get(candidate, 'value') as string | Uint8Array,
          };
        } catch {
          throw new SuppliedPredictionStreamError();
        }
        if (next.done) return;
        try {
          yield next.value;
        } catch {
          throw new SuppliedPredictionStreamError();
        }
      }
    } finally {
      try {
        const returnMethod = Reflect.get(sourceIterator, 'return');
        if (typeof returnMethod === 'function') {
          await Reflect.apply(returnMethod, sourceIterator, []);
        }
      } catch {
        // The supplied stream cannot override the verifier's stable result.
      }
    }
  }());
}

function parseCanonicalSingle<T>(raw: string, schema: z.ZodType<T>): T | undefined {
  if (!raw.endsWith('\n') || raw.indexOf('\n') !== raw.length - 1) return undefined;
  const wire = raw.slice(0, -1);
  let value: unknown;
  try {
    value = JSON.parse(wire);
  } catch {
    return undefined;
  }
  if (canonicalWireJsonV1(value) !== wire) return undefined;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function captureInput(value: unknown): CapturedInput | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return {
      targetEvidence: Reflect.get(value, 'targetEvidence'),
      snapshot: Reflect.get(value, 'snapshot'),
      decisionContextEvidence: Reflect.get(value, 'decisionContextEvidence'),
      decisions: Reflect.get(value, 'decisions'),
      rewardDefinition: Reflect.get(value, 'rewardDefinition'),
    };
  } catch {
    return undefined;
  }
}

function captureDecisionInput(value: unknown): {
  syntheticDecisionLog: unknown;
  outcomeEvidence: unknown;
} | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return {
      syntheticDecisionLog: Reflect.get(value, 'syntheticDecisionLog'),
      outcomeEvidence: Reflect.get(value, 'outcomeEvidence'),
    };
  } catch {
    return undefined;
  }
}

function captureArtifactInput(value: unknown): {
  modelBundleRaw: string;
  predictionSetManifestRaw: string;
  predictionStream: ByteStreamFactoryV2;
} | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const modelBundleRaw = Reflect.get(value, 'modelBundleRaw');
    const predictionSetManifestRaw = Reflect.get(value, 'predictionSetManifestRaw');
    const predictionStream = Reflect.get(value, 'predictionStream');
    if (
      typeof modelBundleRaw !== 'string'
      || typeof predictionSetManifestRaw !== 'string'
      || typeof predictionStream !== 'function'
    ) return undefined;
    return { modelBundleRaw, predictionSetManifestRaw, predictionStream };
  } catch {
    return undefined;
  }
}

function sourcesStillVerified(input: NormalizedInput): boolean {
  return isVerifiedTargetDistributionEvidenceV2(input.targetEvidence)
    && isVerifiedFullSupportPitActionSnapshotV2(input.snapshot)
    && isVerifiedDecisionContextEvidenceV1(input.decisionContextEvidence)
    && isVerifiedViewerClusterHoldoutPlanV1(input.holdoutPlan)
    && input.decisions.every((entry) => (
      isVerifiedSyntheticOutcomeEvidenceV1(entry.outcomeEvidence)
      && digest(entry.syntheticDecisionLog) === entry.syntheticDecisionLogSha256
    ));
}

function stableBlocker(error: unknown): string {
  if (error instanceof SuppliedPredictionStreamError) {
    return 'prediction_v3_stream_mismatch';
  }
  const blocker = error instanceof Error ? error.message : '';
  if (
    blocker === 'resource_limit_exceeded'
    || blocker.startsWith('prediction_v3_')
    || blocker.startsWith('target_')
    || blocker.startsWith('snapshot_')
    || blocker === 'rust_verification_trust_root_unavailable'
  ) return blocker;
  if (blocker.includes('resource')) return 'resource_limit_exceeded';
  return 'prediction_v3_io_or_contract_failure';
}

function reject(blocker: string): Readonly<{ status: 'not_evaluable'; blocker: string }> {
  return Object.freeze({ status: 'not_evaluable' as const, blocker });
}

function positiveZero(value: number): number {
  return value === 0 ? 0 : value;
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}
