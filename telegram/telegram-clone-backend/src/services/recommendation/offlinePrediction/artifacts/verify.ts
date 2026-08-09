import {
  crossFittedModelBundleSchema,
  predictionArtifactRecordSchema,
  predictionSetManifestSchema,
  type CrossFittedTrainingConfigV1,
  type OfflineRewardDefinitionV1,
  type PredictionArtifactRecordV1,
} from '../contracts/artifacts';
import type { OfflinePrimitivePredictionsV1 } from '../contracts/reward';
import { OFFLINE_TRAINER_VERSION } from '../trainer/logistic';
import {
  canonicalJsonV1,
  canonicalWireJsonV1,
  selfSha256V1,
  sha256Text,
} from './canonical';
import { produceCrossFittedPredictionSetV1 } from './produce';
import {
  verifyOfflinePredictionSnapshotSetV1,
  type OfflinePredictionSnapshotVerificationInputV1,
} from './snapshot';
import type { VerifiedTargetDistributionEvidenceV1 } from './targetDistribution';

const verifiedPredictionMember = Symbol('verifiedPredictionMember');
const verifiedPredictionResult = Symbol('verifiedPredictionResult');
const verifiedPredictionResults = new WeakSet<object>();
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export type VerifiedPredictionSetMemberV1 = {
  readonly [verifiedPredictionMember]: true;
  datasetVersion: string;
  predictionSetVersion: string;
  decisionId: string;
  decisionLogSha256: string;
  candidatePoolSha256: string;
  modelBundleSha256: string;
  perDecisionArtifactSha256: string;
  objective: string;
  rewardDefinitionVersion: string;
  horizonMs: number;
  predictions: Array<{
    actionKey: {
      candidateNamespace: 'serving_post_id' | 'model_post_id';
      candidateId: string;
      servedPosition: number;
    };
    foldId: number;
    primitivePredictions: OfflinePrimitivePredictionsV1;
    qHat: number;
  }>;
};

export type CrossFittedPredictionVerificationReceiptV1 = {
  contractVersion: 'cross_fitted_prediction_verification_receipt_v1';
  verifierVersion: 'cross_fitted_prediction_set_verifier_v1';
  trainerVersion: typeof OFFLINE_TRAINER_VERSION;
  status: 'verified';
  trainingExamplesNdjsonSha256: string;
  modelBundleSha256: string;
  predictionSetVersion: string;
  predictionSetManifestRawSha256: string;
  verificationReceiptSha256: string;
  servable: false;
};

type VerifyInputV1 = {
  snapshotInput: OfflinePredictionSnapshotVerificationInputV1;
  targetEvidence: VerifiedTargetDistributionEvidenceV1;
  trainingConfig: CrossFittedTrainingConfigV1;
  rewardDefinition: OfflineRewardDefinitionV1;
  modelBundleRaw: string;
  predictionStream: string;
  predictionSetManifestRaw: string;
};

export type VerifyCrossFittedPredictionSetResultV1 =
  | {
    readonly [verifiedPredictionResult]: true;
    status: 'verified';
    receipt: CrossFittedPredictionVerificationReceiptV1;
    members: VerifiedPredictionSetMemberV1[];
  }
  | { status: 'not_evaluable'; blocker: string };

export function isVerifiedCrossFittedPredictionSetResultV1(value: unknown): value is Extract<VerifyCrossFittedPredictionSetResultV1, { status: 'verified' }> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Extract<VerifyCrossFittedPredictionSetResultV1, { status: 'verified' }>>;
  return verifiedPredictionResults.has(value)
    && Object.prototype.hasOwnProperty.call(value, verifiedPredictionResult)
    && candidate[verifiedPredictionResult] === true
    && candidate.status === 'verified'
    && Boolean(candidate.receipt && typeof candidate.receipt === 'object')
    && Object.isFrozen(candidate.receipt)
    && Array.isArray(candidate.members)
    && candidate.members.length > 0
    && candidate.members.every((member) => Boolean(member && Object.prototype.hasOwnProperty.call(member, verifiedPredictionMember) && member[verifiedPredictionMember] === true));
}

