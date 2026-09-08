import {
  offlinePredictionRequestSchema,
  offlineSnapshotManifestSchema,
  offlineTrainingExampleSchema,
  type OfflinePredictionRequestV1,
  type OfflineSnapshotManifestV1,
  type OfflineTrainingExampleV1,
} from '../contracts/artifacts';
import {
  encodeOfflineActionFeaturesV1,
  type EncodedOfflineActionFeatureV1,
} from '../features/encode';
import { canonicalJsonV1, selfSha256V1, sha256Text } from './canonical';
import type { VerifiedTargetDistributionEvidenceV1 } from './targetDistribution';

const verifiedSnapshot = Symbol('verifiedOfflinePredictionSnapshot');

type SnapshotFilesV1 = {
  datasetVersion: string;
  immutableSourceVersion: string;
  sourceValidNdjson: string;
  predictionRequestNdjson: string;
  datasetManifestRaw: string;
  targetEvidence: VerifiedTargetDistributionEvidenceV1;
};

export type OfflinePredictionTrustedRootsV1 = {
  datasetVersion: string;
  immutableSourceVersion: string;
  sourceValidNdjsonSha256: string;
  predictionRequestNdjsonSha256: string;
  datasetManifestSha256: string;
  targetDistributionNdjsonSha256: string;
  targetDistributionManifestSha256: string;
  targetDistributionVerificationReceiptSha256: string;
};

export type OfflinePredictionSnapshotVerificationInputV1 = SnapshotFilesV1 & {
  sourceKind: 'synthetic' | 'historical';
  manifest: OfflineSnapshotManifestV1;
  trustedRoots: OfflinePredictionTrustedRootsV1;
};

export type VerifiedOfflinePredictionSnapshotV1 = {
  readonly [verifiedSnapshot]: true;
  manifest: OfflineSnapshotManifestV1;
  trainingRows: Array<{
    source: OfflineTrainingExampleV1;
    encoded: EncodedOfflineActionFeatureV1;
  }>;
  predictionRows: Array<{
    source: OfflinePredictionRequestV1;
    encoded: EncodedOfflineActionFeatureV1;
  }>;
};

export type VerifyOfflinePredictionSnapshotResultV1 =
  | { status: 'verified'; snapshot: VerifiedOfflinePredictionSnapshotV1 }
  | { status: 'not_evaluable'; blocker: string };

const lineCount = (raw: string): number => raw === '' ? 0 : raw.trimEnd().split('\n').length;

export function snapshotTrustedRootsV1(
  files: SnapshotFilesV1,
): OfflinePredictionTrustedRootsV1 {
  return {
    datasetVersion: files.datasetVersion,
    immutableSourceVersion: files.immutableSourceVersion,
    sourceValidNdjsonSha256: sha256Text(files.sourceValidNdjson),
    predictionRequestNdjsonSha256: sha256Text(files.predictionRequestNdjson),
    datasetManifestSha256: sha256Text(files.datasetManifestRaw),
    targetDistributionNdjsonSha256: files.targetEvidence.manifest.distributionNdjsonSha256,
    targetDistributionManifestSha256: files.targetEvidence.targetManifestSha256,
    targetDistributionVerificationReceiptSha256: files.targetEvidence.targetReceiptRawSha256,
  };
}

export function buildOfflinePredictionSnapshotManifestV1(
  files: SnapshotFilesV1,
): OfflineSnapshotManifestV1 {
  const roots = snapshotTrustedRootsV1(files);
  const preimage = {
    contractVersion: 'offline_prediction_snapshot_manifest_v1' as const,
    featureSchemaVersion: 'social_phoenix_action_position_1_based_v1' as const,
    trainingExampleSchemaVersion: 'offline_prediction_training_example_v1' as const,
    predictionRequestSchemaVersion: 'offline_prediction_request_v1' as const,
    ...roots,
    trainingRowCount: lineCount(files.sourceValidNdjson),
    predictionRequestRowCount: lineCount(files.predictionRequestNdjson),
    realDatasetEligible: false as const,
    servable: false as const,
  };
  return {
    ...preimage,
    snapshotManifestSha256: sha256Text(canonicalJsonV1(preimage)),
  };
}

