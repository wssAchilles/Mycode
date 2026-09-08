import { createHash } from 'crypto';

import { z } from 'zod';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  isVerifiedSyntheticOutcomeEvidenceV1,
  type VerifiedSyntheticOutcomeEvidenceV1,
} from '../../outcomes/syntheticOutcomeEvidenceV1';
import { canonicalWireJsonV1 } from '../artifacts/canonical';
import {
  crossFittedTrainingConfigSchema,
  evaluatePhase11ModelStateBudgetV1,
  offlineRewardDefinitionSchema,
  phase11ModelStateResourceConfigV1Schema,
} from '../contracts/artifacts';
import {
  OFFLINE_REWARD_HEADS_V1,
  encodeOfflineLabelsV1,
  type OfflinePrimitivePredictionsV1,
  type OfflineRewardHeadV1,
} from '../contracts/reward';
import { encodeOfflineActionFeaturesV1 } from '../features/encode';
import {
  isVerifiedFullSupportPitActionSnapshotV2,
  replayVerifiedSnapshotPositionFeaturesV2,
} from '../snapshotV2';
import {
  isVerifiedTargetDistributionEvidenceV2,
  replayVerifiedTargetDistributionV2,
} from '../targetEvidence';
import { assignDecisionFoldV1, canonicalDecisionId } from '../trainer/folds';
import { stableSigmoid } from '../trainer/logistic';
import {
  crossFittedModelBundleV2Schema,
  PREDICTION_SPOOL_LIMITS_VERSION,
  PREDICTION_V2_RUNTIME_CONFIG_VERSION,
  PREDICTION_V2_ROW_ORDER,
  predictionSetManifestV2Schema,
  type CrossFittedModelBundleV2,
  type CrossFittedPredictionInputV2,
  type CrossFittedPredictionVerificationReceiptV2,
  type PredictionRecordV2,
  type PredictionSetManifestV2,
  type PredictionSpoolDiagnosticsV2,
  type PredictionSpoolLimitsV2,
  type ProducedCrossFittedPredictionSetV2,
  type VerifiedCrossFittedPredictionSetV2,
} from './contracts';
import {
  createCanonicalSpoolWriterV2,
  DEFAULT_PREDICTION_SPOOL_LIMITS_V2,
  readCanonicalSpoolRecordsV2,
  type CanonicalSpoolV2,
} from './spool';

const featureMapSchema = z.record(z.string(), z.number().finite());
const labelsSchema = z.object(Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [
  head,
  z.number().finite().min(0).max(1),
])) as Record<OfflineRewardHeadV1, z.ZodNumber>).strict();
const trainingSpoolRecordSchema = z.object({
  contractVersion: z.literal('prediction_training_spool_record_v2'),
  evidenceRole: z.enum(['evaluation_target', 'private_synthetic_auxiliary']),
  decisionId: z.string().uuid(),
  actionKey: z.object({
    candidateNamespace: z.enum(['serving_post_id', 'model_post_id']),
    candidateId: z.string().trim().min(1),
    servedPosition: z.number().int().positive().max(64),
  }).strict(),
  rowKey: z.string().min(1),
  features: featureMapSchema,
  labels: labelsSchema.optional(),
}).strict();

type TrainingSpoolRecord = z.infer<typeof trainingSpoolRecordSchema>;
type HeadModel = { intercept: number; coefficients: Record<string, number> };
type FoldModels = Record<OfflineRewardHeadV1, HeadModel>;
type TargetSummary = {
  decisionId: string;
  decisionLogSha256: string;
  candidatePoolSha256: string;
  steps: Array<{
    servedPosition: number;
    actionCount: number;
    actionKeysSha256: string;
  }>;
  predictionCount: number;
};
type NormalizedPredictionInputV2 = Omit<CrossFittedPredictionInputV2, 'spoolLimits'> & {
  spoolLimits: Readonly<PredictionSpoolLimitsV2>;
  spoolResourceConfigSha256: string;
  runtimeConfigSha256: string;
};

const verifiedSets = new WeakSet<object>();
const verifiedSetDigests = new WeakMap<object, string>();
const verifiedSetBindings = new WeakMap<object, {
  predictionStream: ProducedCrossFittedPredictionSetV2['predictionStream'];
  spoolLimits: NonNullable<CrossFittedPredictionInputV2['spoolLimits']>;
}>();

const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);
const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const same = (left: unknown, right: unknown): boolean => (
  canonicalDecisionJson(left) === canonicalDecisionJson(right)
);
const actionIdentity = (value: TrainingSpoolRecord['actionKey']): string => (
  canonicalDecisionJson(value)
);
const rowKey = (role: TrainingSpoolRecord['evidenceRole'], decisionId: string,
  actionKey: TrainingSpoolRecord['actionKey']): string => [
  role === 'evaluation_target' ? '0' : '1',
  canonicalDecisionId(decisionId),
  actionKey.candidateNamespace,
  actionKey.candidateId,
  actionKey.servedPosition.toString().padStart(2, '0'),
].join('\u0000');

export async function produceCrossFittedPredictionSetV2(
  input: CrossFittedPredictionInputV2,
): Promise<{ status: 'produced'; artifact: ProducedCrossFittedPredictionSetV2 }
  | { status: 'not_evaluable'; blocker: string }> {
  let normalized: ReturnType<typeof normalizeInput>;
  try {
    normalized = normalizeInput(input);
  } catch {
    return { status: 'not_evaluable', blocker: 'prediction_v2_input_contract_invalid' };
  }
  return 'blocker' in normalized
    ? { status: 'not_evaluable', blocker: normalized.blocker }
    : buildArtifacts(normalized.input);
}

