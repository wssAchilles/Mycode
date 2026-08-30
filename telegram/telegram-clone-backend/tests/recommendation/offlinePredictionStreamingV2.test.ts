import { createHash } from 'crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionType } from '../../src/models/UserAction';
import { verifySyntheticContextV1 } from '../../src/services/recommendation/decisionContext/syntheticContextV1';
import {
  candidatePoolSha256,
  canonicalDecisionJson,
  decisionLogSha256,
  recommendationDecisionLogSchema,
} from '../../src/services/recommendation/decisionLog/contracts';
import {
  canonicalJsonV1,
  canonicalNdjsonV1,
  canonicalWireJsonV1,
  selfSha256V1,
  sha256Text,
} from '../../src/services/recommendation/offlinePrediction/artifacts/canonical';
import { encodeOfflineActionFeaturesV1 } from '../../src/services/recommendation/offlinePrediction/features/encode';
import {
  closeVerifiedPredictionCursorV2,
  isVerifiedCrossFittedPredictionSetV2,
  isVerifiedPredictionStepV2,
  openVerifiedPredictionCursorV2,
  produceCrossFittedPredictionSetV2,
  readVerifiedPredictionStepV2,
  verifyCrossFittedPredictionSetV2,
} from '../../src/services/recommendation/offlinePrediction/predictionV2';
import {
  DEFAULT_PREDICTION_SPOOL_LIMITS_V2,
  readCanonicalSpoolRecordsV2,
} from '../../src/services/recommendation/offlinePrediction/predictionV2/spool';
import {
  createCrossFittedTrainingConfigV1,
  phase11ModelStateResourceConfigV1,
} from '../../src/services/recommendation/offlinePrediction/contracts/artifacts';
import { OFFLINE_REWARD_HEADS_V1 } from '../../src/services/recommendation/offlinePrediction/contracts/reward';
import {
  isVerifiedFullSupportPitActionSnapshotV2,
  publishAtomicCanonicalNdjsonV1,
  replayVerifiedSnapshotPositionFeaturesV2,
  verifyCanonicalNdjsonFileV1,
  verifyFullSupportPitActionSnapshotV2,
} from '../../src/services/recommendation/offlinePrediction/snapshotV2';
import { setAtomicSinkTestHooksV1 } from '../../src/services/recommendation/offlinePrediction/snapshotV2/atomicSink';
import * as targetEvidenceV2 from '../../src/services/recommendation/offlinePrediction/targetEvidence';
import {
  isVerifiedTargetDistributionEvidenceV2,
  replayVerifiedTargetDistributionV2,
  syntheticTargetTrustRootAuditV1,
  verifyTargetDistributionStreamV2,
  type TargetDistributionStreamVerificationInputV2,
} from '../../src/services/recommendation/offlinePrediction/targetEvidence';
import { verifySyntheticTrajectoryEvidenceV1 } from '../../src/services/recommendation/offlinePrediction/streamingV2';
import {
  createOpeAggregateStateV3,
  finalizeOpeAggregateReceiptV3,
  replayOpeTrajectoryV3,
} from '../../src/services/recommendation/ope/v3';
import { summarizeClusterScoresV1 } from '../../src/services/recommendation/ope/inference/clusterScores';
import {
  buildPhase15SyntheticClusterStatisticMappingAuditV1,
} from '../../src/services/recommendation/ope/inference/qualification/v5/clusterMapping';
import { buildFrozenInferenceQualificationProtocolV1 } from '../../src/services/recommendation/ope/inference/qualification/v2';
import { generateSyntheticClusterScoreReplicationV1 } from '../../src/services/recommendation/ope/inference/qualification/v2/dgp';
import {
  syntheticOutcomeEventSha256V1,
  verifySyntheticOutcomeEvidenceV1,
} from '../../src/services/recommendation/outcomes/syntheticOutcomeEvidenceV1';

const fixtureDirectory = path.resolve(
  __dirname,
  '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures',
);

const temporaryDirectories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  setAtomicSinkTestHooksV1();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

const stream = (raw: string, chunkBytes = raw.length) => async function* () {
  const bytes = Buffer.from(raw);
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    yield bytes.subarray(offset, offset + chunkBytes);
  }
};

async function rustFixture() {
  const fixture = JSON.parse(await readFile(
    path.join(fixtureDirectory, 'target_policy_distribution_stream_v1.json'),
    'utf8',
  ));
  const receiptFixtureRaw = await readFile(
    path.join(fixtureDirectory, 'target_distribution_stream_receipt_v2.json'),
    'utf8',
  );
  const receiptFixture = JSON.parse(receiptFixtureRaw);
  return { fixture, receipt: receiptFixture.expectedReceipt, receiptFixtureRaw };
}

function targetInput(
  fixture: any,
  receipt: any,
  values: Partial<TargetDistributionStreamVerificationInputV2> = {},
): TargetDistributionStreamVerificationInputV2 {
  return {
    trustScope: 'synthetic_fixture',
    sourceDecisionStream: stream(fixture.sourceDecisionNdjson, 7),
    distributionStream: stream(fixture.expectedDistributionNdjson, 11),
    sourceDatasetManifestRaw: fixture.sourceDatasetManifestRaw,
    policyConfigRaw: fixture.policyConfigRaw,
    targetManifestRaw: fixture.expectedTargetManifestRaw,
    verificationReceiptRaw: `${canonicalWireJsonV1(receipt)}\n`,
    ...values,
  };
}

function maxScaleTargetInput(fixture: any, receiptTemplate: any) {
  const candidateCount = 2048;
  const slateSize = 64;
  const sourceTemplate = JSON.parse(fixture.sourceDecisionNdjson);
  const candidates = Array.from({ length: candidateCount }, (_, index) => {
    const servedPosition = index < slateSize ? index + 1 : null;
    return {
      candidateNamespace: 'serving_post_id',
      candidateId: (index + 1).toString(16).padStart(24, '0'),
      poolRank: index + 1,
      eligible: true,
      score: 0,
      selected: servedPosition !== null,
      selectionRank: servedPosition,
      served: servedPosition !== null,
      servedPosition,
      objectiveEvidence: [],
    };
  });
  const actions = candidates.slice(0, slateSize).map((candidate) => ({
    actionKey: {
      candidateNamespace: candidate.candidateNamespace,
      candidateId: candidate.candidateId,
      servedPosition: candidate.servedPosition!,
    },
    selectionRank: candidate.selectionRank!,
    behaviorPropensity: sourceTemplate.actions[0].behaviorPropensity,
  }));
  const source = recommendationDecisionLogSchema.parse({
    ...sourceTemplate,
    candidatePool: {
      supportEvidence: { status: 'complete' },
      totalCount: candidateCount,
      truncated: false,
      candidates,
      candidatePoolSha256: candidatePoolSha256(candidates),
    },
    actions,
  });
  const sourceDecisionRaw = `${JSON.stringify(source)}\n`;
  const sourceDecisionNdjsonSha256 = sha256Text(sourceDecisionRaw);
  const policy = { ...JSON.parse(fixture.policyConfigRaw), slateSize };

  function* distributionRecords(): Generator<Record<string, unknown>> {
    const recordsHash = createHash('sha256');
    const decisionStart = {
      recordType: 'decision_start',
      contractVersion: 'target_policy_distribution_v1',
      decisionId: source.decisionId,
      decisionFingerprint: {
        decisionId: source.decisionId,
        sha256: decisionLogSha256(source),
      },
      candidatePoolFingerprint: { sha256: source.candidatePool.candidatePoolSha256 },
      policy,
      baselineOrderVersion: 'decision_pool_rank_then_identity_v1',
      probabilitySemantics: 'conditional_on_prior_slate_prefix_v1',
      evidenceKind: 'simulated_target_distribution',
      servable: false,
    };
    recordsHash.update(`${canonicalDecisionJson(decisionStart)}\n`);
    yield decisionStart;

    let actionProbabilityCount = 0;
    for (let position = 1; position <= slateSize; position += 1) {
      const expectedActionCount = candidateCount - position + 1;
      const plackettLuceProbability = 1 / expectedActionCount;
      let plackettLuceProbabilityMass = 0;
      let mixedProbabilityMass = 0;
      for (let index = 0; index < expectedActionCount; index += 1) {
        plackettLuceProbabilityMass += plackettLuceProbability;
        mixedProbabilityMass += (index === 0 ? 1 - policy.epsilon : 0)
          + policy.epsilon * plackettLuceProbability;
      }
      const step = {
        recordType: 'step_start',
        decisionId: source.decisionId,
        servedPosition: position,
        prefixActionKeys: actions.slice(0, position - 1).map((action) => action.actionKey),
        expectedActionCount,
        plackettLuceProbabilityMass,
        plackettLuceMassError: Math.abs(plackettLuceProbabilityMass - 1),
        mixedProbabilityMass,
        mixedMassError: Math.abs(mixedProbabilityMass - 1),
      };
      recordsHash.update(`${canonicalDecisionJson(step)}\n`);
      yield step;

      for (let index = position - 1; index < candidateCount; index += 1) {
        const candidate = candidates[index]!;
        const deterministicTop = index === position - 1;
        const action = {
          recordType: 'action_probability',
          decisionId: source.decisionId,
          actionKey: {
            candidateNamespace: candidate.candidateNamespace,
            candidateId: candidate.candidateId,
            servedPosition: position,
          },
          deterministicTop,
          plackettLuceProbability,
          conditionalSelectionProbability: (deterministicTop ? 1 - policy.epsilon : 0)
            + policy.epsilon * plackettLuceProbability,
        };
        recordsHash.update(`${canonicalDecisionJson(action)}\n`);
        actionProbabilityCount += 1;
        yield action;
      }
    }
    yield {
      recordType: 'decision_end',
      decisionId: source.decisionId,
      stepCount: slateSize,
      actionProbabilityCount,
      decisionRecordsSha256: recordsHash.digest('hex'),
    };
  }

  const distributionHash = createHash('sha256');
  let actionProbabilityCount = 0;
  let physicalRecordCount = 0;
  let maxDistributionLineBytes = 0;
  for (const record of distributionRecords()) {
    const line = `${canonicalWireJsonV1(record)}\n`;
    distributionHash.update(line);
    physicalRecordCount += 1;
    if (record.recordType === 'action_probability') actionProbabilityCount += 1;
    maxDistributionLineBytes = Math.max(maxDistributionLineBytes, Buffer.byteLength(line));
  }
  const distributionNdjsonSha256 = distributionHash.digest('hex');
  const sourceManifest = {
    ...JSON.parse(fixture.sourceDatasetManifestRaw),
    sourceDecisionNdjsonSha256,
    decisionCount: 1,
  };
  const sourceDatasetManifestRaw = `${canonicalWireJsonV1(sourceManifest)}\n`;
  const sourceDatasetManifestSha256 = sha256Text(sourceDatasetManifestRaw);
  const policyConfigRaw = canonicalWireJsonV1(policy);
  const targetManifest = {
    ...JSON.parse(fixture.expectedTargetManifestRaw),
    sourceDecisionNdjsonSha256,
    sourceDatasetManifestSha256,
    policyConfigSha256: sha256Text(canonicalDecisionJson(policy)),
    decisionCount: 1,
    stepCount: slateSize,
    actionProbabilityCount,
    physicalRecordCount,
    distributionNdjsonSha256,
  };
  const targetManifestRaw = `${canonicalWireJsonV1(targetManifest)}\n`;
  const receipt = {
    ...receiptTemplate,
    sourceDecisionNdjsonSha256,
    sourceDatasetManifestSha256,
    policyConfigSha256: targetManifest.policyConfigSha256,
    policyConfigRawSha256: sha256Text(policyConfigRaw),
    distributionNdjsonSha256,
    targetManifestSha256: sha256Text(targetManifestRaw),
    verifiedDecisionCount: 1,
    verifiedStepCount: slateSize,
    verifiedActionProbabilityCount: actionProbabilityCount,
    verifiedPhysicalRecordCount: physicalRecordCount,
    highWaterDiagnostics: {
      maxSourceLineBytes: Buffer.byteLength(sourceDecisionRaw),
      maxDistributionLineBytes,
      maxCandidateCount: candidateCount,
      maxStepActionCount: candidateCount,
      maxPrefixActionCount: slateSize - 1,
    },
  };
  receipt.verificationReceiptSha256 = selfSha256V1(receipt, 'verificationReceiptSha256');

  let streamOpenCount = 0;
  let streamedActionCount = 0;
  let streamedPhysicalRecordCount = 0;
  return {
    input: {
      trustScope: 'synthetic_fixture' as const,
      sourceDecisionStream: stream(sourceDecisionRaw, 4096),
      distributionStream: () => (async function* () {
        streamOpenCount += 1;
        for (const record of distributionRecords()) {
          streamedPhysicalRecordCount += 1;
          if (record.recordType === 'action_probability') streamedActionCount += 1;
          yield `${canonicalWireJsonV1(record)}\n`;
        }
      })(),
      sourceDatasetManifestRaw,
      policyConfigRaw,
      targetManifestRaw,
      verificationReceiptRaw: `${canonicalWireJsonV1(receipt)}\n`,
    },
    stats: () => ({ streamOpenCount, streamedActionCount, streamedPhysicalRecordCount }),
  };
}

