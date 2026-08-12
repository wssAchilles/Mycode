import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  isVerifiedTargetDistributionEvidenceV1,
  verifyTargetDistributionEvidenceV1,
} from '../../src/services/recommendation/offlinePrediction/artifacts/targetDistribution';
import {
  buildOfflinePredictionSnapshotManifestV1,
  snapshotTrustedRootsV1,
  verifyOfflinePredictionSnapshotSetV1,
} from '../../src/services/recommendation/offlinePrediction/artifacts/snapshot';
import {
  produceCrossFittedPredictionSetV1,
} from '../../src/services/recommendation/offlinePrediction/artifacts/produce';
import {
  isVerifiedCrossFittedPredictionSetResultV1,
  verifyCrossFittedPredictionSetV1,
} from '../../src/services/recommendation/offlinePrediction/artifacts/verify';
import {
  projectVerifiedPredictionMemberToV1,
} from '../../src/services/recommendation/offlinePrediction/artifacts/projection';
import {
  canonicalJsonV1,
  canonicalNdjsonV1,
  canonicalWireJsonV1,
  sha256Text,
} from '../../src/services/recommendation/offlinePrediction/artifacts/canonical';
import {
  createCrossFittedTrainingConfigV1,
} from '../../src/services/recommendation/offlinePrediction/contracts/artifacts';
import {
  assignDecisionFoldV1,
} from '../../src/services/recommendation/offlinePrediction/trainer/folds';

const fixturePath = path.resolve(
  __dirname,
  '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/target_policy_distribution_stream_v1.json',
);