export async function verifyCrossFittedPredictionSetV2(
  input: CrossFittedPredictionInputV2 & {
    modelBundleRaw: string;
    predictionSetManifestRaw: string;
    predictionStream: ProducedCrossFittedPredictionSetV2['predictionStream'];
  },
): Promise<{ status: 'verified'; predictionSet: VerifiedCrossFittedPredictionSetV2 }
  | { status: 'not_evaluable'; blocker: string }> {
  let normalized: ReturnType<typeof normalizeInput>;
  try {
    normalized = normalizeInput(input);
  } catch {
    return { status: 'not_evaluable', blocker: 'prediction_v2_input_contract_invalid' };
  }
  if ('blocker' in normalized) {
    return { status: 'not_evaluable', blocker: normalized.blocker };
  }
  let modelBundleRaw: string;
  let predictionSetManifestRaw: string;
  let predictionStream: ProducedCrossFittedPredictionSetV2['predictionStream'];
  try {
    modelBundleRaw = `${input.modelBundleRaw}`;
    predictionSetManifestRaw = `${input.predictionSetManifestRaw}`;
    predictionStream = input.predictionStream;
  } catch {
    return { status: 'not_evaluable', blocker: 'prediction_v2_artifact_contract_invalid' };
  }
  const suppliedBundle = parseCanonicalSingle(modelBundleRaw, crossFittedModelBundleV2Schema);
  const suppliedManifest = parseCanonicalSingle(
    predictionSetManifestRaw,
    predictionSetManifestV2Schema,
  );
  if (!suppliedBundle || !suppliedManifest) {
    return { status: 'not_evaluable', blocker: 'prediction_v2_artifact_contract_invalid' };
  }
  const rebuilt = await buildArtifacts(normalized.input);
  if (rebuilt.status !== 'produced') return rebuilt;
  try {
    if (
      modelBundleRaw !== rebuilt.artifact.modelBundleRaw
      || predictionSetManifestRaw !== rebuilt.artifact.predictionSetManifestRaw
      || !same(suppliedBundle, rebuilt.artifact.bundle)
      || !same(suppliedManifest, rebuilt.artifact.manifest)
    ) return { status: 'not_evaluable', blocker: 'prediction_v2_retraining_mismatch' };
    const streamsMatch = await compareCanonicalStreams(
      predictionStream,
      rebuilt.artifact.predictionStream,
      normalized.input.spoolLimits,
    );
    if (!streamsMatch) {
      return { status: 'not_evaluable', blocker: 'prediction_v2_stream_mismatch' };
    }
    const receiptPreimage = {
      contractVersion: 'cross_fitted_prediction_verification_receipt_v2' as const,
      verifierVersion: 'cross_fitted_prediction_set_verifier_v2' as const,
      predictionSetVersion: suppliedManifest.predictionSetVersion,
      modelBundleSha256: suppliedBundle.modelBundleSha256,
      predictionStreamSha256: suppliedManifest.predictionStreamSha256,
      snapshotManifestSha256: suppliedManifest.snapshotManifestSha256,
      targetManifestSha256: suppliedManifest.targetManifestSha256,
      targetVerificationReceiptSha256: suppliedManifest.targetVerificationReceiptSha256,
      syntheticOutcomeEvidenceSha256: suppliedManifest.syntheticOutcomeEvidenceSha256,
      syntheticAuxiliaryTrainingRootSha256:
        suppliedManifest.syntheticAuxiliaryTrainingRootSha256,
      resourceConfigSha256: suppliedManifest.resourceConfigSha256,
      spoolResourceConfigSha256: suppliedManifest.spoolResourceConfigSha256,
      runtimeConfigVersion: PREDICTION_V2_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: suppliedManifest.runtimeConfigSha256,
      rowOrder: PREDICTION_V2_ROW_ORDER,
      passCount: rebuilt.artifact.diagnostics.passCount,
    };
    const receipt: CrossFittedPredictionVerificationReceiptV2 = recursivelyFreeze({
      ...receiptPreimage,
      receiptSha256: digest(receiptPreimage),
    });
    const predictionSet = recursivelyFreeze({
      contractVersion: 'verified_cross_fitted_prediction_set_v2' as const,
      manifest: suppliedManifest,
      receipt,
      realDatasetEligible: false as const,
      servable: false as const,
    });
    verifiedSets.add(predictionSet);
    verifiedSetDigests.set(predictionSet, digest(predictionSet));
    verifiedSetBindings.set(predictionSet, {
      predictionStream,
      spoolLimits: normalized.input.spoolLimits,
    });
    return recursivelyFreeze({ status: 'verified' as const, predictionSet });
  } catch (error) {
    return { status: 'not_evaluable', blocker: stableBlocker(error) };
  } finally {
    await rebuilt.artifact.dispose();
  }
}

export function isVerifiedCrossFittedPredictionSetV2(
  value: unknown,
): value is VerifiedCrossFittedPredictionSetV2 {
  try {
    if (!value || typeof value !== 'object' || !recursivelyFrozen(value)) return false;
    return verifiedSets.has(value)
      && verifiedSetDigests.get(value) === digest(value);
  } catch {
    return false;
  }
}

export function predictionSetReplayBindingV2(
  value: VerifiedCrossFittedPredictionSetV2,
): { predictionStream: ProducedCrossFittedPredictionSetV2['predictionStream'];
  spoolLimits: NonNullable<CrossFittedPredictionInputV2['spoolLimits']> } | undefined {
  if (!isVerifiedCrossFittedPredictionSetV2(value)) return undefined;
  return verifiedSetBindings.get(value);
}