function parseSingle(raw: string): unknown | undefined {
  if (
    Buffer.byteLength(raw) > 1 << 20
    || !raw.endsWith('\n')
  ) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseRecords(raw: string): PredictionArtifactRecordV1[] | undefined {
  if (Buffer.byteLength(raw) > 512 * 1024 * 1024 || !raw.endsWith('\n')) return undefined;
  try {
    const records: PredictionArtifactRecordV1[] = [];
    for (const line of raw.slice(0, -1).split('\n')) {
      if (Buffer.byteLength(line) > 1 << 20) return undefined;
      const parsed = predictionArtifactRecordSchema.safeParse(JSON.parse(line));
      if (!parsed.success) return undefined;
      records.push(parsed.data);
    }
    return records;
  } catch {
    return undefined;
  }
}

export function verifyCrossFittedPredictionSetV1(
  input: VerifyInputV1,
): VerifyCrossFittedPredictionSetResultV1 {
  const snapshot = verifyOfflinePredictionSnapshotSetV1(input.snapshotInput);
  if (snapshot.status !== 'verified') return snapshot;
  const bundleRaw = parseSingle(input.modelBundleRaw);
  const manifestRaw = parseSingle(input.predictionSetManifestRaw);
  const bundle = crossFittedModelBundleSchema.safeParse(bundleRaw);
  const manifest = predictionSetManifestSchema.safeParse(manifestRaw);
  const records = parseRecords(input.predictionStream);
  if (!bundle.success || !manifest.success || !records) {
    return { status: 'not_evaluable', blocker: 'prediction_set_membership_mismatch' };
  }
  if (
    input.modelBundleRaw !== `${canonicalWireJsonV1(bundle.data)}\n`
    || input.predictionSetManifestRaw !== `${canonicalWireJsonV1(manifest.data)}\n`
  ) {
    return { status: 'not_evaluable', blocker: 'prediction_canonical_wire_mismatch' };
  }
  const replay = produceCrossFittedPredictionSetV1({
    snapshot: snapshot.snapshot,
    targetEvidence: input.targetEvidence,
    trainingConfig: input.trainingConfig,
    rewardDefinition: input.rewardDefinition,
  });
  if (replay.status !== 'produced') return replay;
  if (canonicalJsonV1(bundle.data) !== canonicalJsonV1(replay.bundle)) {
    return { status: 'not_evaluable', blocker: 'prediction_training_replay_mismatch' };
  }
  if (input.predictionStream !== replay.predictionStream) {
    return { status: 'not_evaluable', blocker: 'prediction_training_replay_mismatch' };
  }
  if (
    canonicalJsonV1(manifest.data) !== canonicalJsonV1(replay.manifest)
    || manifest.data.predictionSetVersion
      !== selfSha256V1(manifest.data, 'predictionSetVersion')
  ) {
    return { status: 'not_evaluable', blocker: 'prediction_set_membership_mismatch' };
  }

  const members: VerifiedPredictionSetMemberV1[] = [];
  let index = 0;
  while (index < records.length) {
    const start = records[index];
    if (start.recordType !== 'artifact_start') {
      return { status: 'not_evaluable', blocker: 'prediction_set_membership_mismatch' };
    }
    index += 1;
    const predictions: VerifiedPredictionSetMemberV1['predictions'] = [];
    while (index < records.length && records[index].recordType === 'prediction') {
      const prediction = records[index];
      if (prediction.recordType !== 'prediction' || prediction.decisionId !== start.decisionId) {
        return { status: 'not_evaluable', blocker: 'prediction_set_membership_mismatch' };
      }
      predictions.push({
        actionKey: prediction.actionKey,
        foldId: prediction.foldId,
        primitivePredictions: prediction.primitivePredictions,
        qHat: prediction.qHat,
      });
      index += 1;
    }
    const end = records[index];
    if (
      !end
      || end.recordType !== 'artifact_end'
      || end.decisionId !== start.decisionId
      || predictions.length !== end.actualPredictionCount
    ) {
      return { status: 'not_evaluable', blocker: 'prediction_set_membership_mismatch' };
    }
    members.push({
      [verifiedPredictionMember]: true,
      datasetVersion: manifest.data.datasetVersion,
      predictionSetVersion: manifest.data.predictionSetVersion,
      decisionId: start.decisionId,
      decisionLogSha256: start.decisionLogSha256,
      candidatePoolSha256: start.candidatePoolSha256,
      modelBundleSha256: start.modelBundleSha256,
      perDecisionArtifactSha256: end.perDecisionArtifactSha256,
      objective: start.objective,
      rewardDefinitionVersion: start.rewardDefinitionVersion,
      horizonMs: start.horizonMs,
      predictions,
    });
    index += 1;
  }
  const receiptPreimage = {
    contractVersion: 'cross_fitted_prediction_verification_receipt_v1' as const,
    verifierVersion: 'cross_fitted_prediction_set_verifier_v1' as const,
    trainerVersion: OFFLINE_TRAINER_VERSION,
    status: 'verified' as const,
    trainingExamplesNdjsonSha256: bundle.data.trainingExamplesNdjsonSha256,
    modelBundleSha256: bundle.data.modelBundleSha256,
    predictionSetVersion: manifest.data.predictionSetVersion,
    predictionSetManifestRawSha256: sha256Text(input.predictionSetManifestRaw),
    servable: false as const,
  };
  const verified = {
    status: 'verified',
    receipt: {
      ...receiptPreimage,
      verificationReceiptSha256: sha256Text(canonicalJsonV1(receiptPreimage)),
    },
    members,
  } as Extract<VerifyCrossFittedPredictionSetResultV1, { status: 'verified' }>;
  Object.defineProperty(verified, verifiedPredictionResult, { value: true, enumerable: false, configurable: false });
  verifiedPredictionResults.add(verified);
  return deepFreeze(verified);
}