describe('Phase 10B streaming target evidence', () => {
  it('verifies the Rust v2 receipt fixture without materializing either NDJSON file', async () => {
    const { fixture, receipt, receiptFixtureRaw } = await rustFixture();
    const result = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt));
    expect(result.status).toBe('verified');
    if (result.status !== 'verified') return;
    expect(isVerifiedTargetDistributionEvidenceV2(result.evidence)).toBe(true);
    expect(result.evidence.realDatasetEligible).toBe(false);
    expect(result.evidence.receipt.highWaterDiagnostics).toEqual({
      maxSourceLineBytes: 2469,
      maxDistributionLineBytes: 755,
      maxCandidateCount: 4,
      maxStepActionCount: 3,
      maxPrefixActionCount: 1,
    });
    expect(syntheticTargetTrustRootAuditV1()).toEqual({
      contractVersion: 'rust_target_verifier_trust_root_v1',
      scope: 'synthetic_fixture',
      receiptSchema: 'target_distribution_stream_verification_receipt_v2',
      verifierBuildFingerprintSha256:
        '9db367a35811e2dfca10f95f393d166e51ee12d53210ac04a42ae9cf36664a13',
      expectedReceiptSha256:
        '5b2cfe8ff0123c08b253536d4b8fcaa0e80d22729afaef0ae64ddddfc883b933',
      expectedReceiptRawSha256:
        '0d290beacd8b276f9a3fdd7526fcf570ff3ec04deef8b0b81ca95abeb7a48a49',
      sourceBundleSha256: sha256Text(receiptFixtureRaw),
      validFrom: '2026-07-19T00:00:00.000Z',
      validThrough: '2027-07-19T00:00:00.000Z',
      rootDigest: 'bd034a7ced8333ad2cb027cd5c7d53f206b0068c3b72e40c634c8651e491f3a3',
    });
  });

  it('keeps production evidence unbranded when no private production trust root exists', async () => {
    const { fixture, receipt } = await rustFixture();
    const result = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      trustScope: 'production',
    }));
    expect(result.status).toBe('contract_validated');
    expect(result).toMatchObject({
      blocker: 'rust_verification_trust_root_unavailable',
      validation: { realDatasetEligible: false, servable: false },
    });
  });

  it('rechecks the inclusive trust-root expiry on every brand and replay use', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-07-19T00:00:00.000Z'));
    const { fixture, receipt } = await rustFixture();
    const target = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt));
    expect(target.status).toBe('verified');
    if (target.status !== 'verified') return;
    expect(isVerifiedTargetDistributionEvidenceV2(target.evidence)).toBe(true);

    vi.setSystemTime(new Date('2027-07-19T00:00:00.001Z'));
    expect(isVerifiedTargetDistributionEvidenceV2(target.evidence)).toBe(false);
    const abort = vi.fn();
    expect(await replayVerifiedTargetDistributionV2(target.evidence, {
      commit: vi.fn(),
      abort,
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'rust_verification_trust_root_unavailable',
    });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith('rust_verification_trust_root_unavailable');
  });

  it('aborts once if the trust root expires while replay callbacks are staged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-07-19T00:00:00.000Z'));
    const { fixture, receipt } = await rustFixture();
    const target = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt));
    if (target.status !== 'verified') throw new Error(target.status);
    const abort = vi.fn();
    const commit = vi.fn();
    const result = await replayVerifiedTargetDistributionV2(target.evidence, {
      onStep: () => vi.setSystemTime(new Date('2027-07-19T00:00:00.001Z')),
      commit,
      abort,
    });
    expect(result).toEqual({
      status: 'not_evaluable',
      blocker: 'rust_verification_trust_root_unavailable',
    });
    expect(commit).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith('rust_verification_trust_root_unavailable');
  });

  it('streams the 2048 x 64 boundary but withholds a trusted brand without Rust certification', async () => {
    const { fixture, receipt } = await rustFixture();
    const generated = maxScaleTargetInput(fixture, receipt);
    const result = await verifyTargetDistributionStreamV2(generated.input);
    expect(result.status).toBe('contract_validated');
    if (result.status !== 'contract_validated') return;
    expect(result.validation).toMatchObject({
      decisionCount: 1,
      stepCount: 64,
      actionProbabilityCount: 129056,
      physicalRecordCount: 129122,
    });
    expect(generated.stats()).toEqual({
      streamOpenCount: 1,
      streamedActionCount: 129056,
      streamedPhysicalRecordCount: 129122,
    });
    expect('evidence' in result).toBe(false);
  }, 60_000);

  it.each([
    ['target_mixture_mismatch', (records: any[]) => {
      records.find((record) => record.recordType === 'action_probability')
        .conditionalSelectionProbability += 0.01;
    }],
    ['target_support_mismatch', (records: any[]) => {
      records.find((record) => record.recordType === 'action_probability')
        .actionKey.candidateId = '507f191e810c19729de8c099';
    }],
    ['target_step_binding_mismatch', (records: any[]) => {
      records.find((record) => record.recordType === 'step_start' && record.servedPosition === 2)
        .prefixActionKeys = [];
    }],
    ['target_deterministic_top_mismatch', (records: any[]) => {
      records.find((record) => record.recordType === 'action_probability').deterministicTop = false;
    }],
    ['target_probability_mass_mismatch', (records: any[]) => {
      const action = records.find((record) => record.recordType === 'action_probability');
      action.plackettLuceProbability += 0.01;
      action.conditionalSelectionProbability += 0.002;
    }],
  ])('fails closed on %s', async (blocker, mutate) => {
    const { fixture, receipt } = await rustFixture();
    const records = fixture.expectedDistributionNdjson.trimEnd().split('\n').map(JSON.parse);
    mutate(records);
    const result = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      distributionStream: stream(canonicalNdjsonV1(records), 5),
    }));
    expect(result).toEqual({ status: 'not_evaluable', blocker });
  });

  it('rejects a stale receipt self-hash and does not trust a caller-rehashed build', async () => {
    const { fixture, receipt } = await rustFixture();
    expect(await verifyTargetDistributionStreamV2(targetInput(fixture, {
      ...receipt,
      verifiedStepCount: receipt.verifiedStepCount + 1,
    }))).toEqual({ status: 'not_evaluable', blocker: 'target_receipt_digest_mismatch' });

    const changed = { ...receipt, verifierBuildFingerprintSha256: '1'.repeat(64) };
    changed.verificationReceiptSha256 = selfSha256V1(changed, 'verificationReceiptSha256');
    const result = await verifyTargetDistributionStreamV2(targetInput(fixture, changed));
    expect(result.status).toBe('contract_validated');
    expect(result).toMatchObject({ blocker: 'rust_verification_trust_root_unavailable' });
  });

  it('closes both input iterators when verification fails mid-stream', async () => {
    const { fixture, receipt } = await rustFixture();
    const records = fixture.expectedDistributionNdjson.trimEnd().split('\n').map(JSON.parse);
    records.find((record: any) => record.recordType === 'action_probability')
      .conditionalSelectionProbability += 0.01;
    let sourceClosed = false;
    let distributionClosed = false;
    const sourceDecisionStream = async function* () {
      try { yield fixture.sourceDecisionNdjson; } finally { sourceClosed = true; }
    };
    const distributionStream = async function* () {
      try { yield canonicalNdjsonV1(records); } finally { distributionClosed = true; }
    };
    expect(await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      sourceDecisionStream,
      distributionStream,
    }))).toEqual({ status: 'not_evaluable', blocker: 'target_mixture_mismatch' });
    expect({ sourceClosed, distributionClosed }).toEqual({
      sourceClosed: true,
      distributionClosed: true,
    });
  });

  it('rejects non-canonical source wire and duplicates with constant memory ordering', async () => {
    const { fixture, receipt } = await rustFixture();
    const source = JSON.parse(fixture.sourceDecisionNdjson);
    const reordered = `${JSON.stringify(Object.fromEntries(
      Object.entries(source).reverse(),
    ))}\n`;
    expect(await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      sourceDecisionStream: stream(reordered),
    }))).toEqual({ status: 'not_evaluable', blocker: 'target_canonical_wire_mismatch' });
    expect(await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      sourceDecisionStream: stream(fixture.sourceDecisionNdjson.replace(',', ', ')),
    }))).toEqual({ status: 'not_evaluable', blocker: 'target_canonical_wire_mismatch' });
    const lexicalDrift = fixture.sourceDecisionNdjson.replace('"score":0.0', '"score":0.00');
    expect(await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      sourceDecisionStream: stream(lexicalDrift),
    }))).toEqual({ status: 'not_evaluable', blocker: 'target_canonical_wire_mismatch' });
    for (const exponentDrift of ['0e0', '0.0e+0']) {
      const sourceWithExponent = fixture.sourceDecisionNdjson.replace(
        '"score":0.0',
        `"score":${exponentDrift}`,
      );
      expect(await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
        sourceDecisionStream: stream(sourceWithExponent),
      }))).toEqual({ status: 'not_evaluable', blocker: 'target_canonical_wire_mismatch' });
    }
    expect(await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      sourceDecisionStream: stream(
        `${fixture.sourceDecisionNdjson}${fixture.sourceDecisionNdjson}`,
      ),
    }))).toEqual({ status: 'not_evaluable', blocker: 'target_source_decision_duplicate' });
  });

  it('aborts provisional target callbacks on a late stream error and never commits', async () => {
    const { fixture, receipt } = await rustFixture();
    let opens = 0;
    const verified = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      distributionStream: () => stream(
        opens++ === 0
          ? fixture.expectedDistributionNdjson
          : `${fixture.expectedDistributionNdjson}${fixture.expectedDistributionNdjson.split('\n')[0]}\n`,
        17,
      )(),
    }));
    if (verified.status !== 'verified') throw new Error(verified.status);
    const staged: number[] = [];
    let committed = false;
    let aborted: string | undefined;
    const replay = await replayVerifiedTargetDistributionV2(verified.evidence, {
      onStep: (_decision, step) => { staged.push(step.servedPosition); },
      commit: () => { committed = true; },
      abort: (blocker) => { aborted = blocker; staged.length = 0; },
    });
    expect(replay).toEqual({
      status: 'not_evaluable',
      blocker: 'target_source_membership_mismatch',
    });
    expect({ staged, committed, aborted }).toEqual({
      staged: [],
      committed: false,
      aborted: 'target_source_membership_mismatch',
    });
  });

  it('maps target callback and commit failures without rejecting or double-aborting', async () => {
    const { fixture, receipt } = await rustFixture();
    const target = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt));
    if (target.status !== 'verified') throw new Error(target.status);

    const callbackAbort = vi.fn();
    const callbackCommit = vi.fn();
    await expect(replayVerifiedTargetDistributionV2(target.evidence, {
      onStep: () => { throw new Error('callback failed'); },
      commit: callbackCommit,
      abort: callbackAbort,
    })).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'target_transaction_callback_failed',
    });
    expect(callbackCommit).not.toHaveBeenCalled();
    expect(callbackAbort).toHaveBeenCalledTimes(1);
    expect(callbackAbort).toHaveBeenCalledWith('target_transaction_callback_failed');

    const commitAbort = vi.fn();
    const commit = vi.fn(() => { throw new Error('commit failed'); });
    await expect(replayVerifiedTargetDistributionV2(target.evidence, {
      commit,
      abort: commitAbort,
    })).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'target_transaction_commit_failed',
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commitAbort).toHaveBeenCalledTimes(1);
    expect(commitAbort).toHaveBeenCalledWith('target_transaction_commit_failed');
  });

  it('returns a stable target blocker when abort itself fails', async () => {
    const { fixture, receipt } = await rustFixture();
    const target = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt));
    if (target.status !== 'verified') throw new Error(target.status);
    const abort = vi.fn(() => { throw new Error('abort failed'); });
    await expect(replayVerifiedTargetDistributionV2(target.evidence, {
      onStep: () => { throw new Error('callback failed'); },
      commit: vi.fn(),
      abort,
    })).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'target_transaction_abort_failed',
    });
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('fails closed for hostile target brand and replay probes', async () => {
    const { fixture, receipt } = await rustFixture();
    const target = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt));
    if (target.status !== 'verified') throw new Error(target.status);
    const hostile = new Proxy(target.evidence, {
      ownKeys: () => { throw new Error('hostile_target_own_keys'); },
    });

    expect(isVerifiedTargetDistributionEvidenceV2(hostile)).toBe(false);
    await expect(replayVerifiedTargetDistributionV2(hostile, {
      commit: vi.fn(),
      abort: vi.fn(),
    })).resolves.toEqual({
      status: 'not_evaluable', blocker: 'target_verified_brand_missing',
    });
  });
});