async function buildArtifacts(
  input: NormalizedPredictionInputV2,
): Promise<{ status: 'produced'; artifact: ProducedCrossFittedPredictionSetV2 }
  | { status: 'not_evaluable'; blocker: string }> {
  const limits = input.spoolLimits;
  let trainingSpool: CanonicalSpoolV2 | undefined;
  let predictionSpool: CanonicalSpoolV2 | undefined;
  try {
    const builtTraining = await buildTrainingSpool(input, limits);
    if ('blocker' in builtTraining) return { status: 'not_evaluable', blocker: builtTraining.blocker };
    trainingSpool = builtTraining.spool;
    let passCount = 0;
    const inspected = await inspectTrainingSpool(input, trainingSpool, limits);
    passCount += 1;
    if ('blocker' in inspected) return { status: 'not_evaluable', blocker: inspected.blocker };
    const trained = await trainFromSpool(input, trainingSpool, inspected, limits);
    passCount += input.trainingConfig.foldCount * input.trainingConfig.epochs;
    if ('blocker' in trained) return { status: 'not_evaluable', blocker: trained.blocker };
    const summary = await collectTargetSummary(input);
    if ('blocker' in summary) return { status: 'not_evaluable', blocker: summary.blocker };
    const rewardDefinitionSha256 = digest(input.rewardDefinition);
    const bundlePreimage = {
      contractVersion: 'cross_fitted_model_bundle_v2' as const,
      datasetVersion: input.outcomeEvidence.datasetVersion,
      snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
      targetManifestSha256: input.targetEvidence.targetManifestSha256,
      targetVerificationReceiptSha256: input.targetEvidence.receipt.verificationReceiptSha256,
      syntheticOutcomeEvidenceSha256: input.outcomeEvidence.syntheticOutcomeEvidenceSha256,
      syntheticAuxiliaryTrainingRootSha256: builtTraining.auxiliaryRootSha256,
      trainingSpoolSha256: trainingSpool.sha256,
      trainingConfigSha256: digest(input.trainingConfig),
      resourceConfigSha256: inspected.resourceConfigSha256,
      spoolResourceConfigSha256: input.spoolResourceConfigSha256,
      runtimeConfigVersion: PREDICTION_V2_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: input.runtimeConfigSha256,
      rowOrder: PREDICTION_V2_ROW_ORDER,
      rewardDefinitionSha256,
      foldCount: 2 as const,
      folds: trained.folds,
      crossFitted: true as const,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    const bundle: CrossFittedModelBundleV2 = {
      ...bundlePreimage,
      modelBundleSha256: digest(bundlePreimage),
    };
    const predictions = await buildPredictionSpool(
      input,
      trainingSpool,
      limits,
      summary.summary,
      bundle,
      trained.models,
    );
    passCount += 1;
    if ('blocker' in predictions) return { status: 'not_evaluable', blocker: predictions.blocker };
    predictionSpool = predictions.spool;
    const manifestPreimage = {
      contractVersion: 'cross_fitted_prediction_set_manifest_v2' as const,
      datasetVersion: input.outcomeEvidence.datasetVersion,
      predictionStreamSha256: predictionSpool.sha256,
      physicalRecordCount: predictionSpool.recordCount,
      decisionCount: 1,
      stepCount: summary.summary.steps.length,
      predictionCount: predictions.predictionCount,
      modelBundleSha256: bundle.modelBundleSha256,
      snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
      targetManifestSha256: input.targetEvidence.targetManifestSha256,
      targetVerificationReceiptSha256: input.targetEvidence.receipt.verificationReceiptSha256,
      syntheticOutcomeEvidenceSha256: input.outcomeEvidence.syntheticOutcomeEvidenceSha256,
      syntheticAuxiliaryTrainingRootSha256: builtTraining.auxiliaryRootSha256,
      resourceConfigSha256: inspected.resourceConfigSha256,
      spoolResourceConfigSha256: input.spoolResourceConfigSha256,
      runtimeConfigVersion: PREDICTION_V2_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: input.runtimeConfigSha256,
      rowOrder: PREDICTION_V2_ROW_ORDER,
      rewardDefinitionSha256,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    const manifest: PredictionSetManifestV2 = {
      ...manifestPreimage,
      predictionSetVersion: digest(manifestPreimage),
    };
    const modelBundleRaw = `${canonicalWireJsonV1(bundle)}\n`;
    const predictionSetManifestRaw = `${canonicalWireJsonV1(manifest)}\n`;
    const diagnostics: PredictionSpoolDiagnosticsV2 = {
      passCount,
      peakLineBytes: Math.max(trainingSpool.peakLineBytes, predictionSpool.peakLineBytes),
      peakStepActions: predictions.peakStepActions,
      peakStepBytes: predictions.peakStepBytes,
      records: trainingSpool.recordCount + predictionSpool.recordCount,
      bytes: trainingSpool.byteCount + predictionSpool.byteCount,
    };
    const ownedPredictionSpool = predictionSpool;
    predictionSpool = undefined;
    return {
      status: 'produced',
      artifact: {
        contractVersion: 'produced_cross_fitted_prediction_set_v2',
        bundle,
        modelBundleRaw,
        manifest,
        predictionSetManifestRaw,
        predictionStream: ownedPredictionSpool.stream,
        artifactState: 'pre_publish',
        diagnostics,
        dispose: ownedPredictionSpool.cleanup,
      },
    };
  } catch (error) {
    return { status: 'not_evaluable', blocker: stableBlocker(error) };
  } finally {
    await trainingSpool?.cleanup();
    await predictionSpool?.cleanup();
  }
}

function normalizeInput(input: CrossFittedPredictionInputV2):
  | { input: NormalizedPredictionInputV2 }
  | { blocker: string } {
  const training = crossFittedTrainingConfigSchema.safeParse(input.trainingConfig);
  const resource = phase11ModelStateResourceConfigV1Schema.safeParse(input.resourceConfig);
  const reward = offlineRewardDefinitionSchema.safeParse(input.rewardDefinition);
  if (!training.success || !resource.success || !reward.success) {
    return { blocker: 'prediction_v2_input_contract_invalid' };
  }
  if (training.data.foldCount !== 2 || resource.data.foldCount !== 2) {
    return { blocker: 'prediction_v2_fold_contract_invalid' };
  }
  if (!isVerifiedTargetDistributionEvidenceV2(input.targetEvidence)) {
    return { blocker: 'target_verified_brand_missing' };
  }
  if (!isVerifiedFullSupportPitActionSnapshotV2(input.snapshot)) {
    return { blocker: 'snapshot_verified_brand_missing' };
  }
  if (!isVerifiedSyntheticOutcomeEvidenceV1(input.outcomeEvidence)) {
    return { blocker: 'verified_synthetic_outcome_required' };
  }
  if (
    input.snapshot.targetDistributionNdjsonSha256
      !== input.targetEvidence.receipt.distributionNdjsonSha256
    || input.snapshot.manifest.targetManifestSha256 !== input.targetEvidence.targetManifestSha256
    || input.snapshot.manifest.targetVerificationReceiptSha256
      !== input.targetEvidence.receipt.verificationReceiptSha256
  ) return { blocker: 'prediction_v2_evidence_binding_mismatch' };
  const { contractVersion: _ignored, ...rewardWithoutContract } = reward.data;
  if (!same(rewardWithoutContract, input.outcomeEvidence.rewardDefinition)) {
    return { blocker: 'prediction_v2_reward_binding_mismatch' };
  }
  const rawLimits = input.spoolLimits ?? DEFAULT_PREDICTION_SPOOL_LIMITS_V2;
  const limits = {
    maxLineBytes: rawLimits.maxLineBytes,
    maxFileBytes: rawLimits.maxFileBytes,
    maxRecords: rawLimits.maxRecords,
  };
  if (
    Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)
    || limits.maxLineBytes > DEFAULT_PREDICTION_SPOOL_LIMITS_V2.maxLineBytes
    || limits.maxFileBytes > DEFAULT_PREDICTION_SPOOL_LIMITS_V2.maxFileBytes
    || limits.maxRecords > DEFAULT_PREDICTION_SPOOL_LIMITS_V2.maxRecords
  ) return { blocker: 'prediction_spool_resource_config_invalid' };
  const frozenLimits = recursivelyFreeze(limits);
  const spoolResourceConfigSha256 = digest({
    limitsVersion: PREDICTION_SPOOL_LIMITS_VERSION,
    limits: frozenLimits,
  });
  const runtimeConfigSha256 = digest({
    contractVersion: PREDICTION_V2_RUNTIME_CONFIG_VERSION,
    rowOrder: PREDICTION_V2_ROW_ORDER,
    trainingConfigSha256: digest(training.data),
    resourceConfigSha256: digest(resource.data),
    spoolResourceConfigSha256,
  });
  return {
    input: {
      snapshot: input.snapshot,
      targetEvidence: input.targetEvidence,
      outcomeEvidence: input.outcomeEvidence,
      trainingConfig: recursivelyFreeze(training.data),
      resourceConfig: recursivelyFreeze(resource.data),
      rewardDefinition: recursivelyFreeze(reward.data),
      spoolLimits: frozenLimits,
      spoolResourceConfigSha256,
      runtimeConfigSha256,
    },
  };
}

async function buildTrainingSpool(
  input: NormalizedPredictionInputV2,
  limits: NonNullable<CrossFittedPredictionInputV2['spoolLimits']>,
): Promise<{ spool: CanonicalSpoolV2; auxiliaryRootSha256: string } | { blocker: string }> {
  let writer: Awaited<ReturnType<typeof createCanonicalSpoolWriterV2>>;
  try { writer = await createCanonicalSpoolWriterV2(limits); } catch (error) {
    return { blocker: stableBlocker(error) };
  }
  const outcomes = new Map(input.outcomeEvidence.outcomes.map((entry) => [
    actionIdentity(entry.actionKey), entry,
  ]));
  const seenLabels = new Set<string>();
  let decisionAt: string | undefined;
  let localBlocker: string | undefined;
  const replay = await replayVerifiedSnapshotPositionFeaturesV2(
    input.snapshot,
    input.targetEvidence,
    {
      onPositionFeature: async (feature) => {
        try {
          if (feature.decisionId !== input.outcomeEvidence.decisionId) {
            throw new Error('prediction_v2_outcome_decision_mismatch');
          }
          decisionAt ??= feature.row.decisionAt;
          const outcome = outcomes.get(actionIdentity(feature.row.actionKey));
          if (outcome) seenLabels.add(actionIdentity(feature.row.actionKey));
          const record: TrainingSpoolRecord = {
            contractVersion: 'prediction_training_spool_record_v2',
            evidenceRole: 'evaluation_target',
            decisionId: feature.decisionId,
            actionKey: feature.row.actionKey,
            rowKey: rowKey('evaluation_target', feature.decisionId, feature.row.actionKey),
            features: feature.row.features,
            ...(outcome ? {
              labels: encodeOfflineLabelsV1(
                outcome.outcome.labels,
                input.rewardDefinition.dwell.capMs,
              ),
            } : {}),
          };
          await writer.write(record);
        } catch (error) {
          localBlocker = stableBlocker(error);
          throw error;
        }
      },
      commit: () => undefined,
      abort: () => undefined,
    },
  );
  if (localBlocker) {
    await writer.abort();
    return { blocker: localBlocker };
  }
  if (replay.status !== 'verified') {
    await writer.abort();
    return { blocker: replay.blocker };
  }
  if (!decisionAt || seenLabels.size !== outcomes.size) {
    await writer.abort();
    return { blocker: 'prediction_v2_target_labels_incomplete' };
  }
  try {
    const auxiliaryDecisionId = privateAuxiliaryDecisionId(input.outcomeEvidence.decisionId);
    const auxiliaryRecords: TrainingSpoolRecord[] = [];
    const sortedOutcomes = [...input.outcomeEvidence.outcomes]
      .sort((left, right) => (
        left.actionKey.servedPosition - right.actionKey.servedPosition
        || compareText(actionIdentity(left.actionKey), actionIdentity(right.actionKey))
      ));
    for (const [index, outcome] of sortedOutcomes.entries()) {
      const encoded = encodeOfflineActionFeaturesV1({
        decisionId: auxiliaryDecisionId,
        actionKey: outcome.actionKey,
        decisionAt,
        featureAt: new Date(Date.parse(decisionAt) - 60_000).toISOString(),
        referenceAt: decisionAt,
        featureInput: {
          createdAt: new Date(Date.parse(decisionAt) - 86_400_000).toISOString(),
          recallSource: 'phase11_private_auxiliary',
          inNetwork: index % 2 === 0,
          retrievalEmbeddingScore: (index + 1) / 10,
        },
      });
      if (encoded.status !== 'encoded') throw new Error('prediction_v2_auxiliary_encoding_failed');
      auxiliaryRecords.push({
        contractVersion: 'prediction_training_spool_record_v2',
        evidenceRole: 'private_synthetic_auxiliary',
        decisionId: auxiliaryDecisionId,
        actionKey: encoded.row.actionKey,
        rowKey: rowKey('private_synthetic_auxiliary', auxiliaryDecisionId, encoded.row.actionKey),
        features: encoded.row.features,
        labels: Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [
          head,
          head === 'dwell' ? (index + 1) / (sortedOutcomes.length + 1) : (index + OFFLINE_REWARD_HEADS_V1.indexOf(head)) % 2,
        ])) as Record<OfflineRewardHeadV1, number>,
      });
    }
    const auxiliaryRootPreimage = {
      contractVersion: 'private_synthetic_auxiliary_training_evidence_v1' as const,
      owner: 'node_offline_prediction_v2' as const,
      generatorVersion: 'phase11_private_auxiliary_position_encoder_v1' as const,
      decisionId: auxiliaryDecisionId,
      records: auxiliaryRecords,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    for (const record of auxiliaryRecords) await writer.write(record);
    return {
      spool: await writer.finish(),
      auxiliaryRootSha256: digest(auxiliaryRootPreimage),
    };
  } catch (error) {
    await writer.abort();
    return { blocker: stableBlocker(error) };
  }
}

