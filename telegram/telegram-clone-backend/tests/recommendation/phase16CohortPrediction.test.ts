import { readFile } from 'fs/promises';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionType } from '../../src/models/UserAction';
import {
  verifyDecisionContextEvidenceV1,
} from '../../src/services/recommendation/decisionContext/verify';
import {
  decisionLogSha256,
  recommendationDecisionLogSchema,
} from '../../src/services/recommendation/decisionLog/contracts';
import {
  canonicalJsonV1,
  canonicalNdjsonV1,
  canonicalWireJsonV1,
  sha256Text,
} from '../../src/services/recommendation/offlinePrediction/artifacts/canonical';
import {
  copyBoundedByteStreamChunkV1,
} from '../../src/services/recommendation/offlinePrediction/artifacts/byteStream';
import {
  buildViewerClusterHoldoutPlanV1,
  closeVerifiedCohortPredictionCursorV3,
  isVerifiedCohortPredictionStepV3,
  isVerifiedCrossFittedCohortPredictionSetV3,
  isVerifiedViewerClusterHoldoutPlanV1,
  openVerifiedCohortPredictionCursorV3,
  PREDICTION_V3_RESOURCE_LIMITS,
  produceCrossFittedCohortPredictionSetV3,
  readVerifiedCohortPredictionStepV3,
  verifyCrossFittedCohortPredictionSetV3,
} from '../../src/services/recommendation/offlinePrediction/predictionV3';
import {
  isVerifiedMultiwayPredictionSetV4,
  produceMultiwayPredictionSetV4,
  verifyMultiwayPredictionSetV4,
} from '../../src/services/recommendation/offlinePrediction/predictionV4';
import {
  readCanonicalSpoolRecordsV2,
} from '../../src/services/recommendation/offlinePrediction/predictionV2/spool';
import {
  isVerifiedSyntheticCohortTrajectoryEvidenceV1,
  replayVerifiedSyntheticCohortTrajectoryEvidenceV1,
  verifySyntheticCohortTrajectoryEvidenceV1,
} from '../../src/services/recommendation/offlinePrediction/streamingV3';
import {
  verifyFullSupportPitActionSnapshotV2,
} from '../../src/services/recommendation/offlinePrediction/snapshotV2';
import {
  verifyTargetDistributionStreamV2,
} from '../../src/services/recommendation/offlinePrediction/targetEvidence';
import {
  buildPhase16SameProcessNoCandidateHandoffV1,
  isVerifiedPhase16SameProcessNoCandidateHandoffV1,
  PHASE16_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v6/handoff';
import {
  buildPhase17SyntheticViewerClusterMappingAuditV1,
  isVerifiedPhase17SyntheticViewerClusterMappingAuditV1,
} from '../../src/services/recommendation/ope/inference/qualification/v7/clusterMapping';
import {
  buildPhase17SameProcessNoCandidateHandoffV1,
  isVerifiedPhase17SameProcessNoCandidateHandoffV1,
  PHASE17_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v7/handoff';
import {
  buildPhase18MultiwayHoldoutPlanAuditV1,
  isVerifiedPhase18MultiwayHoldoutPlanAuditV1,
} from '../../src/services/recommendation/ope/inference/qualification/v8/multiwayHoldout';
import {
  buildPhase18SameProcessNoCandidateHandoffV1,
  isVerifiedPhase18SameProcessNoCandidateHandoffV1,
  PHASE18_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v8/handoff';
import {
  buildPhase18SyntheticViewerTimeProvenanceV1,
  isVerifiedPhase18SyntheticViewerTimeProvenanceV1,
} from '../../src/services/recommendation/ope/inference/qualification/v8/timeProvenance';
import {
  buildPhase19SameProcessNoCandidateHandoffV1,
  isVerifiedPhase19SameProcessNoCandidateHandoffV1,
  PHASE19_HANDOFF_BLOCKERS_V1,
} from '../../src/services/recommendation/ope/inference/qualification/v9/handoff';
import {
  evaluateSyntheticCohortOpeV4,
  isOpeSlotContributionBoundToReceiptV4,
  isVerifiedOpeAggregateReceiptV4,
} from '../../src/services/recommendation/ope/v4';
import {
  syntheticOutcomeEventSha256V1,
  verifySyntheticOutcomeEvidenceV1,
} from '../../src/services/recommendation/outcomes/syntheticOutcomeEvidenceV1';

const phase15Handoffs = vi.hoisted(() => new WeakSet<object>());

vi.mock(
  '../../src/services/recommendation/ope/inference/qualification/v5/handoff',
  async (importOriginal) => ({
    ...(await importOriginal<typeof import(
      '../../src/services/recommendation/ope/inference/qualification/v5/handoff'
    )>()),
    isVerifiedPhase15SameProcessNoCandidateHandoffV1: (value: unknown) => (
      !!value && typeof value === 'object' && phase15Handoffs.has(value)
    ),
  }),
);

const fixturePath = path.resolve(
  __dirname,
  'fixtures/phase16_target_distribution_multi_decision_v1.json',
);

const stream = (raw: string, chunkBytes = 17) => async function* () {
  const bytes = Buffer.from(raw);
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    yield bytes.subarray(offset, offset + chunkBytes);
  }
};

const disposers: Array<() => Promise<void>> = [];

const rewardDefinition = {
  contractVersion: 'offline_reward_definition_v1' as const,
  objective: 'synthetic_dwell',
  definitionVersion: 'phase16-synthetic-v1',
  horizonMs: 100,
  weights: {
    click: 0,
    like: 0,
    reply: 0,
    repost: 0,
    quote: 0,
    share: 0,
    dismiss: 0,
    blockAuthor: 0,
    report: 0,
  },
  dwell: { weight: 1, capMs: 10, scaleMs: 1 },
};

const behaviorPolicy = {
  policyId: 'eligible_pool_epsilon_plackett_luce_v1' as const,
  policyVersion: 'phase16-synthetic-behavior-v1',
  configVersion: 'phase16-synthetic-behavior-v1',
  epsilon: 0.3,
  temperature: 1,
  slateSize: 2,
};

type Phase16TargetFixtureDocument = {
  sourceDecisionNdjson: string;
  expectedDistributionNdjson: string;
  sourceDatasetManifestRaw: string;
  policyConfigRaw: string;
  expectedTargetManifestRaw: string;
  expectedReceipt: unknown;
};

async function phase16TargetFixture() {
  const fixture = JSON.parse(
    await readFile(fixturePath, 'utf8'),
  ) as Phase16TargetFixtureDocument;
  const result = await verifyTargetDistributionStreamV2({
    trustScope: 'synthetic_fixture',
    sourceDecisionStream: stream(fixture.sourceDecisionNdjson),
    distributionStream: stream(fixture.expectedDistributionNdjson),
    sourceDatasetManifestRaw: fixture.sourceDatasetManifestRaw,
    policyConfigRaw: fixture.policyConfigRaw,
    targetManifestRaw: fixture.expectedTargetManifestRaw,
    verificationReceiptRaw: `${canonicalWireJsonV1(fixture.expectedReceipt)}\n`,
  });
  if (result.status !== 'verified') throw new Error(result.blocker);
  const decisions = fixture.sourceDecisionNdjson.trim().split('\n')
    .map((line: string) => recommendationDecisionLogSchema.parse(JSON.parse(line)));
  return { fixture, targetEvidence: result.evidence, decisions };
}

function viewerContext(decisions: Awaited<ReturnType<typeof phase16TargetFixture>>['decisions']) {
  const result = verifyDecisionContextEvidenceV1({
    datasetVersion: 'synthetic-phase16-cohort-v1',
    crossUserDependence: { status: 'none_observed_in_verified_source_v1' },
    decisions: decisions.map((decision, index) => ({
      decisionLog: decision,
      contextAt: new Date(Date.parse(decision.decisionAt) - 2_000).toISOString(),
      availableAt: new Date(Date.parse(decision.decisionAt) - 1_000).toISOString(),
      sourceSha256: `${index}`.padStart(64, 'a'),
      sourceVersion: 'phase16-viewer-context-fixture-v1',
      subject: {
        kind: 'viewer' as const,
        viewerAccountPseudonym: index < 2 ? 'phase16-viewer-a' : 'phase16-viewer-b',
      },
      inferenceClusterId: index < 2
        ? 'phase16-viewer-cluster-0'
        : 'phase16-viewer-cluster-1',
      clusterUnitVersion: 'viewer_account_pseudonym_v1' as const,
      realDatasetEligible: false,
      segments: { cohort: 'phase16-synthetic' },
    })),
  });
  if (result.status !== 'verified') throw new Error(result.blocker);
  return result.evidence;
}

function phase16SnapshotInput(
  source: Awaited<ReturnType<typeof phase16TargetFixture>>,
) {
  const records: unknown[] = [];
  let candidateBaseCount = 0;
  let maxCandidateMembershipCount = 0;
  for (const [decisionIndex, decision] of source.decisions.entries()) {
    const decisionAt = new Date(decision.decisionAt).toISOString();
    const eligible = decision.candidatePool.candidates.filter((candidate) => candidate.eligible);
    const start = {
      recordType: 'decision_start' as const,
      contractVersion: 'full_support_pit_action_snapshot_v2' as const,
      decisionId: decision.decisionId,
      requestId: decision.requestId,
      decisionAt,
      decisionLogSha256: decisionLogSha256(decision),
      candidatePoolSha256: decision.candidatePool.candidatePoolSha256,
      featureSchemaVersion: 'social_phoenix_action_position_1_based_v1' as const,
      featureDependency: 'candidate_position_only_v1' as const,
      versions: decision.versions,
      expectedCandidateCount: eligible.length,
      historicalBackfill: 'unavailable' as const,
      futureShadowCapture: 'code_ready_activation_blocked' as const,
      servable: false as const,
    };
    const decisionRecords: unknown[] = [start];
    for (const [candidateIndex, candidate] of eligible.entries()) {
      const preimage = {
        recordType: 'candidate_base' as const,
        decisionId: decision.decisionId,
        candidateNamespace: candidate.candidateNamespace,
        candidateId: candidate.candidateId,
        poolRank: candidate.poolRank,
        featureAt: new Date(Date.parse(decision.decisionAt) - 2_000).toISOString(),
        availableAt: new Date(Date.parse(decision.decisionAt) - 1_000).toISOString(),
        featureInput: {
          userState: decisionIndex < 2 ? 'warm' as const : 'cold_start' as const,
          recallSource: decisionIndex < 2
            ? 'phase16-cluster-0-only'
            : 'phase16-cluster-1-only',
          inNetwork: decisionIndex < 2,
          retrievalEmbeddingScore: (candidateIndex + 1) / 10,
          createdAt: new Date(Date.parse(decision.decisionAt) - 3_600_000).toISOString(),
        },
        sourceVersion: 'phase16-candidate-base-v1',
      };
      decisionRecords.push({
        ...preimage,
        sourceSha256: sha256Text(canonicalJsonV1(preimage)),
      });
    }
    records.push(...decisionRecords, {
      recordType: 'decision_end',
      decisionId: decision.decisionId,
      candidateBaseCount: eligible.length,
      decisionRecordsSha256: sha256Text(
        `${decisionRecords.map(canonicalJsonV1).join('\n')}\n`,
      ),
    });
    candidateBaseCount += eligible.length;
    maxCandidateMembershipCount = Math.max(maxCandidateMembershipCount, eligible.length);
  }

  const snapshotRaw = canonicalNdjsonV1(records);
  const manifestPreimage = {
    contractVersion: 'full_support_pit_action_snapshot_manifest_v2' as const,
    featureSchemaVersion: 'social_phoenix_action_position_1_based_v1' as const,
    snapshotNdjsonSha256: sha256Text(snapshotRaw),
    targetDistributionNdjsonSha256:
      source.targetEvidence.receipt.distributionNdjsonSha256,
    targetManifestSha256: source.targetEvidence.targetManifestSha256,
    targetVerificationReceiptSha256:
      source.targetEvidence.receipt.verificationReceiptSha256,
    decisionCount: source.decisions.length,
    candidateBaseCount,
    physicalRecordCount: records.length,
    maxCandidateMembershipCount,
    historicalBackfill: 'unavailable' as const,
    futureShadowCapture: 'code_ready_activation_blocked' as const,
    realDatasetEligible: false as const,
    servable: false as const,
  };
  const manifest = {
    ...manifestPreimage,
    snapshotManifestSha256: sha256Text(canonicalJsonV1(manifestPreimage)),
  };
  return {
    sourceKind: 'synthetic_fixture' as const,
    snapshotStream: stream(snapshotRaw, 19),
    manifestRaw: `${canonicalWireJsonV1(manifest)}\n`,
    targetEvidence: source.targetEvidence,
  };
}

function phase16SyntheticDecisions(
  source: Awaited<ReturnType<typeof phase16TargetFixture>>,
  traceUserIdForDecision?: (decisionIndex: number) => string,
) {
  const behaviorPolicyConfigSha256 = sha256Text(canonicalJsonV1(behaviorPolicy));
  const { contractVersion: _ignored, ...outcomeRewardDefinition } = rewardDefinition;
  return source.decisions.map((decision, decisionIndex) => {
    const syntheticDecisionLog = {
      contractVersion: 'synthetic_decision_log_v1' as const,
      decisionId: decision.decisionId,
      requestId: decision.requestId,
      decisionAt: decision.decisionAt,
      sourceDecisionLogSha256: decisionLogSha256(decision),
      sourceCandidatePoolSha256: decision.candidatePool.candidatePoolSha256,
      behaviorPolicy,
      behaviorPolicyConfigSha256,
      uniformDraws: [0.2, 0.4],
      actions: decision.actions.map((action, actionIndex) => ({
        actionKey: action.actionKey,
        selectionRank: actionIndex + 1,
        behaviorPropensity: {
          status: 'simulated_propensity' as const,
          plackettLuceProbability: actionIndex === 0 ? 0.5 : 0.25,
          conditionalSelectionProbability: 0.5,
        },
      })),
      evidenceKind: 'simulated_propensity' as const,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    const syntheticDecisionLogSha256 = sha256Text(canonicalJsonV1(syntheticDecisionLog));
    const traceUserId = traceUserIdForDecision?.(decisionIndex)
      ?? (decisionIndex < 2 ? 'phase16-viewer-a' : 'phase16-viewer-b');
    const impressionAt = Date.parse(decision.decisionAt) + 1;
    const events = syntheticDecisionLog.actions.flatMap((action, actionIndex) => {
      const common = {
        userId: traceUserId,
        requestId: decision.requestId,
        rank: action.actionKey.servedPosition,
        metadata: {
          decisionId: decision.decisionId,
          candidateNamespace: action.actionKey.candidateNamespace,
          candidateId: action.actionKey.candidateId,
          positionContractVersion: 'served_position_1_based_v1',
        },
      };
      const impression = {
        ...common,
        action: ActionType.IMPRESSION,
        timestamp: new Date(impressionAt + actionIndex * 2).toISOString(),
        metadata: {
          ...common.metadata,
          recommendationEventKey: `phase16-${decisionIndex}-${actionIndex}-impression`,
        },
      };
      const dwell = {
        ...common,
        action: ActionType.DWELL,
        timestamp: new Date(impressionAt + actionIndex * 2 + 1).toISOString(),
        dwellTimeMs: decisionIndex + actionIndex + 1,
        metadata: {
          ...common.metadata,
          recommendationEventKey: `phase16-${decisionIndex}-${actionIndex}-dwell`,
        },
      };
      return [impression, dwell].map((event) => ({
        eventId: event.metadata.recommendationEventKey,
        eventSha256: syntheticOutcomeEventSha256V1(event),
        event,
      }));
    });
    const outcome = verifySyntheticOutcomeEvidenceV1({
      contractVersion: 'synthetic_outcome_verification_input_v1',
      datasetVersion: 'synthetic-phase16-cohort-v1',
      syntheticDecisionLog,
      syntheticDecisionLogSha256,
      traceUserId,
      observedThrough: new Date(
        Date.parse(decision.decisionAt) + 1_000,
      ).toISOString(),
      rewardDefinition: outcomeRewardDefinition,
      events,
    });
    if (outcome.status !== 'verified') throw new Error(outcome.blocker);
    return { syntheticDecisionLog, outcomeEvidence: outcome.evidence };
  });
}

async function phase16PredictionInput(
  traceUserIdForDecision?: (decisionIndex: number) => string,
) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
  const source = await phase16TargetFixture();
  const snapshotResult = await verifyFullSupportPitActionSnapshotV2(
    phase16SnapshotInput(source),
  );
  if (snapshotResult.status !== 'verified') throw new Error(snapshotResult.blocker);
  return {
    source,
    input: {
      targetEvidence: source.targetEvidence,
      snapshot: snapshotResult.snapshot,
      decisionContextEvidence: viewerContext(source.decisions),
      decisions: phase16SyntheticDecisions(source, traceUserIdForDecision),
      rewardDefinition,
    },
  };
}

async function producedPhase16Cohort() {
  const prepared = await phase16PredictionInput();
  const produced = await produceCrossFittedCohortPredictionSetV3(prepared.input);
  if (produced.status !== 'produced') throw new Error(produced.blocker);
  disposers.push(produced.artifact.dispose);
  return { ...prepared, artifact: produced.artifact };
}

async function verifiedPhase16Cohort() {
  const produced = await producedPhase16Cohort();
  const verified = await verifyCrossFittedCohortPredictionSetV3({
    ...produced.input,
    modelBundleRaw: produced.artifact.modelBundleRaw,
    predictionSetManifestRaw: produced.artifact.predictionSetManifestRaw,
    predictionStream: produced.artifact.predictionStream,
  });
  if (verified.status !== 'verified') throw new Error(verified.blocker);
  return { ...produced, predictionSet: verified.predictionSet };
}

async function streamRecords(factory: () => AsyncIterable<string | Uint8Array>) {
  const chunks: Buffer[] = [];
  for await (const chunk of factory()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim().split('\n').map((line) => (
    JSON.parse(line) as Record<string, any>
  ));
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

describe('Phase 16 cohort prediction', () => {
  it('brands the exact four-decision Rust target fixture', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    const source = await phase16TargetFixture();
    expect(source.targetEvidence.receipt).toMatchObject({
      verifiedDecisionCount: 4,
      verifiedStepCount: 8,
      verifiedActionProbabilityCount: 20,
      verifiedPhysicalRecordCount: 36,
    });
  });

  it('assigns all decisions from one viewer cluster to one holdout fold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    const source = await phase16TargetFixture();
    const evidence = viewerContext(source.decisions);
    const result = buildViewerClusterHoldoutPlanV1({ decisionContextEvidence: evidence });
    expect(result.status).toBe('verified');
    if (result.status !== 'verified') return;
    expect(isVerifiedViewerClusterHoldoutPlanV1(result.plan)).toBe(true);
    expect(result.plan.assignments).toEqual([
      {
        inferenceClusterId: 'phase16-viewer-cluster-0',
        foldId: 0,
        decisionIds: source.decisions.slice(0, 2).map((decision) => decision.decisionId),
      },
      {
        inferenceClusterId: 'phase16-viewer-cluster-1',
        foldId: 1,
        decisionIds: source.decisions.slice(2).map((decision) => decision.decisionId),
      },
    ]);
    expect(result.plan.folds.every((fold) => (
      fold.trainingInferenceClusterIds.length === 1
      && fold.holdoutInferenceClusterIds.length === 1
      && fold.trainingDecisionIds.length === 2
      && fold.holdoutDecisionIds.length === 2
      && fold.trainingDecisionIds.every((decisionId) => (
        !fold.holdoutDecisionIds.includes(decisionId)
      ))
    ))).toBe(true);
  });

  it('joins four decisions and exactly retrains fold-local cohort models', async () => {
    const { source, artifact, predictionSet } = await verifiedPhase16Cohort();
    expect(artifact.bundle.modelBundleSha256).toBe(
      '47581d461717548c2c75e07e453512d045e620c7c49c44a77357c75d9b6e73f6',
    );
    expect(artifact.manifest.predictionStreamSha256).toBe(
      'd8f065a6d33e7296bd43c3b89ad0db9037aafe65e0299b1a19f488ffcb010803',
    );
    expect(predictionSet.receipt.receiptSha256).toBe(
      'a6d5d2d86eeabdd2dbd919a78a52874ffe8443f1c13ed8d3b0b2abdbd58bf009',
    );
    expect(artifact.manifest).toMatchObject({
      decisionCount: 4,
      viewerClusterCount: 2,
      stepCount: 8,
      predictionCount: 20,
      trainingRowCount: 20,
      candidateBaseCount: 12,
      auxiliaryRowCount: 0,
      realDatasetEligible: false,
      servable: false,
    });
    expect(artifact.diagnostics).toMatchObject({
      preflightCompletedBeforeSpool: true,
      decisionCount: 4,
      viewerClusterCount: 2,
      slotCount: 8,
      supportActionRowCount: 20,
      candidateBaseRowCount: 12,
      trainingRowCount: 20,
      predictionRecordCount: 44,
      combinedSpoolRecordCount: 64,
      workModelVersion: 'cohort_prediction_producer_verifier_work_model_v1',
      targetEvidenceReplayPasses: 4,
      targetEvidenceReplayRecords: 160,
      snapshotEvidenceReplayPasses: 2,
      snapshotEvidenceReplayRecords: 40,
      trainingSpoolReplayPasses: 12,
      trainingSpoolReplayRows: 240,
      verificationPredictionStreamReadRows: 88,
      verificationPredictionStreamComparisonRows: 44,
    });

    const fold0 = artifact.bundle.folds.find((fold) => fold.foldId === 0)!;
    const fold1 = artifact.bundle.folds.find((fold) => fold.foldId === 1)!;
    expect(fold0).toMatchObject({
      trainingInferenceClusterIds: ['phase16-viewer-cluster-1'],
      holdoutInferenceClusterIds: ['phase16-viewer-cluster-0'],
      trainingDecisionIds: source.decisions.slice(2).map((decision) => decision.decisionId),
      holdoutDecisionIds: source.decisions.slice(0, 2).map((decision) => decision.decisionId),
    });
    expect(fold1).toMatchObject({
      trainingInferenceClusterIds: ['phase16-viewer-cluster-0'],
      holdoutInferenceClusterIds: ['phase16-viewer-cluster-1'],
      trainingDecisionIds: source.decisions.slice(0, 2).map((decision) => decision.decisionId),
      holdoutDecisionIds: source.decisions.slice(2).map((decision) => decision.decisionId),
    });
    expect(fold0.featureKeys).toContain('source:phase16-cluster-1-only');
    expect(fold0.featureKeys).not.toContain('source:phase16-cluster-0-only');
    expect(fold1.featureKeys).toContain('source:phase16-cluster-0-only');
    expect(fold1.featureKeys).not.toContain('source:phase16-cluster-1-only');

    expect(isVerifiedCrossFittedCohortPredictionSetV3(predictionSet)).toBe(true);
    expect(isVerifiedCrossFittedCohortPredictionSetV3(structuredClone(predictionSet))).toBe(false);
    expect(predictionSet.manifest).toEqual(artifact.manifest);
    expect(predictionSet.holdoutPlan).toEqual(artifact.holdoutPlan);
    expect(predictionSet.receipt).toMatchObject({
      predictionSetVersion: artifact.manifest.predictionSetVersion,
      modelBundleSha256: artifact.bundle.modelBundleSha256,
      predictionStreamSha256: artifact.manifest.predictionStreamSha256,
      holdoutPlanSha256: artifact.holdoutPlan.holdoutPlanSha256,
      decisionCount: 4,
      viewerClusterCount: 2,
      stepCount: 8,
      predictionCount: 20,
      trainingRowCount: 20,
      combinedSpoolRecordCount: artifact.diagnostics.combinedSpoolRecordCount,
      combinedSpoolByteCount: artifact.diagnostics.combinedSpoolByteCount,
      workModelVersion: artifact.diagnostics.workModelVersion,
      producerAndVerifierMathWorkUnits:
        artifact.diagnostics.producerAndVerifierMathWorkUnits,
      targetEvidenceReplayPasses: artifact.diagnostics.targetEvidenceReplayPasses,
      targetEvidenceReplayRecords: artifact.diagnostics.targetEvidenceReplayRecords,
      snapshotEvidenceReplayPasses: artifact.diagnostics.snapshotEvidenceReplayPasses,
      snapshotEvidenceReplayRecords: artifact.diagnostics.snapshotEvidenceReplayRecords,
      trainingSpoolReplayPasses: artifact.diagnostics.trainingSpoolReplayPasses,
      trainingSpoolReplayRows: artifact.diagnostics.trainingSpoolReplayRows,
      verificationPredictionStreamReadRows:
        artifact.diagnostics.verificationPredictionStreamReadRows,
      verificationPredictionStreamComparisonRows:
        artifact.diagnostics.verificationPredictionStreamComparisonRows,
    });

    const opened = await openVerifiedCohortPredictionCursorV3(predictionSet);
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;
    try {
      for (const [decisionIndex, decision] of source.decisions.entries()) {
        for (const servedPosition of [1, 2]) {
          const read = await readVerifiedCohortPredictionStepV3(opened.cursor, {
            decisionId: decision.decisionId,
            servedPosition,
          });
          expect(read.status).toBe('verified');
          if (read.status !== 'verified') return;
          expect(isVerifiedCohortPredictionStepV3(read.step)).toBe(true);
          expect(read.step).toMatchObject({
            decisionId: decision.decisionId,
            requestId: decision.requestId,
            inferenceClusterId: decisionIndex < 2
              ? 'phase16-viewer-cluster-0'
              : 'phase16-viewer-cluster-1',
            foldId: decisionIndex < 2 ? 0 : 1,
            servedPosition,
          });
          expect(read.step.qHat).toHaveLength(servedPosition === 1 ? 3 : 2);
          expect(read.step.qHat.every((entry) => Number.isFinite(entry.value))).toBe(true);
        }
      }
    } finally {
      await closeVerifiedCohortPredictionCursorV3(opened.cursor);
    }
  }, 15_000);

  it('retains verifier-owned canonical prediction bytes after the supplied source is gone', async () => {
    const { input, artifact } = await producedPhase16Cohort();
    let opens = 0;
    const oneShotPredictionStream = () => {
      opens += 1;
      if (opens !== 1) throw new Error('caller-owned stream reopened');
      return artifact.predictionStream();
    };
    const verified = await verifyCrossFittedCohortPredictionSetV3({
      ...input,
      modelBundleRaw: artifact.modelBundleRaw,
      predictionSetManifestRaw: artifact.predictionSetManifestRaw,
      predictionStream: oneShotPredictionStream,
    });
    expect(verified.status).toBe('verified');
    if (verified.status !== 'verified') return;
    expect(opens).toBe(1);
    await artifact.dispose();

    const opened = await openVerifiedCohortPredictionCursorV3(verified.predictionSet);
    expect(opened.status).toBe('opened');
    if (opened.status === 'opened') await closeVerifiedCohortPredictionCursorV3(opened.cursor);
    expect(opens).toBe(1);
  }, 15_000);

  it('fails closed for tamper, plain clones, hostile input, and resource excess', async () => {
    const { input, artifact } = await producedPhase16Cohort();
    const tamperedBundle = structuredClone(artifact.bundle);
    tamperedBundle.folds[0]!.heads[0]!.intercept += 0.001;
    expect(await verifyCrossFittedCohortPredictionSetV3({
      ...input,
      modelBundleRaw: `${canonicalWireJsonV1(tamperedBundle)}\n`,
      predictionSetManifestRaw: artifact.predictionSetManifestRaw,
      predictionStream: artifact.predictionStream,
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'prediction_v3_retraining_mismatch',
    });

    const tamperedRecords = await streamRecords(artifact.predictionStream);
    const prediction = tamperedRecords.find((record) => record.recordType === 'prediction')!;
    prediction.qHat += 0.001;
    expect(await verifyCrossFittedCohortPredictionSetV3({
      ...input,
      modelBundleRaw: artifact.modelBundleRaw,
      predictionSetManifestRaw: artifact.predictionSetManifestRaw,
      predictionStream: stream(canonicalNdjsonV1(tamperedRecords), 23),
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'prediction_v3_stream_mismatch',
    });

    expect(await produceCrossFittedCohortPredictionSetV3({
      ...input,
      targetEvidence: structuredClone(input.targetEvidence),
    })).toEqual({ status: 'not_evaluable', blocker: 'target_verified_brand_missing' });
    expect(await produceCrossFittedCohortPredictionSetV3({
      ...input,
      decisions: Array.from(
        { length: PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions + 1 },
        (_, index) => input.decisions[index % input.decisions.length],
      ),
    })).toEqual({ status: 'not_evaluable', blocker: 'resource_limit_exceeded' });

    const iteratorHostileDecisions = new Proxy(Array.from(
      { length: PREDICTION_V3_RESOURCE_LIMITS.maximumDecisions + 1 },
      (_, index) => input.decisions[index % input.decisions.length],
    ), {
      get: (target, property, receiver) => {
        if (property === Symbol.iterator) throw new Error('iterator must not run');
        return Reflect.get(target, property, receiver);
      },
    });
    expect(await produceCrossFittedCohortPredictionSetV3({
      ...input,
      decisions: iteratorHostileDecisions,
    })).toEqual({ status: 'not_evaluable', blocker: 'resource_limit_exceeded' });

    const hostile = new Proxy({}, {
      get: () => { throw new Error('hostile getter'); },
      ownKeys: () => { throw new Error('hostile ownKeys'); },
    });
    await expect(produceCrossFittedCohortPredictionSetV3(hostile)).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'prediction_v3_input_contract_invalid',
    });
    expect(() => isVerifiedCrossFittedCohortPredictionSetV3(hostile)).not.toThrow();
    expect(isVerifiedCrossFittedCohortPredictionSetV3(hostile)).toBe(false);
    expect(() => isVerifiedCohortPredictionStepV3(hostile)).not.toThrow();
    expect(isVerifiedCohortPredictionStepV3(hostile)).toBe(false);

    for (const predictionStream of [
      () => { throw new Error('resource_limit_exceeded'); },
      () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => { throw new Error('prediction_v3_retraining_mismatch'); },
        }),
      }),
      () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({
            done: false,
            value: {
              then: (_resolve: unknown, reject: (error: Error) => void) => {
                reject(new Error('resource_limit_exceeded'));
              },
            },
          }),
        }),
      }) as unknown as AsyncIterable<string | Uint8Array>,
    ]) {
      expect(await verifyCrossFittedCohortPredictionSetV3({
        ...input,
        modelBundleRaw: artifact.modelBundleRaw,
        predictionSetManifestRaw: artifact.predictionSetManifestRaw,
        predictionStream,
      })).toEqual({
        status: 'not_evaluable',
        blocker: 'prediction_v3_stream_mismatch',
      });
    }

    const mismatchedViewer = await phase16PredictionInput((decisionIndex) => (
      decisionIndex === 0
        ? 'phase16-viewer-b'
        : decisionIndex < 2 ? 'phase16-viewer-a' : 'phase16-viewer-b'
    ));
    expect(await produceCrossFittedCohortPredictionSetV3(mismatchedViewer.input)).toEqual({
      status: 'not_evaluable',
      blocker: 'prediction_v3_viewer_identity_mismatch',
    });
  }, 15_000);

  it('rejects zero-byte stream chunks before they can bypass resource counters', async () => {
    const fixture = JSON.parse(
      await readFile(fixturePath, 'utf8'),
    ) as Phase16TargetFixtureDocument;
    const emptyThenData = (raw: string) => async function* () {
      yield new Uint8Array(0);
      yield Buffer.from(raw);
    };
    await expect(verifyTargetDistributionStreamV2({
      trustScope: 'synthetic_fixture',
      sourceDecisionStream: emptyThenData(fixture.sourceDecisionNdjson),
      distributionStream: stream(fixture.expectedDistributionNdjson),
      sourceDatasetManifestRaw: fixture.sourceDatasetManifestRaw,
      policyConfigRaw: fixture.policyConfigRaw,
      targetManifestRaw: fixture.expectedTargetManifestRaw,
      verificationReceiptRaw: `${canonicalWireJsonV1(fixture.expectedReceipt)}\n`,
    })).resolves.toEqual({ status: 'not_evaluable', blocker: 'target_contract_invalid' });

    const consumeSpool = async () => {
      for await (const _record of readCanonicalSpoolRecordsV2(emptyThenData('{}\n'))) {
        // Consume the stream so the reader reaches the hostile chunk.
      }
    };
    await expect(consumeSpool()).rejects.toThrow('prediction_spool_contract_invalid');

    let fragmentedTailTouched = false;
    const fragmentedTail = new Proxy({ length: 1 }, {
      get: (_target, property) => {
        if (property === 'then') return undefined;
        fragmentedTailTouched = true;
        throw new Error('fragmented tail must not be copied');
      },
    });
    const consumeOverFragmentedSpool = async () => {
      for await (const _record of readCanonicalSpoolRecordsV2(async function* () {
        yield Buffer.from('{');
        yield Buffer.from('}');
        yield fragmentedTail as unknown as Uint8Array;
      }, { maxLineBytes: 8, maxFileBytes: 8, maxRecords: 1 })) {
        // The chunk-work cap must fail before touching the third chunk payload.
      }
    };
    await expect(consumeOverFragmentedSpool()).rejects.toThrow(
      'prediction_spool_resource_limit_exceeded',
    );
    expect(fragmentedTailTouched).toBe(false);

    const source = await phase16TargetFixture();
    const snapshotInput = phase16SnapshotInput(source);
    const validSnapshotStream = snapshotInput.snapshotStream;
    await expect(verifyFullSupportPitActionSnapshotV2({
      ...snapshotInput,
      snapshotStream: async function* () {
        yield new Uint8Array(0);
        yield* validSnapshotStream();
      },
    })).resolves.toEqual({ status: 'not_evaluable', blocker: 'snapshot_contract_invalid' });

    expect(copyBoundedByteStreamChunkV1(new Uint8Array(2), 1)).toEqual({
      status: 'resource_limit_exceeded',
    });
    const hostileArrayLike = new Proxy({ length: 1 }, {
      get: () => { throw new Error('array-like coercion must not run'); },
    });
    expect(() => copyBoundedByteStreamChunkV1(hostileArrayLike, 1)).not.toThrow();
    expect(copyBoundedByteStreamChunkV1(hostileArrayLike, 1)).toEqual({ status: 'invalid' });
  });

  it('emits only the same-process diagnostics handoff and preserves blockers', async () => {
    const { input, predictionSet } = await verifiedPhase16Cohort();
    const phase15Handoff = Object.freeze({
      handoffSha256: '6'.repeat(64),
      candidateSelectionStatus: 'no_candidate_selected' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
    });
    phase15Handoffs.add(phase15Handoff);
    const built = buildPhase16SameProcessNoCandidateHandoffV1({
      phase15Handoff,
      holdoutPlan: predictionSet.holdoutPlan,
      predictionSet,
    });
    expect(built.status).toBe('verified');
    if (built.status !== 'verified') return;
    expect(built.handoff).toMatchObject({
      contractVersion: 'phase16_same_process_offline_diagnostic_handoff_v1',
      handoffScope: 'same_process_offline_diagnostic_v1',
      developmentStatus: 'completed_viewer_cluster_cross_fit_no_candidate_selected',
      sameViewerLeakageExcluded: true,
      independentViewerClustersVerified: false,
      timeClusterProvenancePresent: false,
      multiwayCrossFitReady: false,
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      selectedMethod: 'diagnostics_only_abstention_v1',
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
      sealedQualificationStatus: 'not_ready',
      nextPhaseHandoff: 'no_candidate_selected',
      phase15HandoffSha256: phase15Handoff.handoffSha256,
      holdoutPlanSha256: predictionSet.holdoutPlan.holdoutPlanSha256,
      predictionSetVersion: predictionSet.receipt.predictionSetVersion,
      predictionVerificationReceiptSha256: predictionSet.receipt.receiptSha256,
      blockers: PHASE16_HANDOFF_BLOCKERS_V1,
    });
    expect(isVerifiedPhase16SameProcessNoCandidateHandoffV1(built.handoff)).toBe(true);
    expect(isVerifiedPhase16SameProcessNoCandidateHandoffV1(
      structuredClone(built.handoff),
    )).toBe(false);

    const separatePlan = buildViewerClusterHoldoutPlanV1({
      decisionContextEvidence: input.decisionContextEvidence,
    });
    expect(separatePlan.status).toBe('verified');
    if (separatePlan.status !== 'verified') return;
    expect(buildPhase16SameProcessNoCandidateHandoffV1({
      phase15Handoff,
      holdoutPlan: separatePlan.plan,
      predictionSet,
    })).toEqual({ status: 'not_evaluable', blocker: 'phase16_handoff_binding_mismatch' });
    for (const unverified of [
      { phase15Handoff: structuredClone(phase15Handoff),
        holdoutPlan: predictionSet.holdoutPlan, predictionSet },
      { phase15Handoff, holdoutPlan: structuredClone(predictionSet.holdoutPlan), predictionSet },
      { phase15Handoff, holdoutPlan: predictionSet.holdoutPlan,
        predictionSet: structuredClone(predictionSet) },
    ]) {
      expect(buildPhase16SameProcessNoCandidateHandoffV1(unverified)).toEqual({
        status: 'not_evaluable',
        blocker: 'phase16_handoff_source_unverified',
      });
    }
    const hostile = new Proxy({}, {
      get: () => { throw new Error('hostile getter'); },
    });
    expect(() => buildPhase16SameProcessNoCandidateHandoffV1(hostile)).not.toThrow();
    expect(buildPhase16SameProcessNoCandidateHandoffV1(hostile)).toEqual({
      status: 'not_evaluable',
      blocker: 'phase16_handoff_source_unverified',
    });
    for (const forbidden of [
      'seed', 'root', 'ledger', 'qualificationMethod', 'methodConfig', 'candidate', 'qHat',
    ]) {
      expect(forbidden in built.handoff).toBe(false);
    }
  }, 15_000);

  it('maps Prediction V3 cohort DR contributions to synthetic viewer clusters only', async () => {
    const { input, predictionSet } = await verifiedPhase16Cohort();
    const trajectory = await verifySyntheticCohortTrajectoryEvidenceV1(predictionSet);
    expect(trajectory.status).toBe('verified');
    if (trajectory.status !== 'verified') return;
    expect(isVerifiedSyntheticCohortTrajectoryEvidenceV1(trajectory.evidence)).toBe(true);
    expect(trajectory.evidence).toMatchObject({
      expectedDecisionCount: 4,
      expectedViewerClusterCount: 2,
      expectedStepCount: 8,
      expectedPredictionCount: 20,
      sourceClusterUnitVersion: 'viewer_account_pseudonym_v1',
      viewerClusterCrossFitProvenancePresent: true,
      commonTimeShockHandlingVerified: false,
      multiwayClusterProvenancePresent: false,
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
    });

    const expectedDr: Array<{
      decisionId: string;
      servedPosition: number;
      prefixWeight: number;
      weight: number;
      drContribution: number;
    }> = [];
    const manualPrefixWeights = new Map<string, number>();
    const replay = await replayVerifiedSyntheticCohortTrajectoryEvidenceV1(
      trajectory.evidence,
      {
        onStep: (step) => {
          const prefixWeight = manualPrefixWeights.get(step.decisionId) ?? 1;
          const loggedId = canonicalJsonV1(step.loggedActionKey);
          const qHat = new Map(step.qHat.map((entry) => [
            canonicalJsonV1(entry.actionKey), entry.value,
          ]));
          const targetProbability = step.targetDistribution.find((entry) => (
            canonicalJsonV1(entry.actionKey) === loggedId
          ))!.probability;
          const weight = prefixWeight * targetProbability / step.behaviorProbability;
          const targetTerm = prefixWeight * step.targetDistribution.reduce((sum, entry) => (
            sum + entry.probability * qHat.get(canonicalJsonV1(entry.actionKey))!
          ), 0);
          const drContribution = targetTerm + weight * (step.reward - qHat.get(loggedId)!);
          expectedDr.push({
            decisionId: step.decisionId,
            servedPosition: step.servedPosition,
            prefixWeight,
            weight,
            drContribution,
          });
          manualPrefixWeights.set(step.decisionId, weight);
        },
        commit: () => undefined,
        abort: () => undefined,
      },
    );
    expect(replay).toEqual({ status: 'verified' });

    const evaluated = await evaluateSyntheticCohortOpeV4(trajectory.evidence);
    expect(evaluated.status).toBe('verified');
    if (evaluated.status !== 'verified') return;
    expect(isVerifiedOpeAggregateReceiptV4(evaluated.receipt)).toBe(true);
    expect(evaluated.contributions).toHaveLength(8);
    expect(evaluated.contributions.every((entry) => (
      isOpeSlotContributionBoundToReceiptV4(entry, evaluated.receipt)
    ))).toBe(true);

    for (const [index, contribution] of evaluated.contributions.entries()) {
      const expected = expectedDr[index]!;
      expect(contribution).toMatchObject({
        decisionId: expected.decisionId,
        servedPosition: expected.servedPosition,
      });
      expect(contribution.prefixWeight).toBeCloseTo(expected.prefixWeight, 14);
      expect(contribution.weight).toBeCloseTo(expected.weight, 14);
      expect(contribution.drContribution).toBeCloseTo(expected.drContribution, 14);
    }

    const mapping = buildPhase17SyntheticViewerClusterMappingAuditV1({
      receipt: evaluated.receipt,
      contributions: evaluated.contributions,
    });
    expect(mapping.status).toBe('verified');
    if (mapping.status !== 'verified') return;
    expect(isVerifiedPhase17SyntheticViewerClusterMappingAuditV1(mapping.audit)).toBe(true);
    const expectedRows = [...evaluated.contributions.reduce((grouped, contribution) => {
      const clusterId = contribution.binding.inferenceClusterId;
      const current = grouped.get(clusterId) ?? {
        inferenceClusterId: clusterId,
        y: 0,
        a: 0,
        importanceMass: 0,
      };
      grouped.set(clusterId, {
        inferenceClusterId: clusterId,
        y: current.y + contribution.drContribution,
        a: current.a + 1,
        importanceMass: current.importanceMass + contribution.weight,
      });
      return grouped;
    }, new Map<string, { inferenceClusterId: string; y: number; a: number;
      importanceMass: number }>() ).values()].sort((left, right) => Buffer.compare(
      Buffer.from(left.inferenceClusterId), Buffer.from(right.inferenceClusterId),
    ));
    expect(mapping.audit.clusterRows).toEqual(expectedRows);
    expect(mapping.audit).toMatchObject({
      mappingStatus: 'verified_synthetic_viewer_cluster_mapping_only',
      viewerClusterCrossFitProvenancePresent: true,
      independentViewerClustersVerified: false,
      commonTimeShockHandlingVerified: false,
      multiwayClusterProvenancePresent: false,
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
    });
    expect(buildPhase17SyntheticViewerClusterMappingAuditV1({
      receipt: evaluated.receipt,
      contributions: [...evaluated.contributions].reverse(),
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_mapping_contribution_chain_mismatch',
    });
    expect(buildPhase17SyntheticViewerClusterMappingAuditV1({
      receipt: evaluated.receipt,
      contributions: evaluated.contributions.slice(0, -1),
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_mapping_incomplete_cohort',
    });
    expect(buildPhase17SyntheticViewerClusterMappingAuditV1({
      receipt: evaluated.receipt,
      contributions: [...evaluated.contributions.slice(0, -1), evaluated.contributions[0]!],
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_mapping_contribution_chain_mismatch',
    });
    expect(buildPhase17SyntheticViewerClusterMappingAuditV1({
      receipt: evaluated.receipt,
      contributions: [structuredClone(evaluated.contributions[0]!),
        ...evaluated.contributions.slice(1)],
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_mapping_source_unverified',
    });
    let oversizedElementRead = false;
    const oversized = new Proxy(Array.from({ length: 257 }, () => evaluated.contributions[0]!), {
      get: (target, property, receiver) => {
        if (typeof property === 'string' && /^\d+$/.test(property)) oversizedElementRead = true;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(buildPhase17SyntheticViewerClusterMappingAuditV1({
      receipt: evaluated.receipt,
      contributions: oversized,
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_mapping_resource_limit_exceeded',
    });
    expect(oversizedElementRead).toBe(false);

    const phase15Handoff = Object.freeze({
      handoffSha256: '6'.repeat(64),
      candidateSelectionStatus: 'no_candidate_selected' as const,
      selectedMethod: 'diagnostics_only_abstention_v1' as const,
    });
    phase15Handoffs.add(phase15Handoff);
    const phase16 = buildPhase16SameProcessNoCandidateHandoffV1({
      phase15Handoff,
      holdoutPlan: predictionSet.holdoutPlan,
      predictionSet,
    });
    expect(phase16.status).toBe('verified');
    if (phase16.status !== 'verified') return;
    const handoff = buildPhase17SameProcessNoCandidateHandoffV1({
      phase16Handoff: phase16.handoff,
      mappingAudit: mapping.audit,
    });
    expect(handoff.status).toBe('verified');
    if (handoff.status !== 'verified') return;
    expect(isVerifiedPhase17SameProcessNoCandidateHandoffV1(handoff.handoff)).toBe(true);
    expect(handoff.handoff).toMatchObject({
      handoffScope: 'same_process_offline_diagnostic_v1',
      developmentStatus: 'completed_viewer_cluster_mapping_no_candidate_selected',
      clusterStatisticMappingStatus: 'synthetic_viewer_cluster_mapping_verified',
      viewerClusterStatisticReadiness: 'synthetic_only',
      viewerClusterCrossFitProvenancePresent: true,
      independentViewerClustersVerified: false,
      commonTimeShockHandlingVerified: false,
      multiwayClusterProvenancePresent: false,
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      selectedMethod: 'diagnostics_only_abstention_v1',
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
      sealedQualificationStatus: 'not_ready',
      nextPhaseHandoff: 'no_candidate_selected',
      blockers: PHASE17_HANDOFF_BLOCKERS_V1,
    });
    const provenance = buildPhase18SyntheticViewerTimeProvenanceV1({
      phase17Handoff: handoff.handoff,
      mappingAudit: mapping.audit,
      trajectoryEvidence: trajectory.evidence,
    });
    expect(provenance.status).toBe('verified');
    if (provenance.status !== 'verified') return;
    expect(isVerifiedPhase18SyntheticViewerTimeProvenanceV1(provenance.provenance)).toBe(true);
    expect(provenance.provenance).toMatchObject({
      syntheticSourceVersion: 'phase16_fixed_crossed_viewer_time_fixture_v1',
      syntheticTimeMembershipStatus: 'verified_synthetic_partition_only',
      syntheticViewerTimeMembershipPresent: true,
      completeCrossedGrid: true,
      commonTimeShockHandlingVerified: false,
      realMultiwayClusterProvenancePresent: false,
      multiwayTrainingEvidencePresent: false,
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
    });
    expect(provenance.provenance.memberships.map((entry) => [
      entry.decisionId,
      entry.viewerClusterId,
      entry.timeClusterId,
    ])).toEqual([
      ['00000000-0000-4000-8000-000000000001', 'phase16-viewer-cluster-0',
        'phase18-synthetic-time-0'],
      ['00000000-0000-4000-8000-000000000002', 'phase16-viewer-cluster-0',
        'phase18-synthetic-time-1'],
      ['00000000-0000-4000-8000-000000000003', 'phase16-viewer-cluster-1',
        'phase18-synthetic-time-0'],
      ['00000000-0000-4000-8000-000000000004', 'phase16-viewer-cluster-1',
        'phase18-synthetic-time-1'],
    ]);
    const multiwayPlan = buildPhase18MultiwayHoldoutPlanAuditV1({
      provenance: provenance.provenance,
    });
    expect(multiwayPlan.status).toBe('verified');
    if (multiwayPlan.status !== 'verified') return;
    expect(isVerifiedPhase18MultiwayHoldoutPlanAuditV1(multiwayPlan.audit)).toBe(true);
    expect(multiwayPlan.audit).toMatchObject({
      auditStatus: 'verified_plan_only',
      unionExclusionVerified: true,
      sameViewerLeakageExcludedInPlan: true,
      sameTimeLeakageExcludedInPlan: true,
      trainingApplied: false,
      multiwayQHatProvenanceStatus: 'plan_only_not_verified',
      dgpV2LaunchReadiness: 'not_ready',
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
    });
    expect(multiwayPlan.audit.cells.map((cell) => ({
      viewerClusterId: cell.viewerClusterId,
      timeClusterId: cell.timeClusterId,
      evaluationDecisionIds: cell.evaluationDecisionIds,
      trainingDecisionIds: cell.trainingDecisionIds,
      guardBandDecisionIds: cell.guardBandDecisionIds,
    }))).toEqual([
      {
        viewerClusterId: 'phase16-viewer-cluster-0',
        timeClusterId: 'phase18-synthetic-time-0',
        evaluationDecisionIds: ['00000000-0000-4000-8000-000000000001'],
        trainingDecisionIds: ['00000000-0000-4000-8000-000000000004'],
        guardBandDecisionIds: [
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000003',
        ],
      },
      {
        viewerClusterId: 'phase16-viewer-cluster-0',
        timeClusterId: 'phase18-synthetic-time-1',
        evaluationDecisionIds: ['00000000-0000-4000-8000-000000000002'],
        trainingDecisionIds: ['00000000-0000-4000-8000-000000000003'],
        guardBandDecisionIds: [
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000004',
        ],
      },
      {
        viewerClusterId: 'phase16-viewer-cluster-1',
        timeClusterId: 'phase18-synthetic-time-0',
        evaluationDecisionIds: ['00000000-0000-4000-8000-000000000003'],
        trainingDecisionIds: ['00000000-0000-4000-8000-000000000002'],
        guardBandDecisionIds: [
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000004',
        ],
      },
      {
        viewerClusterId: 'phase16-viewer-cluster-1',
        timeClusterId: 'phase18-synthetic-time-1',
        evaluationDecisionIds: ['00000000-0000-4000-8000-000000000004'],
        trainingDecisionIds: ['00000000-0000-4000-8000-000000000001'],
        guardBandDecisionIds: [
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000003',
        ],
      },
    ]);
    const phase18 = buildPhase18SameProcessNoCandidateHandoffV1({
      phase17Handoff: handoff.handoff,
      provenance: provenance.provenance,
      plan: multiwayPlan.audit,
    });
    expect(phase18.status).toBe('verified');
    if (phase18.status !== 'verified') return;
    expect(isVerifiedPhase18SameProcessNoCandidateHandoffV1(phase18.handoff)).toBe(true);
    expect(phase18.handoff).toMatchObject({
      handoffScope: 'same_process_offline_diagnostic_v1',
      developmentStatus: 'completed_multiway_holdout_plan_no_candidate_selected',
      syntheticViewerTimeMembershipStatus: 'verified_synthetic_partition_only',
      multiwayHoldoutPlanStatus: 'verified_plan_only',
      viewerTimeStatisticReadiness: 'not_ready',
      multiwayQHatProvenanceStatus: 'plan_only_not_verified',
      dgpV2LaunchReadiness: 'not_ready',
      commonTimeShockHandlingVerified: false,
      realMultiwayClusterProvenancePresent: false,
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      selectedMethod: 'diagnostics_only_abstention_v1',
      qualificationEvidenceEligible: false,
      candidateEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
      sealedQualificationStatus: 'not_ready',
      nextPhaseHandoff: 'multiway_qhat_evidence_incomplete',
      blockers: PHASE18_HANDOFF_BLOCKERS_V1,
    });

    const phase19Input = {
      predictionSet,
      snapshot: input.snapshot,
      rewardDefinition,
      provenance: provenance.provenance,
      plan: multiwayPlan.audit,
    };
    const producedPhase19 = await produceMultiwayPredictionSetV4(phase19Input);
    expect(producedPhase19.status === 'not_evaluable'
      ? producedPhase19.blocker
      : undefined).toBeUndefined();
    expect(producedPhase19).toMatchObject({ status: 'produced' });
    if (producedPhase19.status !== 'produced') return;
    const phase19Artifact = producedPhase19.artifact;
    disposers.push(phase19Artifact.dispose);
    expect(phase19Artifact.diagnostics).toMatchObject({
      preflightCompletedBeforeSpoolAndTraining: true,
      evaluationCellCount: 4,
      supportActionRowCount: 20,
      labelRowCount: 8,
      producerAndVerifierTrainingSpoolReplayPasses: 8,
      producerAndVerifierTrainingSpoolReplayRows: 160,
      verificationPredictionStreamReadRows: 88,
      verificationPredictionStreamComparisonRows: 44,
    });
    expect(phase19Artifact.bundle).toMatchObject({
      sourcePredictionSetVersion: predictionSet.manifest.predictionSetVersion,
      sourcePredictionVerificationReceiptSha256: predictionSet.receipt.receiptSha256,
      viewerHoldoutPlanSha256: predictionSet.holdoutPlan.holdoutPlanSha256,
      phase18ProvenanceSha256: provenance.provenance.provenanceSha256,
      phase18PlanSha256: multiwayPlan.audit.planSha256,
      viewerMembershipSha256: multiwayPlan.audit.viewerMembershipSha256,
      timeMembershipSha256: multiwayPlan.audit.timeMembershipSha256,
      snapshotManifestSha256: predictionSet.receipt.snapshotManifestSha256,
      rewardDefinitionSha256: predictionSet.receipt.rewardDefinitionSha256,
      trainingApplied: true,
      trainingEvidenceScope: 'mechanical_training_e2e_only',
      multiwayQHatProvenanceStatus: 'verified_synthetic_only',
      commonTimeShockHandlingVerified: false,
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
    });
    const memberships = new Map(provenance.provenance.memberships.map((entry) => [
      entry.decisionId,
      entry,
    ]));
    for (const modelCell of phase19Artifact.bundle.cells) {
      const plannedCell = multiwayPlan.audit.cells.find((cell) => (
        cell.cellSha256 === modelCell.cellSha256
      ));
      expect(plannedCell).toBeDefined();
      expect(modelCell).toMatchObject({
        evaluationDecisionIds: plannedCell!.evaluationDecisionIds,
        trainingDecisionIds: plannedCell!.trainingDecisionIds,
        guardBandDecisionIds: plannedCell!.guardBandDecisionIds,
        excludedDecisionIds: plannedCell!.excludedDecisionIds,
        sameViewerLeakageExcludedInTraining: true,
        sameTimeLeakageExcludedInTraining: true,
        guardBandExcludedFromTraining: true,
      });
      expect(modelCell.trainingRowKeys).toHaveLength(2);
      expect(modelCell.trainingDecisionIds.every((decisionId) => {
        const member = memberships.get(decisionId)!;
        return member.viewerClusterId !== modelCell.viewerClusterId
          && member.timeClusterId !== modelCell.timeClusterId
          && !modelCell.evaluationDecisionIds.includes(decisionId)
          && !modelCell.guardBandDecisionIds.includes(decisionId);
      })).toBe(true);
    }
    expect(phase19Artifact.bundle.cells.some((cell) => cell.heads.some((head) => (
      head.intercept !== 0 || head.coefficients.some((coefficient) => coefficient.value !== 0)
    )))).toBe(true);
    const phase19Records = await streamRecords(phase19Artifact.predictionStream);
    const decisionBindings = new Map(phase19Records
      .filter((record) => record.recordType === 'decision_start')
      .map((record) => [record.decisionId, record]));
    expect(decisionBindings.size).toBe(4);
    for (const record of phase19Records.filter((entry) => entry.recordType === 'prediction')) {
      const decision = decisionBindings.get(record.decisionId)!;
      expect(record).toMatchObject({
        viewerClusterId: decision.inferenceClusterId,
        timeClusterId: decision.timeClusterId,
        cellSha256: decision.cellSha256,
        modelCellSha256: decision.modelCellSha256,
      });
    }
    const verifiedPhase19 = await verifyMultiwayPredictionSetV4({
      ...phase19Input,
      modelBundleRaw: phase19Artifact.modelBundleRaw,
      predictionSetManifestRaw: phase19Artifact.predictionSetManifestRaw,
      predictionStream: phase19Artifact.predictionStream,
    });
    expect(verifiedPhase19.status).toBe('verified');
    if (verifiedPhase19.status !== 'verified') return;
    expect(isVerifiedMultiwayPredictionSetV4(verifiedPhase19.predictionSet)).toBe(true);
    expect(isVerifiedMultiwayPredictionSetV4(
      structuredClone(verifiedPhase19.predictionSet),
    )).toBe(false);
    expect(verifiedPhase19.predictionSet.receipt).toMatchObject({
      predictionSetVersion: phase19Artifact.manifest.predictionSetVersion,
      modelBundleSha256: phase19Artifact.bundle.modelBundleSha256,
      predictionStreamSha256: phase19Artifact.manifest.predictionStreamSha256,
      sourcePredictionSetVersion: predictionSet.manifest.predictionSetVersion,
      sourcePredictionVerificationReceiptSha256: predictionSet.receipt.receiptSha256,
      phase18ProvenanceSha256: provenance.provenance.provenanceSha256,
      phase18PlanSha256: multiwayPlan.audit.planSha256,
      viewerMembershipSha256: multiwayPlan.audit.viewerMembershipSha256,
      timeMembershipSha256: multiwayPlan.audit.timeMembershipSha256,
      trainingApplied: true,
      trainingEvidenceScope: 'mechanical_training_e2e_only',
      commonTimeShockHandlingVerified: false,
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
    });
    const phase19Handoff = buildPhase19SameProcessNoCandidateHandoffV1({
      phase18Handoff: phase18.handoff,
      predictionSet: verifiedPhase19.predictionSet,
    });
    expect(phase19Handoff.status).toBe('verified');
    if (phase19Handoff.status !== 'verified') return;
    expect(isVerifiedPhase19SameProcessNoCandidateHandoffV1(
      phase19Handoff.handoff,
    )).toBe(true);
    expect(phase19Handoff.handoff).toMatchObject({
      handoffScope: 'same_process_offline_diagnostic_v1',
      developmentStatus: 'completed_multiway_qhat_retraining_no_candidate_selected',
      multiwayQHatProvenanceStatus: 'verified_synthetic_only',
      trainingApplied: true,
      trainingEvidenceScope: 'mechanical_training_e2e_only',
      dgpV2LaunchReadiness: 'ready_for_frozen_design',
      nextPhaseHandoff: 'ready_to_design_frozen_dgp_v2',
      commonTimeShockHandlingVerified: false,
      researchCandidateMethod: null,
      candidateSelectionStatus: 'no_candidate_selected',
      candidateQualificationStatus: 'not_run',
      candidateApplicabilityStatus: 'not_assessed_no_candidate_selected',
      selectedMethod: 'diagnostics_only_abstention_v1',
      qualificationEvidenceEligible: false,
      candidateEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
      sealedQualificationStatus: 'not_ready',
      phase18HandoffSha256: phase18.handoff.handoffSha256,
      predictionV4VerificationReceiptSha256:
        verifiedPhase19.predictionSet.receipt.receiptSha256,
      blockers: PHASE19_HANDOFF_BLOCKERS_V1,
    });
    expect(isVerifiedPhase19SameProcessNoCandidateHandoffV1(
      structuredClone(phase19Handoff.handoff),
    )).toBe(false);
    let laterHandoffSourceRead = false;
    const shortCircuitHandoffInput = Object.defineProperties({}, {
      phase18Handoff: { get: () => ({}) },
      predictionSet: {
        get: () => {
          laterHandoffSourceRead = true;
          throw new Error('must not read later handoff source');
        },
      },
    });
    expect(buildPhase19SameProcessNoCandidateHandoffV1(
      shortCircuitHandoffInput,
    )).toEqual({
      status: 'not_evaluable',
      blocker: 'phase19_handoff_source_unverified',
    });
    expect(laterHandoffSourceRead).toBe(false);

    for (const records of [
      phase19Records.map((record, index) => index === 2
        ? { ...record, qHat: record.qHat + 0.001 }
        : record),
      [phase19Records[1]!, phase19Records[0]!, ...phase19Records.slice(2)],
      phase19Records.slice(0, -1),
    ]) {
      expect(await verifyMultiwayPredictionSetV4({
        ...phase19Input,
        modelBundleRaw: phase19Artifact.modelBundleRaw,
        predictionSetManifestRaw: phase19Artifact.predictionSetManifestRaw,
        predictionStream: stream(canonicalNdjsonV1(records), 4_096),
      })).toEqual({
        status: 'not_evaluable',
        blocker: 'prediction_v4_supplied_artifact_mismatch',
      });
    }
    for (const sourceClone of [
      { ...phase19Input, predictionSet: structuredClone(predictionSet) },
      { ...phase19Input, provenance: structuredClone(provenance.provenance) },
      { ...phase19Input, plan: structuredClone(multiwayPlan.audit) },
    ]) {
      expect(await produceMultiwayPredictionSetV4(sourceClone)).toEqual({
        status: 'not_evaluable',
        blocker: 'prediction_v4_source_unverified',
      });
    }
    let laterPredictionSourceRead = false;
    const shortCircuitPredictionInput = Object.defineProperties({}, {
      predictionSet: { get: () => ({}) },
      provenance: {
        get: () => {
          laterPredictionSourceRead = true;
          throw new Error('must not read later prediction source');
        },
      },
    });
    expect(await produceMultiwayPredictionSetV4(shortCircuitPredictionInput)).toEqual({
      status: 'not_evaluable',
      blocker: 'prediction_v4_source_unverified',
    });
    expect(laterPredictionSourceRead).toBe(false);
    let completedIteratorValueRead = false;
    expect(await verifyMultiwayPredictionSetV4({
      ...phase19Input,
      modelBundleRaw: phase19Artifact.modelBundleRaw,
      predictionSetManifestRaw: phase19Artifact.predictionSetManifestRaw,
      predictionStream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => Object.defineProperties({}, {
            done: { value: true },
            value: {
              get: () => {
                completedIteratorValueRead = true;
                throw new Error('completed iterator value must not be read');
              },
            },
          }) as IteratorResult<string | Uint8Array>,
        }),
      }),
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'prediction_v4_supplied_artifact_mismatch',
    });
    expect(completedIteratorValueRead).toBe(false);
    expect(await verifyMultiwayPredictionSetV4({
      ...phase19Input,
      modelBundleRaw: phase19Artifact.modelBundleRaw,
      predictionSetManifestRaw: phase19Artifact.predictionSetManifestRaw,
      predictionStream: stream(canonicalNdjsonV1(phase19Records), 1),
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'resource_limit_exceeded',
    });
    const hostilePhase19 = new Proxy({}, {
      get: () => { throw new Error('hostile phase19 getter'); },
    });
    await expect(produceMultiwayPredictionSetV4(hostilePhase19)).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'prediction_v4_source_unverified',
    });
    expect(() => isVerifiedMultiwayPredictionSetV4(hostilePhase19)).not.toThrow();
    expect(isVerifiedMultiwayPredictionSetV4(hostilePhase19)).toBe(false);
    expect(trajectory.evidence.trajectoryEvidenceSha256).toBe(
      '3851a49e2aa9a3fd9f30c3bf9e5bf5ad82a08f5361338d2860eea9d21febea4d',
    );
    expect(evaluated.receipt.receiptSha256).toBe(
      'a2919ba0d3547cbc79813c3ca6af956c6a3500d09c4e256719e1d81525b19b03',
    );
    expect(mapping.audit.mappingSha256).toBe(
      '1aa8e6cc0f7c2d8366f210de4666d127f78b863d6a1bedd2293d6d0454f8bcca',
    );
    expect(handoff.handoff.handoffSha256).toBe(
      '0efa97e7e37a8d7e8b199fb4e88885d43722d1818ec12d51aef80ba252dc16c2',
    );
    expect(provenance.provenance.sourceBindings.phase17MappingSha256).toBe(
      mapping.audit.mappingSha256,
    );
    expect(isVerifiedSyntheticCohortTrajectoryEvidenceV1(
      structuredClone(trajectory.evidence),
    )).toBe(false);
    expect(isVerifiedOpeAggregateReceiptV4(structuredClone(evaluated.receipt))).toBe(false);
    expect(isVerifiedPhase17SyntheticViewerClusterMappingAuditV1(
      structuredClone(mapping.audit),
    )).toBe(false);
    expect(isVerifiedPhase17SameProcessNoCandidateHandoffV1(
      structuredClone(handoff.handoff),
    )).toBe(false);
    await expect(evaluateSyntheticCohortOpeV4(
      structuredClone(trajectory.evidence),
    )).resolves.toEqual({ status: 'not_evaluable', blocker: 'ope_v4_source_unverified' });
    expect(buildPhase17SameProcessNoCandidateHandoffV1({
      phase16Handoff: structuredClone(phase16.handoff),
      mappingAudit: mapping.audit,
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_handoff_source_unverified',
    });
    expect(buildPhase17SameProcessNoCandidateHandoffV1({
      phase16Handoff: phase16.handoff,
      mappingAudit: structuredClone(mapping.audit),
    })).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_handoff_source_unverified',
    });
  }, 20_000);
});
