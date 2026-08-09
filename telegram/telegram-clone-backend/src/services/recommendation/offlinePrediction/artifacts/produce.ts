import {
  crossFittedTrainingConfigSchema,
  offlineRewardDefinitionSchema,
  type CrossFittedModelBundleV1,
  type CrossFittedTrainingConfigV1,
  type OfflineRewardDefinitionV1,
  type PredictionArtifactRecordV1,
  type PredictionSetManifestV1,
} from '../contracts/artifacts';
import {
  OFFLINE_REWARD_HEADS_V1,
  encodeOfflineLabelsV1,
  type OfflinePrimitivePredictionsV1,
  type OfflineRewardHeadV1,
} from '../contracts/reward';
import { assignDecisionFoldV1, canonicalDecisionId } from '../trainer/folds';
import {
  predictLogisticV1,
  trainFullBatchLogisticV1,
  type LogisticModelV1,
} from '../trainer/logistic';
import {
  canonicalJsonV1,
  canonicalNdjsonV1,
  canonicalWireJsonV1,
  sha256Text,
} from './canonical';
import type { VerifiedOfflinePredictionSnapshotV1 } from './snapshot';
import type { VerifiedTargetDistributionEvidenceV1 } from './targetDistribution';

type ProducerInputV1 = {
  snapshot: VerifiedOfflinePredictionSnapshotV1;
  targetEvidence: VerifiedTargetDistributionEvidenceV1;
  trainingConfig: CrossFittedTrainingConfigV1;
  rewardDefinition: OfflineRewardDefinitionV1;
};

export type ProducedCrossFittedPredictionSetV1 = {
  status: 'produced';
  bundle: CrossFittedModelBundleV1;
  modelBundleRaw: string;
  predictionStream: string;
  manifest: PredictionSetManifestV1;
  predictionSetManifestRaw: string;
};

export type ProduceCrossFittedPredictionSetResultV1 = ProducedCrossFittedPredictionSetV1
  | { status: 'not_evaluable'; blocker: string };

const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left),
  Buffer.from(right),
);

const actionIdentity = (value: { decisionId: string; actionKey: {
  candidateNamespace: string;
  candidateId: string;
  servedPosition: number;
} }): string => [
  canonicalDecisionId(value.decisionId),
  value.actionKey.candidateNamespace,
  value.actionKey.candidateId,
  value.actionKey.servedPosition,
].join('\u0000');

const setDigest = (decisionIds: readonly string[]): string => sha256Text(canonicalJsonV1(
  [...decisionIds].sort(compareText),
));

const sortedCoefficients = (model: LogisticModelV1): Array<{ key: string; value: number }> => (
  Object.entries(model.coefficients)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, value]) => ({ key, value: value === 0 ? 0 : value }))
);

function primitiveQHat(
  predictions: OfflinePrimitivePredictionsV1,
  reward: OfflineRewardDefinitionV1,
): number {
  let value = 0;
  for (const head of OFFLINE_REWARD_HEADS_V1) {
    if (head === 'dwell') continue;
    value += reward.weights[head] * predictions[head];
  }
  value += reward.dwell.weight
    * predictions.dwell
    * reward.dwell.capMs
    / reward.dwell.scaleMs;
  if (!Number.isFinite(value)) throw new Error('non_finite_prediction');
  return value === 0 ? 0 : value;
}