function privateAuxiliaryDecisionId(targetDecisionId: string): string {
  const target = canonicalDecisionId(targetDecisionId);
  const targetFold = assignDecisionFoldV1(target, 2);
  for (let nonce = 0; nonce < 65_536; nonce += 1) {
    const bytes = createHash('sha256')
      .update(`phase11_private_auxiliary_position_encoder_v1:${target}:${nonce}`)
      .digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    if (compareText(id, target) > 0 && assignDecisionFoldV1(id, 2) !== targetFold) return id;
  }
  throw new Error('prediction_v2_auxiliary_fold_unavailable');
}

async function inspectTrainingSpool(
  input: CrossFittedPredictionInputV2,
  spool: CanonicalSpoolV2,
  limits: NonNullable<CrossFittedPredictionInputV2['spoolLimits']>,
): Promise<{
  featureKeys: string[];
  folds: Array<{
    foldId: number;
    trainingDecisionIds: string[];
    holdoutDecisionIds: string[];
    trainingRowKeys: string[];
    holdoutRowKeys: string[];
  }>;
  resourceConfigSha256: string;
} | { blocker: string }> {
  const featureKeys = new Set<string>();
  const rowKeysByDecision = new Map<string, string[]>();
  const seenRowKeys = new Set<string>();
  const trainingRowsByFold = [0, 0];
  const holdoutRowsByFold = [0, 0];
  const trainingDecisionsByFold = [new Set<string>(), new Set<string>()];
  const holdoutDecisionsByFold = [new Set<string>(), new Set<string>()];
  const resourceLimits = input.resourceConfig.limits;
  const totalRowLimit = resourceLimits.maxHoldoutRowsPerFold * 2;
  if (!Number.isSafeInteger(totalRowLimit)) {
    return { blocker: 'model_state_resource_limit_exceeded' };
  }
  try {
    for await (const entry of readCanonicalSpoolRecordsV2(spool.stream, limits)) {
      const parsed = trainingSpoolRecordSchema.safeParse(entry.value);
      if (!parsed.success) return { blocker: 'prediction_v2_spool_contract_invalid' };
      const row = parsed.data;
      if (!row.labels) continue;
      if (seenRowKeys.has(row.rowKey)) {
        return { blocker: 'prediction_v2_spool_contract_invalid' };
      }
      const holdoutFold = assignDecisionFoldV1(row.decisionId, 2);
      const trainingFold = holdoutFold === 0 ? 1 : 0;
      const newHoldoutDecision = !holdoutDecisionsByFold[holdoutFold]!.has(row.decisionId);
      const newTrainingDecision = !trainingDecisionsByFold[trainingFold]!.has(row.decisionId);
      if (
        seenRowKeys.size >= totalRowLimit
        || holdoutRowsByFold[holdoutFold]! >= resourceLimits.maxHoldoutRowsPerFold
        || trainingRowsByFold[trainingFold]! >= resourceLimits.maxTrainingRowsPerFold
        || (newHoldoutDecision
          && holdoutDecisionsByFold[holdoutFold]!.size
            >= resourceLimits.maxHoldoutDecisionsPerFold)
        || (newTrainingDecision
          && trainingDecisionsByFold[trainingFold]!.size
            >= resourceLimits.maxTrainingDecisionsPerFold)
      ) return { blocker: 'model_state_resource_limit_exceeded' };
      for (const key of Object.keys(row.features)) {
        if (
          key !== 'bias'
          && !featureKeys.has(key)
          && featureKeys.size >= resourceLimits.maxCoefficientsPerHead
        ) return { blocker: 'model_state_resource_limit_exceeded' };
      }
      const rows = rowKeysByDecision.get(row.decisionId) ?? [];
      rows.push(row.rowKey);
      rowKeysByDecision.set(row.decisionId, rows);
      seenRowKeys.add(row.rowKey);
      holdoutRowsByFold[holdoutFold]! += 1;
      trainingRowsByFold[trainingFold]! += 1;
      holdoutDecisionsByFold[holdoutFold]!.add(row.decisionId);
      trainingDecisionsByFold[trainingFold]!.add(row.decisionId);
      Object.keys(row.features).filter((key) => key !== 'bias')
        .forEach((key) => featureKeys.add(key));
    }
  } catch (error) { return { blocker: stableBlocker(error) }; }
  const decisions = [...rowKeysByDecision.keys()].sort(compareText);
  const keys = [...featureKeys].filter((key) => key !== 'bias').sort(compareText);
  const folds = [0, 1].map((foldId) => {
    const holdoutDecisionIds = decisions.filter((id) => assignDecisionFoldV1(id, 2) === foldId);
    const trainingDecisionIds = decisions.filter((id) => assignDecisionFoldV1(id, 2) !== foldId);
    return {
      foldId,
      trainingDecisionIds,
      holdoutDecisionIds,
      trainingRowKeys: trainingDecisionIds.flatMap((id) => rowKeysByDecision.get(id) ?? []).sort(compareText),
      holdoutRowKeys: holdoutDecisionIds.flatMap((id) => rowKeysByDecision.get(id) ?? []).sort(compareText),
    };
  });
  const state = {
    folds: folds.map((fold) => ({
      ...fold,
      heads: OFFLINE_REWARD_HEADS_V1.map((head) => ({
        head,
        intercept: 0,
        coefficients: keys.map((feature) => ({ feature, value: 0 })),
      })),
    })),
  };
  const budget = evaluatePhase11ModelStateBudgetV1(input.resourceConfig, state);
  if (budget.status !== 'within_budget') return budget;
  return { featureKeys: keys, folds, resourceConfigSha256: budget.resourceConfigSha256 };
}