describe('Phase 10B future-only full-support snapshot', () => {
  it('fails closed for hostile snapshot brand and replay probes', async () => {
    const context = await snapshotContext();
    const verified = await verifyFullSupportPitActionSnapshotV2(context.input);
    if (verified.status !== 'verified') throw new Error(verified.blocker);
    const hostile = new Proxy(verified.snapshot, {
      ownKeys: () => { throw new Error('hostile_snapshot_own_keys'); },
    });

    expect(isVerifiedFullSupportPitActionSnapshotV2(hostile)).toBe(false);
    await expect(replayVerifiedSnapshotPositionFeaturesV2(
      hostile,
      context.targetEvidence,
      { onPositionFeature: vi.fn(), commit: vi.fn(), abort: vi.fn() },
    )).resolves.toEqual({
      status: 'not_evaluable', blocker: 'snapshot_verified_brand_missing',
    });
  });

  it('verifies base features once and expands positions with the Phase 9 encoder', async () => {
    const context = await snapshotContext();
    const verified = await verifyFullSupportPitActionSnapshotV2(context.input);
    expect(verified.status).toBe('verified');
    if (verified.status !== 'verified') return;
    const expanded: any[] = [];
    const staged: any[] = [];
    expect(await replayVerifiedSnapshotPositionFeaturesV2(
      verified.snapshot,
      context.targetEvidence,
      {
        onPositionFeature: (feature) => { staged.push(feature); },
        commit: () => { expanded.push(...staged); staged.length = 0; },
        abort: () => { staged.length = 0; },
      },
    )).toEqual({ status: 'verified' });
    expect(expanded).toHaveLength(5);
    const direct = encodeOfflineActionFeaturesV1({
      decisionId: context.decision.decisionId,
      actionKey: expanded[0].row.actionKey,
      decisionAt: new Date(context.decision.decisionAt).toISOString(),
      featureAt: context.baseRecords[0].featureAt,
      referenceAt: new Date(context.decision.decisionAt).toISOString(),
      featureInput: context.baseRecords[0].featureInput,
    });
    expect(direct.status).toBe('encoded');
    if (direct.status === 'encoded') {
      expect(canonicalWireJsonV1(expanded[0].row)).toBe(canonicalWireJsonV1(direct.row));
    }
    expect(Object.keys(expanded[0].row.features)
      .filter((key) => key.startsWith('served_position:'))).toEqual(['served_position:1']);
  });

  it('rechecks trust-root expiry before snapshot replay and aborts once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-07-19T00:00:00.000Z'));
    const context = await snapshotContext();
    const verified = await verifyFullSupportPitActionSnapshotV2(context.input);
    if (verified.status !== 'verified') throw new Error(verified.status);

    vi.setSystemTime(new Date('2027-07-19T00:00:00.001Z'));
    const commit = vi.fn();
    const abort = vi.fn();
    await expect(replayVerifiedSnapshotPositionFeaturesV2(
      verified.snapshot,
      context.targetEvidence,
      { onPositionFeature: vi.fn(), commit, abort },
    )).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'rust_verification_trust_root_unavailable',
    });
    expect(commit).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith('rust_verification_trust_root_unavailable');
  });

  it('does not brand a snapshot if EOF advances past trust-root expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-07-19T00:00:00.000Z'));
    const context = await snapshotContext();
    let eofChecks = 0;
    const result = await verifyFullSupportPitActionSnapshotV2({
      ...context.input,
      snapshotStream: () => ({
        [Symbol.asyncIterator]() {
          let yielded = false;
          return {
            next: async () => {
              if (!yielded) {
                yielded = true;
                return { done: false as const, value: context.snapshotRaw };
              }
              eofChecks += 1;
              vi.setSystemTime(new Date('2027-07-19T00:00:00.001Z'));
              return { done: true as const, value: undefined };
            },
          };
        },
      }),
    });
    expect(eofChecks).toBe(1);
    expect(result).toEqual({
      status: 'not_evaluable',
      blocker: 'rust_verification_trust_root_unavailable',
    });
    const unregisteredSnapshot = (result as { snapshot?: any }).snapshot;
    expect(isVerifiedFullSupportPitActionSnapshotV2(unregisteredSnapshot)).toBe(false);
    const abort = vi.fn();
    await expect(replayVerifiedSnapshotPositionFeaturesV2(
      unregisteredSnapshot,
      context.targetEvidence,
      { onPositionFeature: vi.fn(), commit: vi.fn(), abort },
    )).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'snapshot_verified_brand_missing',
    });
    expect(abort).not.toHaveBeenCalled();
  });

  it('is wall-clock invariant and fails closed on PIT, version, digest and prefix drift', async () => {
    const context = await snapshotContext();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const first = await verifyFullSupportPitActionSnapshotV2(context.input);
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const second = await verifyFullSupportPitActionSnapshotV2(context.input);
    expect(first.status).toBe('verified');
    expect(second.status).toBe('verified');

    expect((await verifyFullSupportPitActionSnapshotV2(await rebuildSnapshot(context, (records) => {
      records[1].availableAt = '2026-07-16T08:00:00.001Z';
    }))).status).toBe('not_evaluable');
    expect(await verifyFullSupportPitActionSnapshotV2(await rebuildSnapshot(context, (records) => {
      records[0].versions.pipeline = { status: 'bound', version: 'drift' };
    }))).toEqual({ status: 'not_evaluable', blocker: 'snapshot_decision_binding_mismatch' });
    expect(await verifyFullSupportPitActionSnapshotV2(await rebuildSnapshot(context, (records) => {
      records[0].featureDependency = 'prefix_dependent';
    }))).toEqual({ status: 'not_evaluable', blocker: 'prefix_feature_snapshot_unavailable' });
    const digestDrift = await rebuildSnapshot(context);
    digestDrift.manifestRaw += ' ';
    expect((await verifyFullSupportPitActionSnapshotV2(digestDrift)).status).toBe('not_evaluable');
  });

  it('keeps historical backfill unavailable and enforces the 2048 candidate cap', async () => {
    const context = await snapshotContext();
    expect(await verifyFullSupportPitActionSnapshotV2({
      ...context.input,
      sourceKind: 'historical_backfill',
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'full_support_feature_snapshot_unavailable',
    });
    const oversized = await rebuildSnapshot(context, (records) => {
      records[0].expectedCandidateCount = 2049;
    });
    expect(await verifyFullSupportPitActionSnapshotV2(oversized)).toEqual({
      status: 'not_evaluable',
      blocker: 'snapshot_contract_invalid',
    });
  });

  it('rejects target bytes that drift when the verified stream is reopened', async () => {
    const context = await snapshotContext();
    const { fixture, receipt } = await rustFixture();
    const records = fixture.expectedDistributionNdjson.trimEnd().split('\n').map(JSON.parse);
    records.find((record: any) => record.recordType === 'action_probability')
      .conditionalSelectionProbability += 0.01;
    let opens = 0;
    const target = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt, {
      distributionStream: () => stream(
        opens++ === 0 ? fixture.expectedDistributionNdjson : canonicalNdjsonV1(records),
        13,
      )(),
    }));
    if (target.status !== 'verified') throw new Error(target.status);
    expect(await verifyFullSupportPitActionSnapshotV2({
      ...context.input,
      targetEvidence: target.evidence,
    })).toEqual({ status: 'not_evaluable', blocker: 'target_mixture_mismatch' });
  });

  it('aborts staged position output on late snapshot drift and never commits', async () => {
    const context = await snapshotContext();
    let opens = 0;
    const verified = await verifyFullSupportPitActionSnapshotV2({
      ...context.input,
      snapshotStream: () => stream(
        opens++ === 0
          ? context.snapshotRaw
          : `${context.snapshotRaw}${context.snapshotRaw.split('\n')[0]}\n`,
        19,
      )(),
    });
    if (verified.status !== 'verified') throw new Error(verified.status);
    const staged: unknown[] = [];
    const published: unknown[] = [];
    let committed = false;
    let aborted: string | undefined;
    const replay = await replayVerifiedSnapshotPositionFeaturesV2(
      verified.snapshot,
      context.targetEvidence,
      {
        onPositionFeature: (feature) => { staged.push(feature); },
        commit: () => { committed = true; published.push(...staged); },
        abort: (blocker) => { aborted = blocker; staged.length = 0; },
      },
    );
    expect(replay).toEqual({
      status: 'not_evaluable',
      blocker: 'snapshot_target_membership_mismatch',
    });
    expect({ staged, published, committed, aborted }).toEqual({
      staged: [],
      published: [],
      committed: false,
      aborted: 'snapshot_target_membership_mismatch',
    });
  });

  it('maps snapshot callback, commit and abort failures without rejecting or double-aborting', async () => {
    const context = await snapshotContext();
    const verified = await verifyFullSupportPitActionSnapshotV2(context.input);
    if (verified.status !== 'verified') throw new Error(verified.status);

    const callbackCommit = vi.fn();
    const callbackAbort = vi.fn();
    await expect(replayVerifiedSnapshotPositionFeaturesV2(
      verified.snapshot,
      context.targetEvidence,
      {
        onPositionFeature: () => { throw new Error('callback failed'); },
        commit: callbackCommit,
        abort: callbackAbort,
      },
    )).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'snapshot_transaction_callback_failed',
    });
    expect(callbackCommit).not.toHaveBeenCalled();
    expect(callbackAbort).toHaveBeenCalledTimes(1);
    expect(callbackAbort).toHaveBeenCalledWith('snapshot_transaction_callback_failed');

    const commit = vi.fn(() => { throw new Error('commit failed'); });
    const commitAbort = vi.fn();
    await expect(replayVerifiedSnapshotPositionFeaturesV2(
      verified.snapshot,
      context.targetEvidence,
      { onPositionFeature: vi.fn(), commit, abort: commitAbort },
    )).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'snapshot_transaction_commit_failed',
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commitAbort).toHaveBeenCalledTimes(1);
    expect(commitAbort).toHaveBeenCalledWith('snapshot_transaction_commit_failed');

    const failingAbort = vi.fn(() => { throw new Error('abort failed'); });
    await expect(replayVerifiedSnapshotPositionFeaturesV2(
      verified.snapshot,
      context.targetEvidence,
      {
        onPositionFeature: () => { throw new Error('callback failed'); },
        commit: vi.fn(),
        abort: failingAbort,
      },
    )).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'snapshot_transaction_abort_failed',
    });
    expect(failingAbort).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 10B atomic artifact sink', () => {
  it('publishes verified canonical bytes and cleans failed temporary artifacts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'telegram-snapshot-v2-'));
    temporaryDirectories.push(directory);
    const targetPath = path.join(directory, 'snapshot.ndjson');
    const records = Array.from({ length: 2048 }, (_, index) => ({ index }));
    const raw = canonicalNdjsonV1(records);
    await expect(publishAtomicCanonicalNdjsonV1({
      targetPath,
      records,
      expectedSha256: sha256Text(raw),
      expectedRecordCount: records.length,
    })).resolves.toEqual({
      status: 'published',
      durability: 'confirmed',
      sha256: sha256Text(raw),
      recordCount: 2048,
    });
    expect(await readFile(targetPath, 'utf8')).toBe(raw);

    const failedPath = path.join(directory, 'failed.ndjson');
    await expect(publishAtomicCanonicalNdjsonV1({
      targetPath: failedPath,
      records: [{ value: 1 }],
      expectedSha256: '0'.repeat(64),
      expectedRecordCount: 1,
    })).rejects.toThrow('atomic_artifact_validation_mismatch');
    expect((await readdir(directory)).filter((entry) => entry.includes('failed'))).toEqual([]);

    const corruptPath = path.join(directory, 'corrupt.tmp');
    const corrupt = '{"value": 1}\n';
    await writeFile(corruptPath, corrupt);
    await expect(verifyCanonicalNdjsonFileV1(
      corruptPath,
      sha256Text(corrupt),
      1,
    )).rejects.toThrow('atomic_artifact_contract_invalid');
  });

  it('is create-only across pre-existing and racing targets without leaking temp files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'telegram-snapshot-v2-'));
    temporaryDirectories.push(directory);
    const original = Buffer.from('original target bytes\n');
    const targetPath = path.join(directory, 'existing.ndjson');
    await writeFile(targetPath, original);
    await expect(publishAtomicCanonicalNdjsonV1({
      targetPath,
      records: [{ value: 1 }],
      expectedSha256: sha256Text(`${canonicalWireJsonV1({ value: 1 })}\n`),
      expectedRecordCount: 1,
    })).rejects.toThrow('atomic_artifact_target_exists');
    expect(await readFile(targetPath)).toEqual(original);

    const racedPath = path.join(directory, 'raced.ndjson');
    const raced = Buffer.from('racing target bytes\n');
    setAtomicSinkTestHooksV1({
      beforeCreateOnlyPublish: (hookTargetPath) => writeFile(hookTargetPath, raced),
    });
    await expect(publishAtomicCanonicalNdjsonV1({
      targetPath: racedPath,
      records: [{ value: 2 }],
      expectedSha256: sha256Text(`${canonicalWireJsonV1({ value: 2 })}\n`),
      expectedRecordCount: 1,
    })).rejects.toThrow('atomic_artifact_target_exists');
    expect(await readFile(racedPath)).toEqual(raced);
    expect((await readdir(directory)).some((entry) => (
      entry.endsWith('.tmp') || entry.endsWith('.publish.lock')
    ))).toBe(false);
  });

  it('never deletes a later writer after the create-only publish boundary', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'telegram-snapshot-v2-'));
    temporaryDirectories.push(directory);
    const targetPath = path.join(directory, 'replaced.ndjson');
    const later = Buffer.from('later writer bytes\n');
    setAtomicSinkTestHooksV1({
      syncParentDirectory: async () => {
        await rm(targetPath);
        await writeFile(targetPath, later);
        throw new Error('parent fsync failed');
      },
    });
    await expect(publishAtomicCanonicalNdjsonV1({
      targetPath,
      records: [{ value: 3 }],
      expectedSha256: sha256Text(`${canonicalWireJsonV1({ value: 3 })}\n`),
      expectedRecordCount: 1,
    })).resolves.toEqual({
      status: 'published_durability_unconfirmed',
      durability: 'unconfirmed',
      reason: 'parent_directory_sync_failed',
      sha256: sha256Text(`${canonicalWireJsonV1({ value: 3 })}\n`),
      recordCount: 1,
    });
    expect(await readFile(targetPath)).toEqual(later);
    expect((await readdir(directory)).some((entry) => (
      entry.endsWith('.tmp') || entry.endsWith('.publish.lock')
    ))).toBe(false);
  });

  it('reports an irreversible publish when post-link durability cannot be confirmed', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'telegram-snapshot-v2-'));
    temporaryDirectories.push(directory);
    const targetPath = path.join(directory, 'unconfirmed.ndjson');
    const raw = `${canonicalWireJsonV1({ value: 4 })}\n`;
    setAtomicSinkTestHooksV1({
      syncParentDirectory: () => { throw new Error('parent fsync failed'); },
    });
    await expect(publishAtomicCanonicalNdjsonV1({
      targetPath,
      records: [{ value: 4 }],
      expectedSha256: sha256Text(raw),
      expectedRecordCount: 1,
    })).resolves.toEqual({
      status: 'published_durability_unconfirmed',
      durability: 'unconfirmed',
      reason: 'parent_directory_sync_failed',
      sha256: sha256Text(raw),
      recordCount: 1,
    });
    expect(await readFile(targetPath, 'utf8')).toBe(raw);
    expect((await readdir(directory)).some((entry) => (
      entry.endsWith('.tmp') || entry.endsWith('.publish.lock')
    ))).toBe(false);
  });

  it('reports post-link temporary cleanup failure without hiding publication', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'telegram-snapshot-v2-'));
    temporaryDirectories.push(directory);
    const targetPath = path.join(directory, 'cleanup-unconfirmed.ndjson');
    const raw = `${canonicalWireJsonV1({ value: 5 })}\n`;
    setAtomicSinkTestHooksV1({
      unlinkTemporary: () => { throw new Error('temporary cleanup failed'); },
    });
    await expect(publishAtomicCanonicalNdjsonV1({
      targetPath,
      records: [{ value: 5 }],
      expectedSha256: sha256Text(raw),
      expectedRecordCount: 1,
    })).resolves.toEqual({
      status: 'published_durability_unconfirmed',
      durability: 'unconfirmed',
      reason: 'temporary_cleanup_failed',
      sha256: sha256Text(raw),
      recordCount: 1,
    });
    expect(await readFile(targetPath, 'utf8')).toBe(raw);
    expect((await readdir(directory)).some((entry) => (
      entry.endsWith('.tmp') || entry.endsWith('.publish.lock')
    ))).toBe(false);
  });
});