export function produceCrossFittedPredictionSetV1(
  input: ProducerInputV1,
): ProduceCrossFittedPredictionSetResultV1 {
  const parsedConfig = crossFittedTrainingConfigSchema.safeParse(input.trainingConfig);
  const parsedReward = offlineRewardDefinitionSchema.safeParse(input.rewardDefinition);
  if (!parsedConfig.success || !parsedReward.success) {
    return { status: 'not_evaluable', blocker: 'invalid_training_contract' };
  }
  const config = parsedConfig.data;
  const reward = parsedReward.data;
  if (input.snapshot.trainingRows.some((row) => (
    row.source.outcomeHorizonMs !== reward.horizonMs
  ))) {
    return { status: 'not_evaluable', blocker: 'reward_horizon_mismatch' };
  }
  if (
    input.snapshot.manifest.targetDistributionNdjsonSha256
      !== input.targetEvidence.manifest.distributionNdjsonSha256
    || input.snapshot.manifest.targetDistributionManifestSha256
      !== input.targetEvidence.targetManifestSha256
    || input.snapshot.manifest.targetDistributionVerificationReceiptSha256
      !== input.targetEvidence.targetReceiptRawSha256
  ) {
    return { status: 'not_evaluable', blocker: 'target_evidence_binding_mismatch' };
  }

  const decisionIds = [...new Set(input.snapshot.trainingRows.map((row) => (
    canonicalDecisionId(row.source.decisionId)
  )))].sort(compareText);
  if (decisionIds.length < config.foldCount) {
    return { status: 'not_evaluable', blocker: 'fold_training_complement_empty' };
  }
  if (input.targetEvidence.decisions.some((decision) => (
    !decisionIds.includes(canonicalDecisionId(decision.decisionId))
  ))) {
    return { status: 'not_evaluable', blocker: 'holdout_decision_missing' };
  }
  const foldModels = new Map<number, Record<OfflineRewardHeadV1, LogisticModelV1>>();
  const folds: CrossFittedModelBundleV1['folds'] = [];
  try {
    for (let foldId = 0; foldId < config.foldCount; foldId += 1) {
      const holdoutDecisionIds = decisionIds.filter((id) => (
        assignDecisionFoldV1(id, config.foldCount) === foldId
      ));
      const trainingDecisionIds = decisionIds.filter((id) => (
        assignDecisionFoldV1(id, config.foldCount) !== foldId
      ));
      if (holdoutDecisionIds.length === 0 || trainingDecisionIds.length === 0) {
        return { status: 'not_evaluable', blocker: 'fold_training_complement_empty' };
      }
      const trainingSet = new Set(trainingDecisionIds);
      if (holdoutDecisionIds.some((id) => trainingSet.has(id))) {
        return { status: 'not_evaluable', blocker: 'fold_leakage_detected' };
      }
      const models = {} as Record<OfflineRewardHeadV1, LogisticModelV1>;
      const heads = OFFLINE_REWARD_HEADS_V1.map((head) => {
        const rows = input.snapshot.trainingRows
          .filter((row) => trainingSet.has(canonicalDecisionId(row.source.decisionId)))
          .map((row) => ({
            rowId: actionIdentity(row.source),
            features: row.encoded.features,
            label: encodeOfflineLabelsV1(row.source.labels, reward.dwell.capMs)[head],
          }));
        const model = trainFullBatchLogisticV1(rows, config);
        models[head] = model;
        return {
          head,
          intercept: model.intercept === 0 ? 0 : model.intercept,
          coefficients: sortedCoefficients(model),
        };
      });
      const foldPreimage = {
        foldId,
        trainingDecisionIds,
        holdoutDecisionIds,
        trainingDecisionSetSha256: setDigest(trainingDecisionIds),
        holdoutDecisionSetSha256: setDigest(holdoutDecisionIds),
        heads,
      };
      folds.push({
        ...foldPreimage,
        foldModelSha256: sha256Text(canonicalJsonV1(foldPreimage)),
      });
      foldModels.set(foldId, models);
    }
  } catch {
    return { status: 'not_evaluable', blocker: 'training_numerical_error' };
  }

  const rewardDefinitionSha256 = sha256Text(canonicalJsonV1(reward));
  const trainingConfigSha256 = sha256Text(canonicalJsonV1(config));
  const bundlePreimage = {
    contractVersion: 'cross_fitted_model_bundle_v1' as const,
    datasetVersion: input.snapshot.manifest.datasetVersion,
    trainingExamplesNdjsonSha256: input.snapshot.manifest.sourceValidNdjsonSha256,
    trainingDatasetManifestSha256: input.snapshot.manifest.datasetManifestSha256,
    snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
    rewardDefinitionSha256,
    featureSchemaVersion: input.snapshot.manifest.featureSchemaVersion,
    trainerVersion: config.trainerVersion,
    foldAssignmentVersion: config.foldAssignmentVersion,
    foldCount: config.foldCount,
    trainingConfigSha256,
    foldConfigSha256: sha256Text(canonicalJsonV1({
      foldAssignmentVersion: config.foldAssignmentVersion,
      foldCount: config.foldCount,
    })),
    folds,
    crossFitted: true as const,
    servable: false as const,
  };
  const bundle: CrossFittedModelBundleV1 = {
    ...bundlePreimage,
    modelBundleSha256: sha256Text(canonicalJsonV1(bundlePreimage)),
  };
  const modelBundleRaw = `${canonicalWireJsonV1(bundle)}\n`;

  const requestByIdentity = new Map(input.snapshot.predictionRows.map((row) => [
    actionIdentity(row.source),
    row,
  ]));
  const records: PredictionArtifactRecordV1[] = [];
  const perDecisionArtifacts: PredictionSetManifestV1['perDecisionArtifacts'] = [];
  let predictionCount = 0;
  try {
    for (const targetDecision of [...input.targetEvidence.decisions]
      .sort((left, right) => compareText(left.decisionId, right.decisionId))) {
      const support = targetDecision.steps.flatMap((step) => step.actions.map(({ actionKey }) => actionKey));
      if (new Set(support.map((key) => actionIdentity({
        decisionId: targetDecision.decisionId,
        actionKey: key,
      }))).size !== support.length) {
        return { status: 'not_evaluable', blocker: 'prediction_support_duplicate' };
      }
      const start: PredictionArtifactRecordV1 = {
        recordType: 'artifact_start',
        contractVersion: 'cross_fitted_prediction_artifact_stream_v1',
        decisionId: targetDecision.decisionId,
        decisionLogSha256: targetDecision.decisionLogSha256,
        candidatePoolSha256: targetDecision.candidatePoolSha256,
        modelBundleSha256: bundle.modelBundleSha256,
        objective: reward.objective,
        rewardDefinitionVersion: reward.definitionVersion,
        horizonMs: reward.horizonMs,
        featureSchemaVersion: input.snapshot.manifest.featureSchemaVersion,
        expectedPredictionCount: support.length,
        servable: false,
      };
      const foldId = assignDecisionFoldV1(targetDecision.decisionId, config.foldCount);
      const models = foldModels.get(foldId);
      if (!models) return { status: 'not_evaluable', blocker: 'prediction_model_missing' };
      const decisionRecords: PredictionArtifactRecordV1[] = [start];
      for (const actionKey of support) {
        const request = requestByIdentity.get(actionIdentity({
          decisionId: targetDecision.decisionId,
          actionKey,
        }));
        if (!request) {
          return { status: 'not_evaluable', blocker: 'full_support_feature_snapshot_unavailable' };
        }
        const primitivePredictions = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [
          head,
          predictLogisticV1(models[head], request.encoded.features),
        ])) as OfflinePrimitivePredictionsV1;
        decisionRecords.push({
          recordType: 'prediction',
          decisionId: targetDecision.decisionId,
          actionKey,
          foldId,
          primitivePredictions,
          qHat: primitiveQHat(primitivePredictions, reward),
        });
      }
      const perDecisionArtifactSha256 = sha256Text(canonicalNdjsonV1(decisionRecords));
      decisionRecords.push({
        recordType: 'artifact_end',
        decisionId: targetDecision.decisionId,
        expectedPredictionCount: support.length,
        actualPredictionCount: support.length,
        perDecisionArtifactSha256,
      });
      records.push(...decisionRecords);
      perDecisionArtifacts.push({
        decisionId: targetDecision.decisionId,
        perDecisionArtifactSha256,
      });
      predictionCount += support.length;
    }
  } catch {
    return { status: 'not_evaluable', blocker: 'prediction_numerical_error' };
  }
  const predictionStream = canonicalNdjsonV1(records);
  const manifestPreimage = {
    contractVersion: 'cross_fitted_prediction_set_manifest_v1' as const,
    datasetVersion: input.snapshot.manifest.datasetVersion,
    artifactStreamSha256: sha256Text(predictionStream),
    artifactCount: perDecisionArtifacts.length,
    predictionCount,
    perDecisionArtifacts,
    modelBundleSha256: bundle.modelBundleSha256,
    trainingExamplesNdjsonSha256: bundle.trainingExamplesNdjsonSha256,
    trainingDatasetManifestSha256: bundle.trainingDatasetManifestSha256,
    snapshotManifestSha256: bundle.snapshotManifestSha256,
    targetDistributionNdjsonSha256: input.targetEvidence.manifest.distributionNdjsonSha256,
    targetDistributionManifestSha256: input.targetEvidence.targetManifestSha256,
    targetDistributionVerificationReceiptSha256: input.targetEvidence.targetReceiptRawSha256,
    objective: reward.objective,
    rewardDefinitionVersion: reward.definitionVersion,
    rewardDefinitionSha256,
    horizonMs: reward.horizonMs,
    featureSchemaVersion: input.snapshot.manifest.featureSchemaVersion,
    servable: false as const,
  };
  const manifest: PredictionSetManifestV1 = {
    ...manifestPreimage,
    predictionSetVersion: sha256Text(canonicalJsonV1(manifestPreimage)),
  };
  return {
    status: 'produced',
    bundle,
    modelBundleRaw,
    predictionStream,
    manifest,
    predictionSetManifestRaw: `${canonicalWireJsonV1(manifest)}\n`,
  };
}