async function trainFromSpool(
  input: CrossFittedPredictionInputV2,
  spool: CanonicalSpoolV2,
  inspected: Exclude<Awaited<ReturnType<typeof inspectTrainingSpool>>, { blocker: string }>,
  limits: NonNullable<CrossFittedPredictionInputV2['spoolLimits']>,
): Promise<{ models: Map<number, FoldModels>; folds: CrossFittedModelBundleV2['folds'] }
  | { blocker: string }> {
  const models = new Map<number, FoldModels>();
  const folds: CrossFittedModelBundleV2['folds'] = [];
  try {
    for (const fold of inspected.folds) {
      const trainingIds = new Set(fold.trainingDecisionIds);
      const foldModels = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [head, {
        intercept: 0,
        coefficients: Object.fromEntries(inspected.featureKeys.map((key) => [key, 0])),
      }])) as FoldModels;
      for (let epoch = 0; epoch < input.trainingConfig.epochs; epoch += 1) {
        const gradients = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [head, {
          intercept: 0,
          coefficients: Object.fromEntries(inspected.featureKeys.map((key) => [key, 0])),
        }])) as FoldModels;
        let rowCount = 0;
        for await (const entry of readCanonicalSpoolRecordsV2(spool.stream, limits)) {
          const row = trainingSpoolRecordSchema.parse(entry.value);
          if (!row.labels || !trainingIds.has(row.decisionId)) continue;
          rowCount += 1;
          for (const head of OFFLINE_REWARD_HEADS_V1) {
            const model = foldModels[head];
            let logit = model.intercept;
            for (const key of inspected.featureKeys) {
              logit += model.coefficients[key]! * (row.features[key] ?? 0);
            }
            const residual = stableSigmoid(logit) - row.labels[head];
            gradients[head].intercept += residual;
            for (const key of inspected.featureKeys) {
              gradients[head].coefficients[key]! += residual * (row.features[key] ?? 0);
            }
          }
        }
        if (rowCount === 0) return { blocker: 'empty_training_fold' };
        for (const head of OFFLINE_REWARD_HEADS_V1) {
          const model = foldModels[head];
          model.intercept = positiveZero(
            model.intercept - input.trainingConfig.learningRate
              * gradients[head].intercept / rowCount,
          );
          for (const key of inspected.featureKeys) {
            const gradient = gradients[head].coefficients[key]! / rowCount
              + input.trainingConfig.l2Lambda * model.coefficients[key]!;
            model.coefficients[key] = positiveZero(
              model.coefficients[key]! - input.trainingConfig.learningRate * gradient,
            );
          }
        }
      }
      const heads = OFFLINE_REWARD_HEADS_V1.map((head) => ({
        head,
        intercept: foldModels[head].intercept,
        coefficients: inspected.featureKeys.map((feature) => ({
          feature,
          value: foldModels[head].coefficients[feature]!,
        })),
      }));
      const foldPreimage = { ...fold, heads };
      folds.push({ ...foldPreimage, foldModelSha256: digest(foldPreimage) });
      models.set(fold.foldId, foldModels);
    }
  } catch (error) { return { blocker: stableBlocker(error) }; }
  return { models, folds };
}