async function snapshotContext() {
  const { fixture, receipt } = await rustFixture();
  const target = await verifyTargetDistributionStreamV2(targetInput(fixture, receipt));
  if (target.status !== 'verified') throw new Error(target.status);
  const decision = JSON.parse(fixture.sourceDecisionNdjson.trim());
  const decisionAt = new Date(decision.decisionAt).toISOString();
  const start: any = {
    recordType: 'decision_start',
    contractVersion: 'full_support_pit_action_snapshot_v2',
    decisionId: decision.decisionId,
    requestId: decision.requestId,
    decisionAt,
    decisionLogSha256: decisionLogDigest(decision),
    candidatePoolSha256: decision.candidatePool.candidatePoolSha256,
    featureSchemaVersion: 'social_phoenix_action_position_1_based_v1',
    featureDependency: 'candidate_position_only_v1',
    versions: decision.versions,
    expectedCandidateCount: 3,
    historicalBackfill: 'unavailable',
    futureShadowCapture: 'code_ready_activation_blocked',
    servable: false,
  };
  const eligible = decision.candidatePool.candidates.filter((candidate: any) => candidate.eligible);
  const baseRecords = eligible.map((candidate: any, index: number) => {
    const preimage = {
      recordType: 'candidate_base',
      decisionId: decision.decisionId,
      candidateNamespace: candidate.candidateNamespace,
      candidateId: candidate.candidateId,
      poolRank: candidate.poolRank,
      featureAt: '2026-07-16T07:59:00.000Z',
      availableAt: '2026-07-16T07:59:30.000Z',
      featureInput: {
        createdAt: '2026-07-15T08:00:00.000Z',
        recallSource: 'synthetic',
        inNetwork: false,
        retrievalEmbeddingScore: 0.1 * (index + 1),
      },
      sourceVersion: 'synthetic-candidate-base-v1',
    };
    return { ...preimage, sourceSha256: sha256Text(canonicalJsonV1(preimage)) };
  });
  const records: any[] = [start, ...baseRecords];
  records.push({
    recordType: 'decision_end',
    decisionId: decision.decisionId,
    candidateBaseCount: baseRecords.length,
    decisionRecordsSha256: sha256Text(`${records.map(canonicalJsonV1).join('\n')}\n`),
  });
  const snapshotRaw = canonicalNdjsonV1(records);
  const manifestPreimage = {
    contractVersion: 'full_support_pit_action_snapshot_manifest_v2',
    featureSchemaVersion: 'social_phoenix_action_position_1_based_v1',
    snapshotNdjsonSha256: sha256Text(snapshotRaw),
    targetDistributionNdjsonSha256: target.evidence.receipt.distributionNdjsonSha256,
    targetManifestSha256: target.evidence.targetManifestSha256,
    targetVerificationReceiptSha256: target.evidence.receipt.verificationReceiptSha256,
    decisionCount: 1,
    candidateBaseCount: baseRecords.length,
    physicalRecordCount: records.length,
    maxCandidateMembershipCount: baseRecords.length,
    historicalBackfill: 'unavailable',
    futureShadowCapture: 'code_ready_activation_blocked',
    realDatasetEligible: false,
    servable: false,
  };
  const manifest = {
    ...manifestPreimage,
    snapshotManifestSha256: sha256Text(canonicalJsonV1(manifestPreimage)),
  };
  return {
    fixture,
    receipt,
    targetEvidence: target.evidence,
    decision,
    baseRecords,
    records,
    snapshotRaw,
    input: {
      sourceKind: 'synthetic_fixture' as const,
      snapshotStream: stream(snapshotRaw, 9),
      manifestRaw: `${canonicalWireJsonV1(manifest)}\n`,
      targetEvidence: target.evidence,
    },
  };
}