describe('Phase 9 offline prediction artifacts', () => {
  it('rejects frozen structural lookalikes without private verifier brands', () => {
    expect(isVerifiedTargetDistributionEvidenceV1(Object.freeze({}))).toBe(false);
    expect(isVerifiedCrossFittedPredictionSetResultV1(Object.freeze({ status: 'verified', members: [] }))).toBe(false);
  });
  it('accepts the finalized Rust stream/manifest/receipt without reproducing policy math', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const verified = verifyTargetDistributionEvidenceV1({
      sourceDecisionNdjson: fixture.sourceDecisionNdjson,
      sourceDatasetManifestRaw: fixture.sourceDatasetManifestRaw,
      policyConfigRaw: fixture.policyConfigRaw,
      distributionNdjson: fixture.expectedDistributionNdjson,
      targetManifestRaw: fixture.expectedTargetManifestRaw,
      verificationReceiptRaw: `${JSON.stringify(fixture.expectedReceipt)}\n`,
    });

    expect(verified.status).toBe('verified');
    if (verified.status !== 'verified') return;
    expect(isVerifiedTargetDistributionEvidenceV1(verified.evidence)).toBe(true);
    expect(verified.evidence.decisions).toHaveLength(1);
    expect(verified.evidence.decisions[0].steps).toHaveLength(2);
    expect(verified.evidence.decisions[0].steps[0].actions).toHaveLength(3);
    expect(Object.isFrozen(verified.evidence)).toBe(true);
    expect(Object.isFrozen(verified.evidence.decisions[0].steps[0].actions)).toBe(true);
  });

  it('fails closed when a Rust root or receipt is changed', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const receipt = { ...fixture.expectedReceipt, verifiedStepCount: 3 };
    expect(verifyTargetDistributionEvidenceV1({
      sourceDecisionNdjson: fixture.sourceDecisionNdjson,
      sourceDatasetManifestRaw: fixture.sourceDatasetManifestRaw,
      policyConfigRaw: fixture.policyConfigRaw,
      distributionNdjson: fixture.expectedDistributionNdjson,
      targetManifestRaw: fixture.expectedTargetManifestRaw,
      verificationReceiptRaw: `${JSON.stringify(receipt)}\n`,
    })).toEqual({ status: 'not_evaluable', blocker: 'target_receipt_digest_mismatch' });
  });

  it('rejects a fully rehashed target stream that omits a logged step', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const original = fixture.expectedDistributionNdjson.trimEnd().split('\n').map(JSON.parse);
    const kept = original.filter((record: any) => (
      record.recordType === 'decision_start'
      || record.recordType === 'decision_end'
      || record.servedPosition === 1
      || record.actionKey?.servedPosition === 1
    ));
    const end = kept.at(-1);
    end.stepCount = 1;
    end.actionProbabilityCount = 3;
    end.decisionRecordsSha256 = sha256Text(
      `${kept.slice(0, -1).map(canonicalJsonV1).join('\n')}\n`,
    );
    const distributionNdjson = canonicalNdjsonV1(kept);
    const manifest = JSON.parse(fixture.expectedTargetManifestRaw);
    manifest.stepCount = 1;
    manifest.actionProbabilityCount = 3;
    manifest.physicalRecordCount = kept.length;
    manifest.distributionNdjsonSha256 = sha256Text(distributionNdjson);
    const targetManifestRaw = `${canonicalWireJsonV1(manifest)}\n`;
    const receipt = {
      ...fixture.expectedReceipt,
      distributionNdjsonSha256: manifest.distributionNdjsonSha256,
      targetManifestSha256: sha256Text(targetManifestRaw),
      verifiedStepCount: 1,
      verifiedActionProbabilityCount: 3,
      verifiedPhysicalRecordCount: kept.length,
    };
    const { verificationReceiptSha256: _oldReceipt, ...receiptPreimage } = receipt;
    receipt.verificationReceiptSha256 = sha256Text(canonicalJsonV1(receiptPreimage));

    expect(verifyTargetDistributionEvidenceV1({
      sourceDecisionNdjson: fixture.sourceDecisionNdjson,
      sourceDatasetManifestRaw: fixture.sourceDatasetManifestRaw,
      policyConfigRaw: fixture.policyConfigRaw,
      distributionNdjson,
      targetManifestRaw,
      verificationReceiptRaw: `${canonicalWireJsonV1(receipt)}\n`,
    })).toEqual({ status: 'not_evaluable', blocker: 'target_decision_digest_mismatch' });
  });

  it('builds deterministic cross-fitted bytes and verifies them by retraining', () => {
    const context = syntheticContext();
    const snapshot = verifyOfflinePredictionSnapshotSetV1(context.snapshotInput);
    expect(snapshot.status).toBe('verified');
    if (snapshot.status !== 'verified') return;

    const first = produceCrossFittedPredictionSetV1({
      snapshot: snapshot.snapshot,
      targetEvidence: context.targetEvidence,
      trainingConfig: context.trainingConfig,
      rewardDefinition: context.rewardDefinition,
    });
    const second = produceCrossFittedPredictionSetV1({
      snapshot: snapshot.snapshot,
      targetEvidence: context.targetEvidence,
      trainingConfig: context.trainingConfig,
      rewardDefinition: context.rewardDefinition,
    });
    expect(first.status).toBe('produced');
    expect(second).toEqual(first);
    if (first.status !== 'produced') return;
    expect(first.predictionStream.trim().split('\n').length).toBeGreaterThan(3);
    expect(first.bundle.crossFitted).toBe(true);
    expect(first.bundle.servable).toBe(false);

    const verified = verifyCrossFittedPredictionSetV1({
      snapshotInput: context.snapshotInput,
      targetEvidence: context.targetEvidence,
      trainingConfig: context.trainingConfig,
      rewardDefinition: context.rewardDefinition,
      modelBundleRaw: first.modelBundleRaw,
      predictionStream: first.predictionStream,
      predictionSetManifestRaw: first.predictionSetManifestRaw,
    });
    expect(verified.status).toBe('verified');
    if (verified.status !== 'verified') return;
    expect(isVerifiedCrossFittedPredictionSetResultV1(verified)).toBe(true);
    expect(isVerifiedCrossFittedPredictionSetResultV1(Object.freeze({
      status: 'verified', receipt: verified.receipt, members: verified.members,
    }))).toBe(false);
    expect(verified.receipt.status).toBe('verified');
    expect(verified.members).toHaveLength(1);
    expect(Object.isFrozen(verified.receipt)).toBe(true);
    expect(Object.isFrozen(verified.members[0].predictions)).toBe(true);
    const projected = projectVerifiedPredictionMemberToV1(verified.members[0]);
    expect(projected.artifactVersion).toBe(first.manifest.predictionSetVersion);
    expect(projected.predictions).toHaveLength(5);
  });

  it('rejects coefficient tampering through training replay', () => {
    const context = syntheticContext();
    const snapshot = verifyOfflinePredictionSnapshotSetV1(context.snapshotInput);
    if (snapshot.status !== 'verified') throw new Error(snapshot.blocker);
    const produced = produceCrossFittedPredictionSetV1({
      snapshot: snapshot.snapshot,
      targetEvidence: context.targetEvidence,
      trainingConfig: context.trainingConfig,
      rewardDefinition: context.rewardDefinition,
    });
    if (produced.status !== 'produced') throw new Error(produced.blocker);
    const bundle = JSON.parse(produced.modelBundleRaw);
    bundle.folds[0].heads[0].intercept += 0.125;
    rehashBundle(bundle);
    const records = produced.predictionStream.trimEnd().split('\n').map(JSON.parse);
    for (const record of records) {
      if (record.recordType === 'artifact_start') record.modelBundleSha256 = bundle.modelBundleSha256;
    }
    rehashPerDecisionRecords(records);
    const predictionStream = canonicalNdjsonV1(records);
    const manifest = JSON.parse(produced.predictionSetManifestRaw);
    manifest.modelBundleSha256 = bundle.modelBundleSha256;
    manifest.artifactStreamSha256 = sha256Text(predictionStream);
    manifest.perDecisionArtifacts = records
      .filter((record) => record.recordType === 'artifact_end')
      .map((record) => ({
        decisionId: record.decisionId,
        perDecisionArtifactSha256: record.perDecisionArtifactSha256,
      }));
    const { predictionSetVersion: _oldVersion, ...manifestPreimage } = manifest;
    manifest.predictionSetVersion = sha256Text(canonicalJsonV1(manifestPreimage));

    expect(verifyCrossFittedPredictionSetV1({
      snapshotInput: context.snapshotInput,
      targetEvidence: context.targetEvidence,
      trainingConfig: context.trainingConfig,
      rewardDefinition: context.rewardDefinition,
      modelBundleRaw: `${canonicalWireJsonV1(bundle)}\n`,
      predictionStream,
      predictionSetManifestRaw: `${canonicalWireJsonV1(manifest)}\n`,
    })).toEqual({ status: 'not_evaluable', blocker: 'prediction_training_replay_mismatch' });
  });

  it('rejects non-canonical model/manifest wire bytes even when parsed values match', () => {
    const context = syntheticContext();
    const snapshot = verifyOfflinePredictionSnapshotSetV1(context.snapshotInput);
    if (snapshot.status !== 'verified') throw new Error(snapshot.blocker);
    const produced = produceCrossFittedPredictionSetV1({
      snapshot: snapshot.snapshot,
      targetEvidence: context.targetEvidence,
      trainingConfig: context.trainingConfig,
      rewardDefinition: context.rewardDefinition,
    });
    if (produced.status !== 'produced') throw new Error(produced.blocker);
    expect(verifyCrossFittedPredictionSetV1({
      snapshotInput: context.snapshotInput,
      targetEvidence: context.targetEvidence,
      trainingConfig: context.trainingConfig,
      rewardDefinition: context.rewardDefinition,
      modelBundleRaw: `${JSON.stringify(JSON.parse(produced.modelBundleRaw), null, 2)}\n`,
      predictionStream: produced.predictionStream,
      predictionSetManifestRaw: produced.predictionSetManifestRaw,
    })).toEqual({ status: 'not_evaluable', blocker: 'prediction_canonical_wire_mismatch' });
  });

  it('binds trusted roots and returns no partial output for missing full support', () => {
    const context = syntheticContext();
    const changedTraining = context.trainingRows.map((row, index) => index === 0
      ? { ...row, labels: { ...row.labels, click: !row.labels.click } }
      : row);
    const changedSource = canonicalNdjsonV1(changedTraining);
    const changedManifest = buildOfflinePredictionSnapshotManifestV1({
      ...context.snapshotFiles,
      sourceValidNdjson: changedSource,
    });
    expect(verifyOfflinePredictionSnapshotSetV1({
      ...context.snapshotInput,
      sourceValidNdjson: changedSource,
      manifest: changedManifest,
    })).toEqual({ status: 'not_evaluable', blocker: 'snapshot_trusted_root_mismatch' });

    const missingRequests = canonicalNdjsonV1(context.predictionRows.slice(0, -1));
    const missingFiles = { ...context.snapshotFiles, predictionRequestNdjson: missingRequests };
    const missingManifest = buildOfflinePredictionSnapshotManifestV1(missingFiles);
    expect(verifyOfflinePredictionSnapshotSetV1({
      sourceKind: 'synthetic',
      ...missingFiles,
      manifest: missingManifest,
      trustedRoots: snapshotTrustedRootsV1(missingFiles),
      targetEvidence: context.targetEvidence,
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'full_support_feature_snapshot_unavailable',
    });
  });

  it('keeps real history blocked without returning a brand or partial artifact', () => {
    const context = syntheticContext();
    expect(verifyOfflinePredictionSnapshotSetV1({
      ...context.snapshotInput,
      sourceKind: 'historical',
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'full_support_feature_snapshot_unavailable',
    });
  });
});