async function collectTargetSummary(
  input: NormalizedPredictionInputV2,
): Promise<{ summary: TargetSummary } | { blocker: string }> {
  let summary: TargetSummary | undefined;
  let localBlocker: string | undefined;
  const replay = await replayVerifiedTargetDistributionV2(input.targetEvidence, {
    onDecisionStart: (decision) => {
      if (summary) { localBlocker = 'prediction_v2_multiple_target_decisions'; throw new Error(); }
      summary = {
        decisionId: decision.source.decisionId,
        decisionLogSha256: decision.decisionLogSha256,
        candidatePoolSha256: decision.candidatePoolSha256,
        steps: [],
        predictionCount: 0,
      };
    },
    onStep: (_decision, step) => {
      if (!summary || step.servedPosition !== summary.steps.length + 1) {
        localBlocker = 'prediction_v2_target_order_invalid'; throw new Error();
      }
      const actionHash = createHash('sha256');
      for (const action of step.actions) {
        actionHash.update(`${canonicalWireJsonV1(action.actionKey)}\n`);
      }
      const nextPredictionCount = summary.predictionCount + step.actions.length;
      if (!Number.isSafeInteger(nextPredictionCount)) {
        localBlocker = 'prediction_v2_target_count_invalid'; throw new Error();
      }
      summary.steps.push({
        servedPosition: step.servedPosition,
        actionCount: step.actions.length,
        actionKeysSha256: actionHash.digest('hex'),
      });
      summary.predictionCount = nextPredictionCount;
    },
    commit: () => undefined,
    abort: () => undefined,
  });
  if (replay.status !== 'verified' || !summary) {
    return { blocker: localBlocker ?? (replay.status === 'not_evaluable'
      ? replay.blocker : 'prediction_v2_target_empty') };
  }
  return { summary };
}