function decisionLogDigest(decision: any): string {
  return sha256Text(canonicalJsonV1(decision));
}

async function rebuildSnapshot(
  context: Awaited<ReturnType<typeof snapshotContext>>,
  mutate: (records: any[]) => void = () => undefined,
) {
  const records = structuredClone(context.records);
  mutate(records);
  for (const candidate of records.filter((record) => record.recordType === 'candidate_base')) {
    candidate.sourceSha256 = selfSha256V1(candidate, 'sourceSha256');
  }
  const end = records.at(-1);
  end.decisionRecordsSha256 = sha256Text(
    `${records.slice(0, -1).map(canonicalJsonV1).join('\n')}\n`,
  );
  const snapshotRaw = canonicalNdjsonV1(records);
  const oldManifest = JSON.parse(context.input.manifestRaw);
  const manifestPreimage = {
    ...oldManifest,
    snapshotNdjsonSha256: sha256Text(snapshotRaw),
  };
  delete manifestPreimage.snapshotManifestSha256;
  const manifest = {
    ...manifestPreimage,
    snapshotManifestSha256: sha256Text(canonicalJsonV1(manifestPreimage)),
  };
  return {
    ...context.input,
    snapshotStream: stream(snapshotRaw, 8),
    manifestRaw: `${canonicalWireJsonV1(manifest)}\n`,
  };
}

async function predictionV2Context() {
  const snapshotSource = await snapshotContext();
  const verifiedSnapshot = await verifyFullSupportPitActionSnapshotV2(snapshotSource.input);
  if (verifiedSnapshot.status !== 'verified') throw new Error(verifiedSnapshot.blocker);
  const behaviorFixture = JSON.parse(await readFile(
    path.join(fixtureDirectory, 'phase11_synthetic_behavior_trajectory_v1.json'),
    'utf8',
  ));
  const syntheticDecisionLog = {
    contractVersion: 'synthetic_decision_log_v1' as const,
    decisionId: behaviorFixture.input.sourceDecisionLog.decisionId,
    requestId: behaviorFixture.input.sourceDecisionLog.requestId,
    decisionAt: behaviorFixture.input.sourceDecisionLog.decisionAt,
    sourceDecisionLogSha256: behaviorFixture.input.sourceDecisionLogSha256,
    sourceCandidatePoolSha256:
      behaviorFixture.input.sourceDecisionLog.candidatePool.candidatePoolSha256,
    behaviorPolicy: behaviorFixture.input.config,
    behaviorPolicyConfigSha256: behaviorFixture.behaviorPolicyConfigSha256,
    uniformDraws: behaviorFixture.input.uniformDraws,
    actions: behaviorFixture.expected.orderedActions.map((action: any, index: number) => ({
      actionKey: action.actionKey,
      selectionRank: index + 1,
      behaviorPropensity: {
        status: 'simulated_propensity' as const,
        plackettLuceProbability: action.plackettLuceProbability,
        conditionalSelectionProbability: action.conditionalSelectionProbability,
      },
    })),
    evidenceKind: 'simulated_propensity' as const,
    realDatasetEligible: false as const,
    servable: false as const,
  };
  const syntheticDecisionLogSha256 = sha256Text(canonicalJsonV1(syntheticDecisionLog));
  const outcomeRewardDefinition = {
    objective: 'synthetic_dwell',
    definitionVersion: 'phase11-synthetic-v1',
    horizonMs: 100,
    weights: {
      click: 0, like: 0, reply: 0, repost: 0, quote: 0,
      share: 0, dismiss: 0, blockAuthor: 0, report: 0,
    },
    dwell: { weight: 1, capMs: 10, scaleMs: 1 },
  };
  const traceUserId = 'phase11-synthetic-user';
  const impressionAt = Date.parse(syntheticDecisionLog.decisionAt) + 1;
  const events = syntheticDecisionLog.actions.flatMap((action: any, index: number) => {
    const common = {
      userId: traceUserId,
      requestId: syntheticDecisionLog.requestId,
      rank: action.actionKey.servedPosition,
      metadata: {
        decisionId: syntheticDecisionLog.decisionId,
        candidateNamespace: action.actionKey.candidateNamespace,
        candidateId: action.actionKey.candidateId,
        positionContractVersion: 'served_position_1_based_v1',
      },
    };
    const impression = {
      ...common,
      action: ActionType.IMPRESSION,
      timestamp: new Date(impressionAt).toISOString(),
      metadata: { ...common.metadata, recommendationEventKey: `prediction-impression-${index}` },
    };
    const dwell = {
      ...common,
      action: ActionType.DWELL,
      timestamp: new Date(impressionAt + 1).toISOString(),
      dwellTimeMs: index + 1,
      metadata: { ...common.metadata, recommendationEventKey: `prediction-dwell-${index}` },
    };
    return [impression, dwell].map((event) => ({
      eventId: event.metadata.recommendationEventKey,
      eventSha256: syntheticOutcomeEventSha256V1(event),
      event,
    }));
  });
  const outcome = verifySyntheticOutcomeEvidenceV1({
    contractVersion: 'synthetic_outcome_verification_input_v1',
    datasetVersion: 'phase11-synthetic-dataset',
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    traceUserId,
    observedThrough: new Date(impressionAt + outcomeRewardDefinition.horizonMs).toISOString(),
    rewardDefinition: outcomeRewardDefinition,
    events,
  });
  if (outcome.status !== 'verified') throw new Error(outcome.blocker);
  const syntheticContext = verifySyntheticContextV1({
    contractVersion: 'synthetic_context_verification_input_v1',
    datasetVersion: 'phase11-synthetic-dataset',
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    contextAt: new Date(Date.parse(syntheticDecisionLog.decisionAt) - 2).toISOString(),
    availableAt: new Date(Date.parse(syntheticDecisionLog.decisionAt) - 1).toISOString(),
    sourceSha256: 'd'.repeat(64),
    sourceVersion: 'phase11-prediction-context-v1',
    inferenceClusterId: 'cluster-prediction-v2',
    segments: { '\u{10000}': 'supplementary', '\uE000': 'bmp' },
  });
  if (syntheticContext.status !== 'verified') throw new Error(syntheticContext.blocker);
  const trajectory = await verifySyntheticTrajectoryEvidenceV1({
    contractVersion: 'synthetic_trajectory_verification_input_v1',
    behaviorFixture,
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    outcomeEvidence: outcome.evidence,
    contextEvidence: syntheticContext.evidence,
    targetEvidence: snapshotSource.targetEvidence,
    evidenceKind: 'simulated_propensity',
    realDatasetEligible: false,
    servable: false,
  });
  if (trajectory.status !== 'verified') throw new Error(trajectory.blocker);
  const trainingConfig = createCrossFittedTrainingConfigV1({
    foldCount: 2,
    epochs: 3,
    learningRate: 0.1,
    l2Lambda: 0.01,
  });
  const resourceConfig = phase11ModelStateResourceConfigV1({
    foldCount: 2,
    maxCoefficientsPerHead: 128,
    maxTotalCoefficientCount: 2_560,
    maxModelBytes: 64_000,
    maxGradientBytes: 64_000,
    maxTrainingDecisionsPerFold: 2,
    maxHoldoutDecisionsPerFold: 2,
    maxTrainingRowsPerFold: 8,
    maxHoldoutRowsPerFold: 8,
  });
  return {
    ...snapshotSource,
    snapshot: verifiedSnapshot.snapshot,
    behaviorFixture,
    syntheticDecisionLog,
    syntheticDecisionLogSha256,
    outcome: outcome.evidence,
    syntheticContext: syntheticContext.evidence,
    trajectory: trajectory.evidence,
    trainingConfig,
    resourceConfig,
    rewardDefinition: {
      contractVersion: 'offline_reward_definition_v1' as const,
      ...outcomeRewardDefinition,
    },
  };
}