function syntheticContext() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const target = verifyTargetDistributionEvidenceV1({
    sourceDecisionNdjson: fixture.sourceDecisionNdjson,
    sourceDatasetManifestRaw: fixture.sourceDatasetManifestRaw,
    policyConfigRaw: fixture.policyConfigRaw,
    distributionNdjson: fixture.expectedDistributionNdjson,
    targetManifestRaw: fixture.expectedTargetManifestRaw,
    verificationReceiptRaw: `${JSON.stringify(fixture.expectedReceipt)}\n`,
  });
  if (target.status !== 'verified') throw new Error(target.blocker);
  const targetEvidence = target.evidence;
  const decisionId = targetEvidence.decisions[0].decisionId;
  const targetFold = assignDecisionFoldV1(decisionId, 2);
  const auxiliaryDecisionId = [
    'f1a4939e-1b73-4a42-8ef8-31d98f22cb01',
    'f1a4939e-1b73-4a42-8ef8-31d98f22cb02',
    'f1a4939e-1b73-4a42-8ef8-31d98f22cb03',
    'f1a4939e-1b73-4a42-8ef8-31d98f22cb04',
  ].find((id) => assignDecisionFoldV1(id, 2) !== targetFold)!;
  const firstAction = targetEvidence.decisions[0].steps[0].actions[0].actionKey;
  const base = {
    decisionAt: '2026-07-16T08:00:00.000Z',
    featureAt: '2026-07-16T08:00:00.000Z',
    referenceAt: '2026-07-16T08:00:00.000Z',
    featureInput: {
      createdAt: '2026-07-15T08:00:00.000Z',
      recallSource: 'synthetic',
      inNetwork: false,
      retrievalEmbeddingScore: 0.4,
    },
  };
  const labels = {
    click: true,
    like: false,
    reply: false,
    repost: false,
    quote: false,
    share: false,
    dismiss: false,
    blockAuthor: false,
    report: false,
    dwellTimeMs: 100,
  };
  const trainingRows = [
    {
      contractVersion: 'offline_prediction_training_example_v1',
      decisionId,
      actionKey: firstAction,
      ...base,
      outcomeContractVersion: 'outcome_contract_v1',
      outcomeStatus: 'observed',
      outcomeHorizonMs: 3_600_000,
      observedThrough: '2026-07-16T09:00:00.000Z',
      labels,
    },
    {
      contractVersion: 'offline_prediction_training_example_v1',
      decisionId: auxiliaryDecisionId,
      actionKey: { ...firstAction, candidateId: '507f191e810c19729de8cff0' },
      ...base,
      outcomeContractVersion: 'outcome_contract_v1',
      outcomeStatus: 'observed',
      outcomeHorizonMs: 3_600_000,
      observedThrough: '2026-07-16T09:00:00.000Z',
      labels: { ...labels, click: false, dismiss: true, dwellTimeMs: 0 },
    },
  ];
  const predictionRows = targetEvidence.decisions[0].steps.flatMap((step) => (
    step.actions.map(({ actionKey }, index) => ({
      contractVersion: 'offline_prediction_request_v1',
      decisionId,
      actionKey,
      ...base,
      featureInput: { ...base.featureInput, retrievalEmbeddingScore: 0.1 * (index + 1) },
    }))
  ));
  const snapshotFiles = {
    datasetVersion: 'synthetic-phase9-v1',
    immutableSourceVersion: 'synthetic-source-v1',
    sourceValidNdjson: canonicalNdjsonV1(trainingRows),
    predictionRequestNdjson: canonicalNdjsonV1(predictionRows),
    datasetManifestRaw: '{"contractVersion":"synthetic_training_dataset_manifest_v1"}\n',
    targetEvidence,
  };
  const manifest = buildOfflinePredictionSnapshotManifestV1(snapshotFiles);
  const snapshotInput = {
    sourceKind: 'synthetic' as const,
    ...snapshotFiles,
    manifest,
    trustedRoots: snapshotTrustedRootsV1(snapshotFiles),
  };
  return {
    targetEvidence,
    trainingRows,
    predictionRows,
    snapshotFiles,
    snapshotInput,
    trainingConfig: createCrossFittedTrainingConfigV1({
      foldCount: 2,
      epochs: 2,
      learningRate: 0.1,
      l2Lambda: 0.01,
    }),
    rewardDefinition: {
      contractVersion: 'offline_reward_definition_v1' as const,
      objective: 'synthetic_utility',
      definitionVersion: 'synthetic_reward_v1',
      horizonMs: 3_600_000,
      weights: {
        click: 1, like: 1, reply: 1, repost: 1, quote: 1,
        share: 1, dismiss: -1, blockAuthor: -1, report: -1,
      },
      dwell: { weight: 0.2, capMs: 1_000, scaleMs: 1_000 },
    },
  };
}

function rehashBundle(bundle: any): void {
  for (const fold of bundle.folds) {
    const { foldModelSha256: _oldFoldHash, ...foldPreimage } = fold;
    fold.foldModelSha256 = sha256Text(canonicalJsonV1(foldPreimage));
  }
  const { modelBundleSha256: _oldBundleHash, ...bundlePreimage } = bundle;
  bundle.modelBundleSha256 = sha256Text(canonicalJsonV1(bundlePreimage));
}

function rehashPerDecisionRecords(records: any[]): void {
  let start = 0;
  for (let index = 0; index < records.length; index += 1) {
    if (records[index].recordType !== 'artifact_end') continue;
    records[index].perDecisionArtifactSha256 = sha256Text(canonicalNdjsonV1(
      records.slice(start, index),
    ));
    start = index + 1;
  }
}