async function buildPredictionSpool(
  input: NormalizedPredictionInputV2,
  trainingSpool: CanonicalSpoolV2,
  limits: NonNullable<CrossFittedPredictionInputV2['spoolLimits']>,
  summary: TargetSummary,
  bundle: CrossFittedModelBundleV2,
  models: Map<number, FoldModels>,
): Promise<{
  spool: CanonicalSpoolV2;
  predictionCount: number;
  peakStepActions: number;
  peakStepBytes: number;
}
  | { blocker: string }> {
  const writer = await createCanonicalSpoolWriterV2(limits);
  const foldId = assignDecisionFoldV1(summary.decisionId, 2);
  const foldModels = models.get(foldId);
  if (!foldModels) { await writer.abort(); return { blocker: 'prediction_v2_model_missing' }; }
  let predictionCount = 0;
  let peakStepActions = 0;
  let peakStepBytes = 0;
  let currentPosition = 0;
  let currentRecords: PredictionRecordV2[] = [];
  const decisionHash = createHash('sha256');
  const writeDecisionRecord = async (record: PredictionRecordV2): Promise<number> => {
    await writer.write(record);
    const line = `${canonicalWireJsonV1(record)}\n`;
    decisionHash.update(line);
    return Buffer.byteLength(line);
  };
  const flushStep = async () => {
    if (currentPosition === 0) return;
    const expected = summary.steps[currentPosition - 1];
    if (!expected || currentRecords.length !== expected.actionCount) {
      throw new Error('prediction_v2_step_membership_mismatch');
    }
    const actionHash = createHash('sha256');
    for (const record of currentRecords) {
      if (record.recordType !== 'prediction') {
        throw new Error('prediction_v2_step_membership_mismatch');
      }
      actionHash.update(`${canonicalWireJsonV1(record.actionKey)}\n`);
    }
    if (actionHash.digest('hex') !== expected.actionKeysSha256) {
      throw new Error('prediction_v2_step_membership_mismatch');
    }
    const start: PredictionRecordV2 = {
      recordType: 'step_start',
      decisionId: summary.decisionId,
      servedPosition: currentPosition,
      expectedActionCount: currentRecords.length,
    };
    const stepHash = createHash('sha256');
    let stepBytes = await writeDecisionRecord(start);
    stepHash.update(`${canonicalWireJsonV1(start)}\n`);
    for (const record of currentRecords) {
      stepBytes += await writeDecisionRecord(record);
      stepHash.update(`${canonicalWireJsonV1(record)}\n`);
    }
    const end: PredictionRecordV2 = {
      recordType: 'step_end',
      decisionId: summary.decisionId,
      servedPosition: currentPosition,
      actualActionCount: currentRecords.length,
      stepSha256: stepHash.digest('hex'),
    };
    stepBytes += await writeDecisionRecord(end);
    peakStepActions = Math.max(peakStepActions, currentRecords.length);
    peakStepBytes = Math.max(peakStepBytes, stepBytes);
    currentRecords = [];
  };
  try {
    const start: PredictionRecordV2 = {
      recordType: 'decision_start',
      contractVersion: 'cross_fitted_prediction_stream_v2',
      decisionId: summary.decisionId,
      decisionLogSha256: summary.decisionLogSha256,
      candidatePoolSha256: summary.candidatePoolSha256,
      modelBundleSha256: bundle.modelBundleSha256,
      expectedStepCount: summary.steps.length,
      servable: false,
    };
    await writeDecisionRecord(start);
    for await (const entry of readCanonicalSpoolRecordsV2(trainingSpool.stream, limits)) {
      const row = trainingSpoolRecordSchema.parse(entry.value);
      if (row.evidenceRole !== 'evaluation_target') continue;
      if (currentPosition !== row.actionKey.servedPosition) {
        await flushStep();
        if (row.actionKey.servedPosition !== currentPosition + 1) {
          throw new Error('prediction_v2_step_order_invalid');
        }
        currentPosition = row.actionKey.servedPosition;
      }
      const primitivePredictions = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [
        head,
        predict(foldModels[head], row.features),
      ])) as OfflinePrimitivePredictionsV1;
      currentRecords.push({
        recordType: 'prediction',
        decisionId: summary.decisionId,
        servedPosition: currentPosition,
        actionKey: row.actionKey,
        foldId,
        primitivePredictions,
        qHat: primitiveQHat(primitivePredictions, input.rewardDefinition),
      });
      predictionCount += 1;
    }
    await flushStep();
    if (
      currentPosition !== summary.steps.length
      || predictionCount === 0
      || predictionCount !== summary.predictionCount
    ) {
      throw new Error('prediction_v2_prediction_incomplete');
    }
    await writer.write({
      recordType: 'decision_end',
      decisionId: summary.decisionId,
      actualStepCount: summary.steps.length,
      actualPredictionCount: predictionCount,
      decisionSha256: decisionHash.digest('hex'),
    } satisfies PredictionRecordV2);
    return {
      spool: await writer.finish(),
      predictionCount,
      peakStepActions,
      peakStepBytes,
    };
  } catch (error) {
    await writer.abort();
    return { blocker: stableBlocker(error) };
  }
}