function parseNdjson(raw: string): unknown[] | undefined {
  if (!raw.endsWith('\n')) return undefined;
  const lines = raw.slice(0, -1).split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  if (lines.some((line) => line.length === 0 || Buffer.byteLength(line) > 1 << 20)) return undefined;
  try {
    return lines.map((line) => JSON.parse(line));
  } catch {
    return undefined;
  }
}

const actionIdentity = (row: { decisionId: string; actionKey: {
  candidateNamespace: string;
  candidateId: string;
  servedPosition: number;
} }): string => [
  row.decisionId.toLowerCase(),
  row.actionKey.candidateNamespace,
  row.actionKey.candidateId,
  row.actionKey.servedPosition,
].join('\u0000');

export function verifyOfflinePredictionSnapshotSetV1(
  input: OfflinePredictionSnapshotVerificationInputV1,
): VerifyOfflinePredictionSnapshotResultV1 {
  if (input.sourceKind !== 'synthetic') {
    return { status: 'not_evaluable', blocker: 'full_support_feature_snapshot_unavailable' };
  }
  if (
    Buffer.byteLength(input.sourceValidNdjson) > 512 * 1024 * 1024
    || Buffer.byteLength(input.predictionRequestNdjson) > 512 * 1024 * 1024
    || Buffer.byteLength(input.sourceValidNdjson)
      + Buffer.byteLength(input.predictionRequestNdjson)
      + Buffer.byteLength(input.datasetManifestRaw) > 1024 * 1024 * 1024
    || Buffer.byteLength(input.datasetManifestRaw) > 1 << 20
  ) {
    return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
  }
  const actualRoots = snapshotTrustedRootsV1(input);
  if (canonicalJsonV1(actualRoots) !== canonicalJsonV1(input.trustedRoots)) {
    return { status: 'not_evaluable', blocker: 'snapshot_trusted_root_mismatch' };
  }
  const parsedManifest = offlineSnapshotManifestSchema.safeParse(input.manifest);
  if (!parsedManifest.success) {
    return { status: 'not_evaluable', blocker: 'snapshot_contract_invalid' };
  }
  const manifest = parsedManifest.data;
  if (
    manifest.snapshotManifestSha256 !== selfSha256V1(manifest, 'snapshotManifestSha256')
    || canonicalJsonV1(actualRoots) !== canonicalJsonV1({
      datasetVersion: manifest.datasetVersion,
      immutableSourceVersion: manifest.immutableSourceVersion,
      sourceValidNdjsonSha256: manifest.sourceValidNdjsonSha256,
      predictionRequestNdjsonSha256: manifest.predictionRequestNdjsonSha256,
      datasetManifestSha256: manifest.datasetManifestSha256,
      targetDistributionNdjsonSha256: manifest.targetDistributionNdjsonSha256,
      targetDistributionManifestSha256: manifest.targetDistributionManifestSha256,
      targetDistributionVerificationReceiptSha256:
        manifest.targetDistributionVerificationReceiptSha256,
    })
    || manifest.datasetVersion !== input.datasetVersion
    || manifest.datasetVersion !== input.targetEvidence.manifest.datasetVersion
    || manifest.immutableSourceVersion !== input.immutableSourceVersion
  ) {
    return { status: 'not_evaluable', blocker: 'snapshot_manifest_digest_mismatch' };
  }
  const rawTraining = parseNdjson(input.sourceValidNdjson);
  const rawPrediction = parseNdjson(input.predictionRequestNdjson);
  if (!rawTraining || !rawPrediction) {
    return { status: 'not_evaluable', blocker: 'snapshot_contract_invalid' };
  }
  if (rawTraining.length + rawPrediction.length > 1_000_000) {
    return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
  }
  if (
    rawTraining.length !== manifest.trainingRowCount
    || rawPrediction.length !== manifest.predictionRequestRowCount
  ) {
    return { status: 'not_evaluable', blocker: 'snapshot_contract_invalid' };
  }
  const training: OfflineTrainingExampleV1[] = [];
  for (const row of rawTraining) {
    const parsed = offlineTrainingExampleSchema.safeParse(row);
    if (!parsed.success) return { status: 'not_evaluable', blocker: 'snapshot_contract_invalid' };
    if (
      Date.parse(parsed.data.observedThrough)
      < Date.parse(parsed.data.decisionAt) + parsed.data.outcomeHorizonMs
    ) {
      return { status: 'not_evaluable', blocker: 'outcome_window_incomplete' };
    }
    training.push(parsed.data);
  }
  const prediction: OfflinePredictionRequestV1[] = [];
  for (const row of rawPrediction) {
    const parsed = offlinePredictionRequestSchema.safeParse(row);
    if (!parsed.success) return { status: 'not_evaluable', blocker: 'snapshot_contract_invalid' };
    prediction.push(parsed.data);
  }
  const encode = (source: OfflineTrainingExampleV1 | OfflinePredictionRequestV1) => (
    encodeOfflineActionFeaturesV1({
      decisionId: source.decisionId,
      actionKey: source.actionKey,
      decisionAt: source.decisionAt,
      featureAt: source.featureAt,
      referenceAt: source.referenceAt,
      featureInput: source.featureInput,
    })
  );
  const trainingRows = training.map((source) => ({ source, encoded: encode(source) }));
  const predictionRows = prediction.map((source) => ({ source, encoded: encode(source) }));
  if (
    trainingRows.some((entry) => entry.encoded.status !== 'encoded')
    || predictionRows.some((entry) => entry.encoded.status !== 'encoded')
  ) {
    return { status: 'not_evaluable', blocker: 'snapshot_feature_boundary_mismatch' };
  }
  const encodedTraining = trainingRows.map((entry) => ({
    source: entry.source,
    encoded: entry.encoded.status === 'encoded' ? entry.encoded.row : undefined!,
  }));
  const encodedPrediction = predictionRows.map((entry) => ({
    source: entry.source,
    encoded: entry.encoded.status === 'encoded' ? entry.encoded.row : undefined!,
  }));
  if ([...encodedTraining, ...encodedPrediction].some((entry) => (
    Object.keys(entry.encoded.features).length > 4_096
  ))) {
    return { status: 'not_evaluable', blocker: 'resource_limit_exceeded' };
  }
  const trainingIdentities = new Set(encodedTraining.map((entry) => actionIdentity(entry.source)));
  if (trainingIdentities.size !== encodedTraining.length) {
    return { status: 'not_evaluable', blocker: 'snapshot_action_duplicate' };
  }
  const predictionIdentities = new Set(encodedPrediction.map((entry) => actionIdentity(entry.source)));
  if (predictionIdentities.size !== encodedPrediction.length) {
    return { status: 'not_evaluable', blocker: 'snapshot_action_duplicate' };
  }
  const requiredSupport = input.targetEvidence.decisions.flatMap((decision) => (
    decision.steps.flatMap((step) => step.actions.map(({ actionKey }) => actionIdentity({
      decisionId: decision.decisionId,
      actionKey,
    })))
  ));
  if (requiredSupport.some((required) => !predictionIdentities.has(required))) {
    return { status: 'not_evaluable', blocker: 'full_support_feature_snapshot_unavailable' };
  }
  return {
    status: 'verified',
    snapshot: {
      [verifiedSnapshot]: true,
      manifest,
      trainingRows: encodedTraining,
      predictionRows: encodedPrediction,
    },
  };
}