async function readStreamRaw(factory: () => AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of factory()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const mutableStream = (read: () => string) => async function* () {
  const raw = Buffer.from(read());
  for (let offset = 0; offset < raw.length; offset += 13) yield raw.subarray(offset, offset + 13);
};

const invalidChunkCases = [
  {
    name: 'plain object',
    create: () => ({ valueOf: vi.fn(() => new Uint8Array([0x0a])) }),
  },
  {
    name: 'Uint8Array proxy',
    create: () => new Proxy(new Uint8Array([0x0a]), {
      get: () => { throw new Error('untrusted_proxy_getter_called'); },
    }),
  },
  {
    name: 'throwing byteLength getter',
    create: () => Object.defineProperty({}, 'byteLength', {
      get: () => { throw new Error('untrusted_byte_length_getter_called'); },
    }),
  },
  {
    name: 'Uint8Array with throwing valueOf',
    create: () => Object.defineProperty(new Uint8Array([0x0a]), 'valueOf', {
      value: () => { throw new Error('untrusted_value_of_called'); },
    }),
  },
  {
    name: 'Uint8Array with forging valueOf',
    create: () => Object.defineProperty(new Uint8Array([0x0a]), 'valueOf', {
      value: () => Buffer.from('12345'),
    }),
  },
] as const;

async function predictionSpoolDirectories(): Promise<string[]> {
  return (await readdir(os.tmpdir()))
    .filter((entry) => entry.startsWith('telegram-prediction-v2-'))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function recomputePredictionStreamDigests(records: any[]): string {
  const decisionEndIndex = records.findIndex((record) => record.recordType === 'decision_end');
  let stepStartIndex = -1;
  for (let index = 0; index < decisionEndIndex; index += 1) {
    if (records[index].recordType === 'step_start') stepStartIndex = index;
    if (records[index].recordType === 'step_end') {
      const raw = canonicalNdjsonV1(records.slice(stepStartIndex, index));
      records[index].stepSha256 = sha256Text(raw);
    }
  }
  records[decisionEndIndex].decisionSha256 = sha256Text(
    canonicalNdjsonV1(records.slice(0, decisionEndIndex)),
  );
  return canonicalNdjsonV1(records);
}

function freezeTestValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) freezeTestValue(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

describe('Phase 11B bounded cross-fitted prediction V2', () => {
  it('fails closed for hostile prediction inputs and verified-set brand probes', async () => {
    const ownKeysTrap = new Proxy(Object.freeze({}), {
      ownKeys: () => { throw new Error('hostile_own_keys'); },
    });
    const getterTrap = new Proxy(Object.freeze({}), {
      get: () => { throw new Error('hostile_getter'); },
    });

    expect(await produceCrossFittedPredictionSetV2(getterTrap as never)).toEqual({
      status: 'not_evaluable', blocker: 'prediction_v2_input_contract_invalid',
    });
    expect(await verifyCrossFittedPredictionSetV2(getterTrap as never)).toEqual({
      status: 'not_evaluable', blocker: 'prediction_v2_input_contract_invalid',
    });
    expect(isVerifiedCrossFittedPredictionSetV2(ownKeysTrap)).toBe(false);
    expect(isVerifiedCrossFittedPredictionSetV2(getterTrap)).toBe(false);
    expect(isVerifiedPredictionStepV2(ownKeysTrap)).toBe(false);
    expect(await openVerifiedPredictionCursorV2(ownKeysTrap as never)).toEqual({
      status: 'not_evaluable', blocker: 'prediction_v2_verified_brand_missing',
    });
  });

  it('rejects a second target decision before producing a prediction set', async () => {
    const value = await predictionV2Context();
    const firstDecision = {
      source: value.decision,
      decisionLogSha256: decisionLogDigest(value.decision),
      candidatePoolSha256: value.decision.candidatePool.candidatePoolSha256,
    };
    const replayVerifiedTarget = targetEvidenceV2.replayVerifiedTargetDistributionV2;
    const replay = vi.spyOn(targetEvidenceV2, 'replayVerifiedTargetDistributionV2')
      .mockImplementation(async (evidence, visitor) => {
        if (visitor.onDecisionEnd) return replayVerifiedTarget(evidence, visitor);
        try {
          await visitor.onDecisionStart?.(firstDecision);
          await visitor.onDecisionStart?.({
            ...firstDecision,
            source: { ...firstDecision.source, decisionId: 'second-target-decision' },
          });
        } catch {
          await visitor.abort('target_transaction_callback_failed');
          return { status: 'not_evaluable', blocker: 'target_transaction_callback_failed' };
        }
        return { status: 'verified' };
      });
    try {
      expect(await produceCrossFittedPredictionSetV2({
        snapshot: value.snapshot,
        targetEvidence: value.targetEvidence,
        outcomeEvidence: value.outcome,
        trainingConfig: value.trainingConfig,
        resourceConfig: value.resourceConfig,
        rewardDefinition: value.rewardDefinition,
      })).toEqual({
        status: 'not_evaluable',
        blocker: 'prediction_v2_multiple_target_decisions',
      });
    } finally {
      replay.mockRestore();
    }
  });

  it('re-spools, retrains, streams branded qHat into V3 DR, and binds both receipts', async () => {
    const value = await predictionV2Context();
    const input = {
      snapshot: value.snapshot,
      targetEvidence: value.targetEvidence,
      outcomeEvidence: value.outcome,
      trainingConfig: value.trainingConfig,
      resourceConfig: value.resourceConfig,
      rewardDefinition: value.rewardDefinition,
    };
    const produced = await produceCrossFittedPredictionSetV2(input);
    expect(produced.status).toBe('produced');
    if (produced.status !== 'produced') return;
    expect(produced.artifact.artifactState).toBe('pre_publish');
    expect(produced.artifact.bundle).toMatchObject({
      rowOrder: 'verified_target_stream_position_major_v2',
      spoolResourceConfigSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      runtimeConfigVersion: 'prediction_v2_runtime_config_v1',
      runtimeConfigSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(produced.artifact.diagnostics).toMatchObject({
      passCount: 8,
      peakStepActions: 3,
      peakStepBytes: expect.any(Number),
      records: 18,
    });
    expect(produced.artifact.manifest).toMatchObject({
      decisionCount: 1,
      stepCount: 2,
      predictionCount: 5,
      physicalRecordCount: 11,
    });
    expect(produced.artifact.diagnostics.records
      - produced.artifact.manifest.physicalRecordCount).toBe(7);
    expect(value.outcome.outcomes).toHaveLength(2);
    const featureCount = produced.artifact.bundle.folds[0]!.heads[0]!.coefficients.length;
    expect(featureCount).toBeGreaterThan(0);
    for (const fold of produced.artifact.bundle.folds) {
      expect(fold.heads.map((head) => head.head)).toEqual(OFFLINE_REWARD_HEADS_V1);
      expect(fold.heads.every((head) => head.coefficients.length === featureCount)).toBe(true);
    }
    let predictionRaw = await readStreamRaw(produced.artifact.predictionStream);
    const verified = await verifyCrossFittedPredictionSetV2({
      ...input,
      modelBundleRaw: produced.artifact.modelBundleRaw,
      predictionSetManifestRaw: produced.artifact.predictionSetManifestRaw,
      predictionStream: mutableStream(() => predictionRaw),
    });
    expect(verified.status).toBe('verified');
    if (verified.status !== 'verified') {
      await produced.artifact.dispose();
      return;
    }
    const cursorSpoolBaseline = await predictionSpoolDirectories();
    const cursor = await openVerifiedPredictionCursorV2(verified.predictionSet);
    expect(cursor.status).toBe('opened');
    if (cursor.status !== 'opened') {
      await produced.artifact.dispose();
      return;
    }
    const state = createOpeAggregateStateV3({
      limits: {
        maxDecisions: 1, maxSlots: 2, maxClusters: 1, maxSegmentKeys: 2,
        maxObjectives: 1, maxAggregateStateEntries: 2,
        maxEstimatedAggregateStateBytes: 65_536,
        maxBufferedActions: 4_096, maxBufferedRecords: 2_049, maxBufferedBytes: 1_048_576,
      },
      trajectories: [value.trajectory],
    });
    if (state.status !== 'created') throw new Error(state.blocker);
    const contributions: any[] = [];
    expect(await replayOpeTrajectoryV3(state.state, value.trajectory, {
      contextForStep: async (step) => {
        const prediction = await readVerifiedPredictionStepV2(cursor.cursor, step);
        if (prediction.status !== 'verified') throw new Error(prediction.blocker);
        return { predictionStep: prediction.step };
      },
      onContribution: (contribution) => { contributions.push(contribution); },
    })).toEqual({ status: 'verified' });
    expect(contributions).toHaveLength(2);
    expect(contributions.every((entry) => Number.isFinite(entry.drContribution))).toBe(true);
    expect(contributions[0].binding.prediction).toEqual({
      predictionSetVersion: verified.predictionSet.manifest.predictionSetVersion,
      verificationReceiptSha256: verified.predictionSet.receipt.receiptSha256,
    });
    const receipt = finalizeOpeAggregateReceiptV3(state.state);
    expect(receipt.status).toBe('verified');
    if (receipt.status === 'verified') {
      expect(receipt.receipt.receiptSha256).toBe(
        '88994a9d3e4ca4fb41c7b7af3b84fa007ca202764849f1d08d0f7f7330bb914e',
      );
      const aggregateKey = canonicalDecisionJson({
        inferenceClusterId: contributions[0].binding.inferenceClusterId,
        objective: contributions[0].binding.objective,
        segmentAssignments: contributions[0].binding.segmentAssignments,
      });
      const drSum = contributions.reduce(
        (sum, contribution) => sum + contribution.drContribution,
        0,
      );
      expect(receipt.receipt).toMatchObject({
        drSlotCount: 2,
        predictionEvidenceRootsSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        aggregateStateSha256: sha256Text(canonicalDecisionJson([[
          aggregateKey,
          { contributionSum: drSum, slotCount: 2 },
        ]])),
      });
      const mapped = buildPhase15SyntheticClusterStatisticMappingAuditV1({
        receipt: receipt.receipt,
        contributions,
      });
      expect(mapped.status).toBe('verified');
      if (mapped.status === 'verified') {
        expect(mapped.audit.clusterRows).toEqual([{
          inferenceClusterId: value.syntheticContext.inferenceClusterId,
          y: drSum,
          a: 2,
          importanceMass: contributions.reduce(
            (sum, contribution) => sum + contribution.weight,
            0,
          ),
        }]);
        expect(mapped.audit.clusterScoreSummaryResult).toEqual(
          summarizeClusterScoresV1('dr', mapped.audit.clusterRows),
        );
        expect(mapped.audit.clusterScoreSummaryResult).toEqual({
          status: 'not_evaluable', blocker: 'cluster_score_invalid',
        });
      }
    }
    const mixedCursor = await openVerifiedPredictionCursorV2(verified.predictionSet);
    if (mixedCursor.status !== 'opened') throw new Error(mixedCursor.blocker);
    const mixedState = createOpeAggregateStateV3({
      limits: {
        maxDecisions: 1, maxSlots: 2, maxClusters: 1, maxSegmentKeys: 2,
        maxObjectives: 1, maxAggregateStateEntries: 2,
        maxEstimatedAggregateStateBytes: 65_536,
        maxBufferedActions: 4_096, maxBufferedRecords: 2_049, maxBufferedBytes: 1_048_576,
      },
      trajectories: [value.trajectory],
    });
    if (mixedState.status !== 'created') throw new Error(mixedState.blocker);
    expect(await replayOpeTrajectoryV3(mixedState.state, value.trajectory, {
      contextForStep: async (step) => {
        if (step.servedPosition === 2) return {};
        const prediction = await readVerifiedPredictionStepV2(mixedCursor.cursor, step);
        if (prediction.status !== 'verified') throw new Error(prediction.blocker);
        return { predictionStep: prediction.step };
      },
    })).toEqual({ status: 'not_evaluable', blocker: 'ope_v3_mixed_dr_mode' });
    expect(finalizeOpeAggregateReceiptV3(mixedState.state)).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_mixed_dr_mode',
    });
    const qualificationProtocol = buildFrozenInferenceQualificationProtocolV1({
      protocolId: 'phase12-private-prediction-boundary',
      generatorSeedMaterial: 'phase12-private-generator-seed-v1',
      bootstrapSeedMaterial: 'phase12-private-bootstrap-seed-v1',
      frozenAt: '2026-07-27T00:00:00.000Z',
    });
    if (qualificationProtocol.status !== 'verified') {
      throw new Error(qualificationProtocol.blocker);
    }
    const privateScenario = qualificationProtocol.protocol.scenarios.find(
      (scenario) => scenario.scenarioId === 'nominal_positive',
    )!;
    const privateReplication = generateSyntheticClusterScoreReplicationV1(
      qualificationProtocol.protocol, privateScenario, 0,
    );
    if (privateReplication.status !== 'generated') throw new Error(privateReplication.blocker);
    const privateFixtureState = createOpeAggregateStateV3({
      limits: {
        maxDecisions: 1, maxSlots: 2, maxClusters: 1, maxSegmentKeys: 2,
        maxObjectives: 1, maxAggregateStateEntries: 2,
        maxEstimatedAggregateStateBytes: 65_536,
        maxBufferedActions: 4_096, maxBufferedRecords: 2_049, maxBufferedBytes: 1_048_576,
      },
      trajectories: [value.trajectory],
    });
    if (privateFixtureState.status !== 'created') throw new Error(privateFixtureState.blocker);
    expect(await replayOpeTrajectoryV3(privateFixtureState.state, value.trajectory, {
      contextForStep: async () => ({
        predictionStep: privateReplication.replication as never,
      }),
    })).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_prediction_step_invalid',
    });
    const partialCursor = await openVerifiedPredictionCursorV2(verified.predictionSet);
    const earlyCursor = await openVerifiedPredictionCursorV2(verified.predictionSet);
    if (partialCursor.status !== 'opened' || earlyCursor.status !== 'opened') {
      throw new Error('prediction cursor close probe failed');
    }
    expect(await readVerifiedPredictionStepV2(partialCursor.cursor, {
      decisionId: value.trajectory.decisionId,
      servedPosition: 1,
    })).toMatchObject({ status: 'verified' });
    expect(['\u{10000}', '\uE000'].sort((left, right) => (
      Buffer.compare(Buffer.from(left), Buffer.from(right))
    ))).toEqual(['\uE000', '\u{10000}']);
    const iteratorProbe = readCanonicalSpoolRecordsV2(async function* () {});
    const iteratorReturn = vi.spyOn(Object.getPrototypeOf(iteratorProbe), 'return');
    try {
      await closeVerifiedPredictionCursorV2(cursor.cursor);
      await closeVerifiedPredictionCursorV2(mixedCursor.cursor);
      await closeVerifiedPredictionCursorV2(partialCursor.cursor);
      await closeVerifiedPredictionCursorV2(earlyCursor.cursor);
      await closeVerifiedPredictionCursorV2(partialCursor.cursor);
      await closeVerifiedPredictionCursorV2(earlyCursor.cursor);
      expect(iteratorReturn).toHaveBeenCalledTimes(4);
      expect(await predictionSpoolDirectories()).toEqual(cursorSpoolBaseline);
    } finally {
      iteratorReturn.mockRestore();
    }
    await produced.artifact.dispose();
  });

  it('locks one prediction set and receipt pair for the entire DR state', async () => {
    const value = await predictionV2Context();
    const baseInput = {
      snapshot: value.snapshot,
      targetEvidence: value.targetEvidence,
      outcomeEvidence: value.outcome,
      resourceConfig: value.resourceConfig,
      rewardDefinition: value.rewardDefinition,
    };
    const first = await produceCrossFittedPredictionSetV2({
      ...baseInput,
      trainingConfig: value.trainingConfig,
    });
    const second = await produceCrossFittedPredictionSetV2({
      ...baseInput,
      trainingConfig: createCrossFittedTrainingConfigV1({
        foldCount: 2, epochs: 2, learningRate: 0.1, l2Lambda: 0.01,
      }),
    });
    if (first.status !== 'produced' || second.status !== 'produced') {
      throw new Error('prediction build failed');
    }
    const firstVerified = await verifyCrossFittedPredictionSetV2({
      ...baseInput,
      trainingConfig: value.trainingConfig,
      modelBundleRaw: first.artifact.modelBundleRaw,
      predictionSetManifestRaw: first.artifact.predictionSetManifestRaw,
      predictionStream: first.artifact.predictionStream,
    });
    const secondTrainingConfig = createCrossFittedTrainingConfigV1({
      foldCount: 2, epochs: 2, learningRate: 0.1, l2Lambda: 0.01,
    });
    const secondVerified = await verifyCrossFittedPredictionSetV2({
      ...baseInput,
      trainingConfig: secondTrainingConfig,
      modelBundleRaw: second.artifact.modelBundleRaw,
      predictionSetManifestRaw: second.artifact.predictionSetManifestRaw,
      predictionStream: second.artifact.predictionStream,
    });
    if (firstVerified.status !== 'verified' || secondVerified.status !== 'verified') {
      throw new Error('prediction verification failed');
    }
    const firstCursor = await openVerifiedPredictionCursorV2(firstVerified.predictionSet);
    const secondCursor = await openVerifiedPredictionCursorV2(secondVerified.predictionSet);
    if (firstCursor.status !== 'opened' || secondCursor.status !== 'opened') {
      throw new Error('prediction cursor failed');
    }
    const advanceSecondCursor = await readVerifiedPredictionStepV2(secondCursor.cursor, {
      decisionId: value.trajectory.decisionId,
      servedPosition: 1,
    });
    if (advanceSecondCursor.status !== 'verified') throw new Error(advanceSecondCursor.blocker);
    const state = createOpeAggregateStateV3({
      limits: {
        maxDecisions: 1, maxSlots: 2, maxClusters: 1, maxSegmentKeys: 2,
        maxObjectives: 1, maxAggregateStateEntries: 2,
        maxEstimatedAggregateStateBytes: 65_536,
        maxBufferedActions: 4_096, maxBufferedRecords: 2_049, maxBufferedBytes: 1_048_576,
      },
      trajectories: [value.trajectory],
    });
    if (state.status !== 'created') throw new Error(state.blocker);
    expect(await replayOpeTrajectoryV3(state.state, value.trajectory, {
      contextForStep: async (step) => {
        const cursor = step.servedPosition === 1 ? firstCursor.cursor : secondCursor.cursor;
        const prediction = await readVerifiedPredictionStepV2(cursor, step);
        if (prediction.status !== 'verified') throw new Error(prediction.blocker);
        return { predictionStep: prediction.step };
      },
    })).toEqual({
      status: 'not_evaluable', blocker: 'ope_v3_prediction_receipt_mismatch',
    });
    await closeVerifiedPredictionCursorV2(firstCursor.cursor);
    await closeVerifiedPredictionCursorV2(secondCursor.cursor);
    await first.artifact.dispose();
    await second.artifact.dispose();
  });

  it('rejects recomputed ordinary digests, mixed versions, late drift, and bounded failures', async () => {
    const value = await predictionV2Context();
    const input = {
      snapshot: value.snapshot,
      targetEvidence: value.targetEvidence,
      outcomeEvidence: value.outcome,
      trainingConfig: value.trainingConfig,
      resourceConfig: value.resourceConfig,
      rewardDefinition: value.rewardDefinition,
    };
    const produced = await produceCrossFittedPredictionSetV2(input);
    if (produced.status !== 'produced') throw new Error(produced.blocker);
    let predictionRaw = await readStreamRaw(produced.artifact.predictionStream);

    const mutableTrainingConfig = structuredClone(value.trainingConfig);
    const snapshottedConfigBuild = produceCrossFittedPredictionSetV2({
      ...input,
      trainingConfig: mutableTrainingConfig,
    });
    mutableTrainingConfig.epochs = 99;
    const snapshottedConfigArtifact = await snapshottedConfigBuild;
    if (snapshottedConfigArtifact.status !== 'produced') {
      throw new Error(snapshottedConfigArtifact.blocker);
    }
    expect(snapshottedConfigArtifact.artifact.bundle.trainingConfigSha256)
      .toBe(produced.artifact.bundle.trainingConfigSha256);
    await snapshottedConfigArtifact.artifact.dispose();

    const tamperedOutcome = structuredClone(value.outcome) as any;
    tamperedOutcome.outcomes[0].outcome.labels.click = !tamperedOutcome.outcomes[0].outcome.labels.click;
    const outcomePreimage = { ...tamperedOutcome };
    delete outcomePreimage.syntheticOutcomeEvidenceSha256;
    tamperedOutcome.syntheticOutcomeEvidenceSha256 = sha256Text(canonicalJsonV1(outcomePreimage));
    expect(await produceCrossFittedPredictionSetV2({
      ...input,
      outcomeEvidence: freezeTestValue(tamperedOutcome),
    })).toEqual({ status: 'not_evaluable', blocker: 'verified_synthetic_outcome_required' });

    const changedSnapshotInput = await rebuildSnapshot(value, (records) => {
      records.find((record) => record.recordType === 'candidate_base')
        .featureInput.retrievalEmbeddingScore += 0.25;
    });
    const changedSnapshot = await verifyFullSupportPitActionSnapshotV2(changedSnapshotInput);
    if (changedSnapshot.status !== 'verified') throw new Error(changedSnapshot.blocker);
    expect((await verifyCrossFittedPredictionSetV2({
      ...input,
      snapshot: changedSnapshot.snapshot,
      modelBundleRaw: produced.artifact.modelBundleRaw,
      predictionSetManifestRaw: produced.artifact.predictionSetManifestRaw,
      predictionStream: mutableStream(() => predictionRaw),
    })).status).toBe('not_evaluable');

    const tamperedBundle = structuredClone(produced.artifact.bundle) as any;
    tamperedBundle.folds[0].heads[0].coefficients[0].value += 0.25;
    const foldPreimage = { ...tamperedBundle.folds[0] };
    delete foldPreimage.foldModelSha256;
    tamperedBundle.folds[0].foldModelSha256 = sha256Text(canonicalJsonV1(foldPreimage));
    const bundlePreimage = { ...tamperedBundle };
    delete bundlePreimage.modelBundleSha256;
    tamperedBundle.modelBundleSha256 = sha256Text(canonicalJsonV1(bundlePreimage));
    const tamperedManifest = structuredClone(produced.artifact.manifest) as any;
    tamperedManifest.modelBundleSha256 = tamperedBundle.modelBundleSha256;
    const manifestPreimage = { ...tamperedManifest };
    delete manifestPreimage.predictionSetVersion;
    tamperedManifest.predictionSetVersion = sha256Text(canonicalJsonV1(manifestPreimage));
    expect(await verifyCrossFittedPredictionSetV2({
      ...input,
      modelBundleRaw: `${canonicalWireJsonV1(tamperedBundle)}\n`,
      predictionSetManifestRaw: `${canonicalWireJsonV1(tamperedManifest)}\n`,
      predictionStream: mutableStream(() => predictionRaw),
    })).toEqual({ status: 'not_evaluable', blocker: 'prediction_v2_retraining_mismatch' });

    const mismatchedRecords = predictionRaw.trimEnd().split('\n').map(JSON.parse);
    mismatchedRecords[0].expectedStepCount -= 1;
    let mismatchedIteratorClosed = false;
    const mismatchedStream = async function* () {
      try {
        for (const record of mismatchedRecords) {
          yield Buffer.from(`${canonicalWireJsonV1(record)}\n`);
        }
      } finally {
        mismatchedIteratorClosed = true;
      }
    };
    expect(await verifyCrossFittedPredictionSetV2({
      ...input,
      modelBundleRaw: produced.artifact.modelBundleRaw,
      predictionSetManifestRaw: produced.artifact.predictionSetManifestRaw,
      predictionStream: mismatchedStream,
    })).toEqual({ status: 'not_evaluable', blocker: 'prediction_v2_stream_mismatch' });
    expect(mismatchedIteratorClosed).toBe(true);

    const verified = await verifyCrossFittedPredictionSetV2({
      ...input,
      modelBundleRaw: produced.artifact.modelBundleRaw,
      predictionSetManifestRaw: produced.artifact.predictionSetManifestRaw,
      predictionStream: mutableStream(() => predictionRaw),
    });
    if (verified.status !== 'verified') throw new Error(verified.blocker);
    expect(await openVerifiedPredictionCursorV2({
      ...verified.predictionSet,
      contractVersion: 'verified_cross_fitted_prediction_set_v1',
    } as any)).toEqual({
      status: 'not_evaluable', blocker: 'prediction_v2_verified_brand_missing',
    });

    const driftedRecords = predictionRaw.trimEnd().split('\n').map(JSON.parse);
    driftedRecords.find((record: any) => record.recordType === 'prediction').qHat += 0.1;
    predictionRaw = recomputePredictionStreamDigests(driftedRecords);
    expect(await openVerifiedPredictionCursorV2(verified.predictionSet)).toEqual({
      status: 'not_evaluable', blocker: 'prediction_v2_cursor_digest_mismatch',
    });

    const tightResource = phase11ModelStateResourceConfigV1({
      foldCount: 2,
      maxCoefficientsPerHead: 1,
      maxTotalCoefficientCount: 20,
      maxModelBytes: 1_000,
      maxGradientBytes: 1_000,
      maxTrainingDecisionsPerFold: 2,
      maxHoldoutDecisionsPerFold: 2,
      maxTrainingRowsPerFold: 8,
      maxHoldoutRowsPerFold: 8,
    });
    expect(await produceCrossFittedPredictionSetV2({
      ...input,
      resourceConfig: tightResource,
    })).toEqual({ status: 'not_evaluable', blocker: 'model_state_resource_limit_exceeded' });
    const tightRows = phase11ModelStateResourceConfigV1({
      foldCount: 2,
      maxCoefficientsPerHead: 128,
      maxTotalCoefficientCount: 2_560,
      maxModelBytes: 64_000,
      maxGradientBytes: 64_000,
      maxTrainingDecisionsPerFold: 2,
      maxHoldoutDecisionsPerFold: 2,
      maxTrainingRowsPerFold: 1,
      maxHoldoutRowsPerFold: 1,
    });
    expect(await produceCrossFittedPredictionSetV2({
      ...input,
      resourceConfig: tightRows,
    })).toEqual({ status: 'not_evaluable', blocker: 'model_state_resource_limit_exceeded' });
    expect(await produceCrossFittedPredictionSetV2({
      ...input,
      spoolLimits: { maxLineBytes: 1 << 20, maxFileBytes: 1 << 20, maxRecords: 1 },
    })).toEqual({
      status: 'not_evaluable', blocker: 'prediction_spool_resource_limit_exceeded',
    });
    expect(await produceCrossFittedPredictionSetV2({
      ...input,
      spoolLimits: {
        ...DEFAULT_PREDICTION_SPOOL_LIMITS_V2,
        maxLineBytes: DEFAULT_PREDICTION_SPOOL_LIMITS_V2.maxLineBytes + 1,
      },
    })).toEqual({
      status: 'not_evaluable', blocker: 'prediction_spool_resource_config_invalid',
    });
    await expect((async () => {
      for await (const _entry of readCanonicalSpoolRecordsV2(
        async function* () { yield Buffer.alloc(5); },
        { maxLineBytes: 4, maxFileBytes: 4, maxRecords: 1 },
      )) void _entry;
    })()).rejects.toThrow('prediction_spool_resource_limit_exceeded');
    expect((await produceCrossFittedPredictionSetV2({
      ...input,
      trainingConfig: createCrossFittedTrainingConfigV1({
        foldCount: 3, epochs: 1, learningRate: 0.1, l2Lambda: 0,
      }),
    }))).toEqual({ status: 'not_evaluable', blocker: 'prediction_v2_fold_contract_invalid' });
    await produced.artifact.dispose();
  });

  it.each(invalidChunkCases)(
    'rejects a $name before Buffer.from or user-controlled getters run',
    async ({ create }) => {
      const invalidChunk = create();
      const bufferFrom = vi.spyOn(Buffer, 'from');
      let copyCalls = -1;
      let caught: unknown;
      try {
        const stream = () => ({
          [Symbol.asyncIterator]() {
            let yielded = false;
            return {
              next: async () => {
                if (yielded) return { done: true, value: undefined };
                yielded = true;
                return { done: false, value: invalidChunk };
              },
            };
          },
        });
        for await (const _entry of readCanonicalSpoolRecordsV2(
          stream as any,
        )) void _entry;
      } catch (error) {
        caught = error;
      } finally {
        copyCalls = bufferFrom.mock.calls.length;
        bufferFrom.mockRestore();
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('prediction_spool_contract_invalid');
      expect(copyCalls).toBe(0);
    },
  );
});