function predict(model: HeadModel, features: Record<string, number>): number {
  let logit = model.intercept;
  for (const key of Object.keys(model.coefficients).sort(compareText)) {
    logit += model.coefficients[key]! * (features[key] ?? 0);
  }
  return stableSigmoid(logit);
}

function primitiveQHat(
  predictions: OfflinePrimitivePredictionsV1,
  reward: CrossFittedPredictionInputV2['rewardDefinition'],
): number {
  let value = 0;
  for (const head of OFFLINE_REWARD_HEADS_V1) {
    if (head !== 'dwell') value += reward.weights[head] * predictions[head];
  }
  value += reward.dwell.weight * predictions.dwell
    * reward.dwell.capMs / reward.dwell.scaleMs;
  if (!Number.isFinite(value)) throw new Error('prediction_v2_numerical_error');
  return positiveZero(value);
}

async function compareCanonicalStreams(
  left: ProducedCrossFittedPredictionSetV2['predictionStream'],
  right: ProducedCrossFittedPredictionSetV2['predictionStream'],
  limits: NonNullable<CrossFittedPredictionInputV2['spoolLimits']>,
): Promise<boolean> {
  const leftIterator = readCanonicalSpoolRecordsV2(left, limits)[Symbol.asyncIterator]();
  const rightIterator = readCanonicalSpoolRecordsV2(right, limits)[Symbol.asyncIterator]();
  try {
    while (true) {
      const [leftEntry, rightEntry] = await Promise.all([leftIterator.next(), rightIterator.next()]);
      if (leftEntry.done || rightEntry.done) return leftEntry.done === rightEntry.done;
      if (leftEntry.value.raw !== rightEntry.value.raw) return false;
    }
  } finally {
    await Promise.allSettled([
      leftIterator.return?.(undefined),
      rightIterator.return?.(undefined),
    ]);
  }
}

function parseCanonicalSingle<T>(raw: string, schema: z.ZodType<T>): T | undefined {
  if (!raw.endsWith('\n') || raw.indexOf('\n') !== raw.length - 1) return undefined;
  const wire = raw.slice(0, -1);
  let value: unknown;
  try { value = JSON.parse(wire); } catch { return undefined; }
  if (canonicalWireJsonV1(value) !== wire) return undefined;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function stableBlocker(error: unknown): string {
  const blocker = error instanceof Error ? error.message : '';
  if (blocker.startsWith('prediction_') || blocker.startsWith('model_state_')
    || blocker === 'empty_training_fold') return blocker;
  if (blocker.includes('resource')) return 'prediction_spool_resource_limit_exceeded';
  return 'prediction_v2_io_or_contract_failure';
}

function positiveZero(value: number): number { return value === 0 ? 0 : value; }

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).every((key) => recursivelyFrozen(Reflect.get(value, key), seen));
}
