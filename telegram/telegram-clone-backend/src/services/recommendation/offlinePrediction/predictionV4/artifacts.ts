import { createHash } from 'crypto';

import { z } from 'zod';

import { VIEWER_CLUSTER_UNIT_VERSION } from '../../decisionContext/contracts';
import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  isVerifiedPhase18MultiwayHoldoutPlanAuditV1,
} from '../../ope/inference/qualification/v8/multiwayHoldout';
import type {
  Phase18MultiwayHoldoutCellV1,
  VerifiedPhase18MultiwayHoldoutPlanAuditV1,
} from '../../ope/inference/qualification/v8/multiwayHoldout/contracts';
import {
  isVerifiedPhase18SyntheticViewerTimeProvenanceV1,
} from '../../ope/inference/qualification/v8/timeProvenance';
import type {
  VerifiedPhase18SyntheticViewerTimeProvenanceV1,
} from '../../ope/inference/qualification/v8/timeProvenance/contracts';
import { canonicalWireJsonV1 } from '../artifacts/canonical';
import {
  offlineRewardDefinitionSchema,
  type OfflineRewardDefinitionV1,
} from '../contracts/artifacts';
import {
  OFFLINE_REWARD_HEADS_V1,
  encodeOfflineLabelsV1,
  type OfflinePrimitivePredictionsV1,
  type OfflineRewardHeadV1,
} from '../contracts/reward';
import {
  cohortPredictionSetOpeSourceBindingV3,
  isVerifiedCrossFittedCohortPredictionSetV3,
  type CohortPredictionOpeSourceBindingV3,
} from '../predictionV3/artifacts';
import {
  createCanonicalSpoolWriterV2,
  readCanonicalSpoolRecordsV2,
  type CanonicalSpoolV2,
} from '../predictionV2/spool';
import type { VerifiedCrossFittedCohortPredictionSetV3 } from '../predictionV3';
import {
  isVerifiedFullSupportPitActionSnapshotV2,
  replayVerifiedSnapshotPositionFeaturesV2,
  type ExpandedSnapshotPositionFeatureV2,
  type VerifiedFullSupportPitActionSnapshotV2,
} from '../snapshotV2';
import {
  predictLogisticV1,
  trainFullBatchLogisticV1,
  type LogisticModelV1,
} from '../trainer/logistic';
import type { ByteStreamFactoryV2 } from '../targetEvidence';
import {
  PREDICTION_V4_RESOURCE_LIMITS,
  PREDICTION_V4_RESOURCE_LIMITS_VERSION,
  PREDICTION_V4_ROW_ORDER,
  PREDICTION_V4_RUNTIME_CONFIG,
  PREDICTION_V4_RUNTIME_CONFIG_VERSION,
  PREDICTION_V4_TRAINING_EVIDENCE_SCOPE,
  PREDICTION_V4_WORK_MODEL_VERSION,
  multiwayCrossFittedModelBundleV4Schema,
  multiwayPredictionRecordV4Schema,
  multiwayPredictionSetManifestV4Schema,
  type MultiwayCrossFittedModelBundleV4,
  type MultiwayPredictionRecordV4,
  type MultiwayPredictionResourceDiagnosticsV4,
  type MultiwayPredictionSetManifestV4,
  type MultiwayPredictionVerificationReceiptV4,
  type ProduceMultiwayPredictionResultV4,
  type ProducedMultiwayPredictionSetV4,
  type VerifiedMultiwayPredictionSetV4,
  type VerifyMultiwayPredictionResultV4,
} from './contracts';

const MAX_QHAT_ABSOLUTE_VALUE = 1e12;
const featureMapSchema = z.record(z.string(), z.number().finite());
const labelsSchema = z.object(Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [
  head,
  z.number().finite().min(0).max(1),
])) as Record<OfflineRewardHeadV1, z.ZodNumber>).strict();

const trainingSpoolRecordV4Schema = z.object({
  contractVersion: z.literal('synthetic_multiway_training_spool_record_v4'),
  decisionId: z.string().uuid(),
  viewerClusterId: z.string().trim().min(1).max(512),
  timeClusterId: z.string().trim().min(1).max(512),
  actionKey: z.object({
    candidateNamespace: z.enum(['serving_post_id', 'model_post_id']),
    candidateId: z.string().trim().min(1),
    servedPosition: z.number().int().positive().max(64),
  }).strict(),
  rowKey: z.string().regex(/^[0-9a-f]{64}$/),
  features: featureMapSchema,
  labels: labelsSchema.optional(),
}).strict();

type TrainingSpoolRecordV4 = z.infer<typeof trainingSpoolRecordV4Schema>;
type CellModels = Record<OfflineRewardHeadV1, LogisticModelV1>;
type NormalizedInput = Readonly<{
  predictionSet: VerifiedCrossFittedCohortPredictionSetV3;
  snapshot: VerifiedFullSupportPitActionSnapshotV2;
  rewardDefinition: z.infer<typeof offlineRewardDefinitionSchema>;
  provenance: VerifiedPhase18SyntheticViewerTimeProvenanceV1;
  plan: VerifiedPhase18MultiwayHoldoutPlanAuditV1;
  sources: CohortPredictionOpeSourceBindingV3;
  trainingConfigSha256: string;
  resourceLimitsSha256: string;
  runtimeConfigSha256: string;
}>;
type CellInspection = Readonly<{
  cell: Phase18MultiwayHoldoutCellV1;
  trainingRows: readonly TrainingSpoolRecordV4[];
  evaluationRows: readonly TrainingSpoolRecordV4[];
  guardBandRows: readonly TrainingSpoolRecordV4[];
  featureKeys: readonly string[];
}>;
type Preflight = Readonly<{
  trainingRecords: readonly TrainingSpoolRecordV4[];
  cells: readonly CellInspection[];
  qHatAbsoluteBound: number;
  maximumCellFeatureCount: number;
  producerAndVerifierMathWorkUnits: number;
  conservativeCombinedSpoolByteCount: number;
}>;

const verifiedSets = new WeakSet<object>();
const receiptOwners = new WeakMap<object, string>();

const SPOOL_LIMITS_V4 = Object.freeze({
  maxRecords: PREDICTION_V4_RESOURCE_LIMITS.maximumCombinedSpoolRecords,
  maxLineBytes: PREDICTION_V4_RESOURCE_LIMITS.maximumLineBytes,
  maxFileBytes: PREDICTION_V4_RESOURCE_LIMITS.maximumCombinedSpoolBytes,
});

const RESOURCE_LIMITS_PREIMAGE_V4 = Object.freeze({
  limitsVersion: PREDICTION_V4_RESOURCE_LIMITS_VERSION,
  ...PREDICTION_V4_RESOURCE_LIMITS,
});
const TRAINING_CONFIG_PREIMAGE_V4 = Object.freeze({
  trainerVersion: 'cross_fitted_full_batch_logistic_v1',
  runtimeConfig: PREDICTION_V4_RUNTIME_CONFIG,
  unionExclusion: 'viewer_and_time_not_equal_to_evaluation_cell_v1',
});

class SuppliedPredictionStreamError extends Error {}

const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left),
  Buffer.from(right),
);
const positiveZero = (value: number): number => value === 0 ? 0 : value;
const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalWireJsonV1(value)).digest('hex');
const same = (left: unknown, right: unknown): boolean => (
  canonicalWireJsonV1(left) === canonicalWireJsonV1(right)
);
const actionIdentity = (value: unknown): string => canonicalDecisionJson(value);
const rowKeyV4 = (decisionId: string, actionKey: unknown): string => digest({
  contractVersion: 'synthetic_multiway_training_row_key_v4',
  decisionId,
  actionKey,
});

function safeGet(value: unknown, key: PropertyKey): Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false }> {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return { ok: false };
  }
  try {
    return { ok: true, value: Reflect.get(value, key) };
  } catch {
    return { ok: false };
  }
}

function recursivelyFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) recursivelyFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function recursivelyFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => (
    !child || typeof child !== 'object' || recursivelyFrozen(child)
  ));
}

function stableBlocker(error: unknown): string {
  if (error instanceof SuppliedPredictionStreamError) {
    return 'prediction_v4_supplied_artifact_mismatch';
  }
  const message = error instanceof Error ? error.message : '';
  return new Set([
    'resource_limit_exceeded',
    'prediction_v4_input_contract_invalid',
    'prediction_v4_source_unverified',
    'prediction_v4_binding_mismatch',
    'prediction_v4_fixture_mismatch',
    'prediction_v4_training_row_invalid',
    'prediction_v4_union_exclusion_invalid',
    'prediction_v4_model_bundle_invalid',
    'prediction_v4_stream_contract_invalid',
    'prediction_v4_manifest_invalid',
    'prediction_v4_numerical_error',
    'prediction_v4_supplied_artifact_mismatch',
  ]).has(message) ? message : 'prediction_v4_input_contract_invalid';
}

function reject(blocker: string): Readonly<{ status: 'not_evaluable'; blocker: string }> {
  return Object.freeze({ status: 'not_evaluable', blocker });
}

function normalizeInput(raw: unknown): Readonly<{ input: NormalizedInput }>
  | Readonly<{ blocker: string }> {
  const predictionSetValue = safeGet(raw, 'predictionSet');
  if (!predictionSetValue.ok || !isVerifiedCrossFittedCohortPredictionSetV3(
    predictionSetValue.value,
  )) return { blocker: 'prediction_v4_source_unverified' };
  const predictionSet = predictionSetValue.value;

  const provenanceValue = safeGet(raw, 'provenance');
  if (!provenanceValue.ok || !isVerifiedPhase18SyntheticViewerTimeProvenanceV1(
    provenanceValue.value,
  )) return { blocker: 'prediction_v4_source_unverified' };
  const provenance = provenanceValue.value;

  const planValue = safeGet(raw, 'plan');
  if (!planValue.ok || !isVerifiedPhase18MultiwayHoldoutPlanAuditV1(planValue.value)) {
    return { blocker: 'prediction_v4_source_unverified' };
  }
  const plan = planValue.value;

  const snapshotValue = safeGet(raw, 'snapshot');
  if (!snapshotValue.ok || !isVerifiedFullSupportPitActionSnapshotV2(snapshotValue.value)) {
    return { blocker: 'prediction_v4_source_unverified' };
  }
  const snapshot = snapshotValue.value;

  const rewardValue = safeGet(raw, 'rewardDefinition');
  if (!rewardValue.ok) return { blocker: 'prediction_v4_input_contract_invalid' };
  const reward = offlineRewardDefinitionSchema.safeParse(rewardValue.value);
  if (!reward.success) return { blocker: 'prediction_v4_input_contract_invalid' };

  const sources = cohortPredictionSetOpeSourceBindingV3(predictionSet);
  if (!sources) return { blocker: 'prediction_v4_source_unverified' };
  try {
    if (
      plan.provenanceSha256 !== provenance.provenanceSha256
      || plan.phase17HandoffSha256 !== provenance.sourceBindings.phase17HandoffSha256
      || plan.phase17MappingSha256 !== provenance.sourceBindings.phase17MappingSha256
      || plan.predictionVerificationReceiptSha256 !== predictionSet.receipt.receiptSha256
      || provenance.sourceBindings.predictionSetVersion
        !== predictionSet.manifest.predictionSetVersion
      || provenance.sourceBindings.predictionVerificationReceiptSha256
        !== predictionSet.receipt.receiptSha256
      || provenance.sourceBindings.holdoutPlanSha256
        !== predictionSet.receipt.holdoutPlanSha256
      || provenance.sourceBindings.modelBundleSha256
        !== predictionSet.manifest.modelBundleSha256
      || provenance.sourceBindings.predictionStreamSha256
        !== predictionSet.receipt.predictionStreamSha256
      || provenance.sourceBindings.decisionContextEvidenceSha256
        !== predictionSet.receipt.decisionContextEvidenceSha256
      || provenance.sourceBindings.syntheticDecisionLogRootSha256
        !== predictionSet.receipt.syntheticDecisionLogRootSha256
      || provenance.sourceBindings.syntheticOutcomeEvidenceRootSha256
        !== predictionSet.receipt.syntheticOutcomeEvidenceRootSha256
      || sources.holdoutPlan.holdoutPlanSha256 !== predictionSet.receipt.holdoutPlanSha256
      || sources.targetEvidence.targetManifestSha256
        !== predictionSet.receipt.targetManifestSha256
      || sources.targetEvidence.receipt.verificationReceiptSha256
        !== predictionSet.receipt.targetVerificationReceiptSha256
      || sources.decisionContextEvidence.decisionContextEvidenceSha256
        !== predictionSet.receipt.decisionContextEvidenceSha256
      || snapshot.manifest.snapshotManifestSha256
        !== predictionSet.receipt.snapshotManifestSha256
      || snapshot.manifest.targetManifestSha256
        !== predictionSet.receipt.targetManifestSha256
      || snapshot.manifest.targetVerificationReceiptSha256
        !== predictionSet.receipt.targetVerificationReceiptSha256
      || createHash('sha256').update(canonicalDecisionJson(reward.data)).digest('hex')
        !== predictionSet.receipt.rewardDefinitionSha256
    ) return { blocker: 'prediction_v4_binding_mismatch' };

    if (
      provenance.syntheticSourceVersion !== 'phase16_fixed_crossed_viewer_time_fixture_v1'
      || !provenance.completeCrossedGrid
      || provenance.memberships.length !== PREDICTION_V4_RESOURCE_LIMITS.requiredDecisions
      || provenance.viewerClusterIds.length
        !== PREDICTION_V4_RESOURCE_LIMITS.requiredViewerClusters
      || provenance.timeClusterIds.length !== PREDICTION_V4_RESOURCE_LIMITS.requiredTimeClusters
      || plan.cells.length !== PREDICTION_V4_RESOURCE_LIMITS.requiredEvaluationCells
      || sources.decisions.length !== PREDICTION_V4_RESOURCE_LIMITS.requiredDecisions
      || sources.decisionContextEvidence.decisions.length
        !== PREDICTION_V4_RESOURCE_LIMITS.requiredDecisions
      || snapshot.manifest.decisionCount !== PREDICTION_V4_RESOURCE_LIMITS.requiredDecisions
    ) return { blocker: 'prediction_v4_fixture_mismatch' };

    return {
      input: recursivelyFreeze({
        predictionSet,
        snapshot,
        rewardDefinition: recursivelyFreeze(reward.data),
        provenance,
        plan,
        sources,
        trainingConfigSha256: digest(TRAINING_CONFIG_PREIMAGE_V4),
        resourceLimitsSha256: digest(RESOURCE_LIMITS_PREIMAGE_V4),
        runtimeConfigSha256: digest(PREDICTION_V4_RUNTIME_CONFIG),
      }),
    };
  } catch {
    return { blocker: 'prediction_v4_input_contract_invalid' };
  }
}

function canonicalizeFeatures(value: unknown): Record<string, number> {
  const parsed = featureMapSchema.safeParse(value);
  if (!parsed.success) throw new Error('prediction_v4_training_row_invalid');
  return Object.fromEntries(Object.entries(parsed.data).sort(([left], [right]) => (
    compareText(left, right)
  )));
}

async function collectTrainingRecords(
  input: NormalizedInput,
): Promise<Readonly<{ records: readonly TrainingSpoolRecordV4[] }>
  | Readonly<{ blocker: string }>> {
  const memberships = new Map(input.provenance.memberships.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const contexts = new Map(input.sources.decisionContextEvidence.decisions.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const decisions = new Map(input.sources.decisions.map((entry) => [
    entry.syntheticDecisionLog.decisionId,
    entry,
  ]));
  const outcomes = new Map(input.sources.decisions.map((entry) => [
    entry.syntheticDecisionLog.decisionId,
    new Map(entry.outcomeEvidence.outcomes.map((outcome) => [
      actionIdentity(outcome.actionKey),
      outcome,
    ])),
  ]));
  const seenOutcomes = new Map<string, Set<string>>();
  const records = new Map<string, TrainingSpoolRecordV4>();
  let localBlocker: string | undefined;
  const replay = await replayVerifiedSnapshotPositionFeaturesV2(
    input.snapshot,
    input.sources.targetEvidence,
    {
      onPositionFeature: (feature: ExpandedSnapshotPositionFeatureV2) => {
        try {
          const membership = memberships.get(feature.decisionId);
          const context = contexts.get(feature.decisionId);
          const decision = decisions.get(feature.decisionId);
          const identity = actionIdentity(feature.row.actionKey);
          if (
            !membership
            || !context
            || !decision
            || context.clusterUnitVersion !== VIEWER_CLUSTER_UNIT_VERSION
            || context.inferenceClusterId !== membership.viewerClusterId
            || !membership.servedPositions.includes(feature.servedPosition)
            || feature.row.decisionId !== feature.decisionId
          ) throw new Error('prediction_v4_binding_mismatch');
          const key = rowKeyV4(feature.decisionId, feature.row.actionKey);
          if (records.has(key)) throw new Error('prediction_v4_training_row_invalid');
          const outcome = outcomes.get(feature.decisionId)?.get(identity);
          if (outcome) {
            const seen = seenOutcomes.get(feature.decisionId) ?? new Set<string>();
            seen.add(identity);
            seenOutcomes.set(feature.decisionId, seen);
          }
          const parsed = trainingSpoolRecordV4Schema.safeParse({
            contractVersion: 'synthetic_multiway_training_spool_record_v4',
            decisionId: feature.decisionId,
            viewerClusterId: membership.viewerClusterId,
            timeClusterId: membership.timeClusterId,
            actionKey: feature.row.actionKey,
            rowKey: key,
            features: canonicalizeFeatures(feature.row.features),
            ...(outcome ? {
              labels: encodeOfflineLabelsV1(
                outcome.outcome.labels,
                input.rewardDefinition.dwell.capMs,
              ),
            } : {}),
          });
          if (!parsed.success) throw new Error('prediction_v4_training_row_invalid');
          if (Buffer.byteLength(canonicalWireJsonV1(parsed.data))
            > PREDICTION_V4_RESOURCE_LIMITS.maximumLineBytes) {
            throw new Error('resource_limit_exceeded');
          }
          records.set(key, parsed.data);
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
  for (const source of input.sources.decisions) {
    const decisionId = source.syntheticDecisionLog.decisionId;
    if ((seenOutcomes.get(decisionId)?.size ?? 0) !== source.outcomeEvidence.outcomes.length) {
      return { blocker: 'prediction_v4_training_row_invalid' };
    }
  }
  const ordered = [...records.values()].sort((left, right) => (
    compareText(left.decisionId, right.decisionId)
    || left.actionKey.servedPosition - right.actionKey.servedPosition
    || compareText(actionIdentity(left.actionKey), actionIdentity(right.actionKey))
  ));
  return { records: recursivelyFreeze(ordered) };
}

function inspectCells(
  input: NormalizedInput,
  records: readonly TrainingSpoolRecordV4[],
): Readonly<{ cells: readonly CellInspection[] }>
  | Readonly<{ blocker: string }> {
  const memberships = new Map(input.provenance.memberships.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const result: CellInspection[] = [];
  try {
    for (const cell of input.plan.cells) {
      const trainingIds = new Set(cell.trainingDecisionIds);
      const evaluationIds = new Set(cell.evaluationDecisionIds);
      const guardIds = new Set(cell.guardBandDecisionIds);
      const trainingRows = records.filter((row) => (
        row.labels !== undefined && trainingIds.has(row.decisionId)
      ));
      const evaluationRows = records.filter((row) => evaluationIds.has(row.decisionId));
      const guardBandRows = records.filter((row) => guardIds.has(row.decisionId));
      const trainingMemberships = cell.trainingDecisionIds.map((id) => memberships.get(id));
      const evaluationMemberships = cell.evaluationDecisionIds.map((id) => memberships.get(id));
      if (
        trainingRows.length === 0
        || evaluationRows.length === 0
        || guardBandRows.length === 0
        || trainingMemberships.some((entry) => !entry
          || entry.viewerClusterId === cell.viewerClusterId
          || entry.timeClusterId === cell.timeClusterId)
        || evaluationMemberships.some((entry) => !entry
          || entry.viewerClusterId !== cell.viewerClusterId
          || entry.timeClusterId !== cell.timeClusterId)
        || trainingRows.some((row) => guardIds.has(row.decisionId)
          || evaluationIds.has(row.decisionId))
      ) return { blocker: 'prediction_v4_union_exclusion_invalid' };
      const featureKeys = [...new Set(trainingRows.flatMap((row) => (
        Object.keys(row.features)
      )))].sort(compareText);
      if (featureKeys.length > PREDICTION_V4_RESOURCE_LIMITS.maximumFeaturesPerCell) {
        return { blocker: 'resource_limit_exceeded' };
      }
      result.push(recursivelyFreeze({
        cell,
        trainingRows,
        evaluationRows,
        guardBandRows,
        featureKeys,
      }));
    }
    return { cells: recursivelyFreeze(result) };
  } catch {
    return { blocker: 'prediction_v4_union_exclusion_invalid' };
  }
}

function deriveQHatAbsoluteBound(reward: OfflineRewardDefinitionV1): number {
  let bound = 0;
  for (const head of OFFLINE_REWARD_HEADS_V1) {
    if (head !== 'dwell') bound += Math.abs(reward.weights[head]);
  }
  bound += Math.abs(reward.dwell.weight)
    * reward.dwell.capMs / reward.dwell.scaleMs;
  return bound;
}

async function preflight(
  input: NormalizedInput,
): Promise<Readonly<{ preflight: Preflight }> | Readonly<{ blocker: string }>> {
  const collected = await collectTrainingRecords(input);
  if ('blocker' in collected) return collected;
  const records = collected.records;
  const inspected = inspectCells(input, records);
  if ('blocker' in inspected) return inspected;
  try {
    const labelRowCount = records.filter((row) => row.labels !== undefined).length;
    const slotCount = new Set(records.map((row) => (
      `${row.decisionId}:${row.actionKey.servedPosition}`
    ))).size;
    const canonicalInputBytes = Buffer.byteLength(canonicalWireJsonV1({
      predictionReceiptSha256: input.predictionSet.receipt.receiptSha256,
      snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
      provenanceSha256: input.provenance.provenanceSha256,
      planSha256: input.plan.planSha256,
      rewardDefinitionSha256: input.predictionSet.receipt.rewardDefinitionSha256,
      trainingRecords: records,
    }));
    if (
      records.length !== PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows
      || labelRowCount !== PREDICTION_V4_RESOURCE_LIMITS.maximumLabelRows
      || slotCount !== PREDICTION_V4_RESOURCE_LIMITS.requiredSlots
      || inspected.cells.length !== PREDICTION_V4_RESOURCE_LIMITS.requiredEvaluationCells
      || canonicalInputBytes > PREDICTION_V4_RESOURCE_LIMITS.maximumCanonicalInputBytes
    ) return { blocker: 'prediction_v4_fixture_mismatch' };

    const maximumCellFeatureCount = Math.max(...inspected.cells.map((entry) => (
      entry.featureKeys.length
    )));
    let singleBuildMathWorkUnits = 0;
    for (const entry of inspected.cells) {
      singleBuildMathWorkUnits += OFFLINE_REWARD_HEADS_V1.length
        * PREDICTION_V4_RUNTIME_CONFIG.epochs
        * entry.trainingRows.length
        * (2 * entry.featureKeys.length + 3);
      singleBuildMathWorkUnits += entry.evaluationRows.length
        * (OFFLINE_REWARD_HEADS_V1.length * (entry.featureKeys.length + 2) + 1);
    }
    const producerAndVerifierMathWorkUnits = 2 * singleBuildMathWorkUnits;
    const conservativeCombinedSpoolByteCount =
      PREDICTION_V4_RESOURCE_LIMITS.maximumCombinedSpoolRecords
      * (PREDICTION_V4_RESOURCE_LIMITS.maximumLineBytes + 1);
    if (
      !Number.isSafeInteger(producerAndVerifierMathWorkUnits)
      || producerAndVerifierMathWorkUnits
        > PREDICTION_V4_RESOURCE_LIMITS.maximumProducerAndVerifierMathWorkUnits
      || conservativeCombinedSpoolByteCount
        > PREDICTION_V4_RESOURCE_LIMITS.maximumCombinedSpoolBytes
    ) return { blocker: 'resource_limit_exceeded' };
    const qHatAbsoluteBound = deriveQHatAbsoluteBound(input.rewardDefinition);
    if (!Number.isFinite(qHatAbsoluteBound) || qHatAbsoluteBound > MAX_QHAT_ABSOLUTE_VALUE) {
      return { blocker: 'prediction_v4_numerical_error' };
    }
    return {
      preflight: recursivelyFreeze({
        trainingRecords: records,
        cells: inspected.cells,
        qHatAbsoluteBound,
        maximumCellFeatureCount,
        producerAndVerifierMathWorkUnits,
        conservativeCombinedSpoolByteCount,
      }),
    };
  } catch (error) {
    return { blocker: stableBlocker(error) };
  }
}

async function writeTrainingSpool(
  records: readonly TrainingSpoolRecordV4[],
): Promise<CanonicalSpoolV2> {
  const writer = await createCanonicalSpoolWriterV2(SPOOL_LIMITS_V4);
  try {
    for (const record of records) await writer.write(record);
    return await writer.finish();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

async function trainCellsFromSpool(
  spool: CanonicalSpoolV2,
  input: NormalizedInput,
  plan: Preflight,
): Promise<Readonly<{
  cells: MultiwayCrossFittedModelBundleV4['cells'];
  models: ReadonlyMap<string, CellModels>;
}> | Readonly<{ blocker: string }>> {
  const memberships = new Map(input.provenance.memberships.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const models = new Map<string, CellModels>();
  const builtCells: MultiwayCrossFittedModelBundleV4['cells'] = [];
  try {
    for (const inspected of plan.cells) {
      const trainingIds = new Set(inspected.cell.trainingDecisionIds);
      const rows: TrainingSpoolRecordV4[] = [];
      for await (const entry of readCanonicalSpoolRecordsV2(spool.stream, SPOOL_LIMITS_V4)) {
        const row = trainingSpoolRecordV4Schema.parse(entry.value);
        if (!row.labels || !trainingIds.has(row.decisionId)) continue;
        const membership = memberships.get(row.decisionId);
        if (
          !membership
          || membership.viewerClusterId !== row.viewerClusterId
          || membership.timeClusterId !== row.timeClusterId
          || row.viewerClusterId === inspected.cell.viewerClusterId
          || row.timeClusterId === inspected.cell.timeClusterId
        ) throw new Error('prediction_v4_union_exclusion_invalid');
        rows.push(row);
      }
      const expectedTrainingRowKeys = inspected.trainingRows.map((row) => row.rowKey)
        .sort(compareText);
      if (!same(rows.map((row) => row.rowKey).sort(compareText), expectedTrainingRowKeys)) {
        return { blocker: 'prediction_v4_union_exclusion_invalid' };
      }
      const cellModels = Object.fromEntries(OFFLINE_REWARD_HEADS_V1.map((head) => [
        head,
        trainFullBatchLogisticV1(rows.map((row) => ({
          rowId: row.rowKey,
          features: row.features,
          label: row.labels![head],
        })), PREDICTION_V4_RUNTIME_CONFIG),
      ])) as CellModels;
      const heads = OFFLINE_REWARD_HEADS_V1.map((head) => ({
        head,
        intercept: cellModels[head].intercept,
        coefficients: inspected.featureKeys.map((feature) => ({
          feature,
          value: cellModels[head].coefficients[feature] ?? 0,
        })),
      }));
      const cellPreimage = {
        cellSha256: inspected.cell.cellSha256,
        viewerClusterId: inspected.cell.viewerClusterId,
        timeClusterId: inspected.cell.timeClusterId,
        evaluationDecisionIds: [...inspected.cell.evaluationDecisionIds],
        trainingDecisionIds: [...inspected.cell.trainingDecisionIds],
        guardBandDecisionIds: [...inspected.cell.guardBandDecisionIds],
        excludedDecisionIds: [...inspected.cell.excludedDecisionIds],
        trainingRowKeys: expectedTrainingRowKeys,
        evaluationRowKeys: inspected.evaluationRows.map((row) => row.rowKey).sort(compareText),
        guardBandRowKeys: inspected.guardBandRows.map((row) => row.rowKey).sort(compareText),
        featureKeys: [...inspected.featureKeys],
        heads,
        sameViewerLeakageExcludedInTraining: true as const,
        sameTimeLeakageExcludedInTraining: true as const,
        guardBandExcludedFromTraining: true as const,
      };
      builtCells.push({ ...cellPreimage, modelCellSha256: digest(cellPreimage) });
      models.set(inspected.cell.cellSha256, cellModels);
    }
    return { cells: recursivelyFreeze(builtCells), models };
  } catch (error) {
    return { blocker: stableBlocker(error) };
  }
}

function primitiveQHat(
  predictions: OfflinePrimitivePredictionsV1,
  reward: OfflineRewardDefinitionV1,
): number {
  let value = 0;
  for (const head of OFFLINE_REWARD_HEADS_V1) {
    if (head !== 'dwell') value += reward.weights[head] * predictions[head];
  }
  value += reward.dwell.weight * predictions.dwell
    * reward.dwell.capMs / reward.dwell.scaleMs;
  if (!Number.isFinite(value) || Math.abs(value) > MAX_QHAT_ABSOLUTE_VALUE) {
    throw new Error('prediction_v4_numerical_error');
  }
  return positiveZero(value);
}

function groupTrainingRecords(
  records: readonly TrainingSpoolRecordV4[],
): Map<string, Map<number, TrainingSpoolRecordV4[]>> {
  const grouped = new Map<string, Map<number, TrainingSpoolRecordV4[]>>();
  for (const record of records) {
    const byPosition = grouped.get(record.decisionId)
      ?? new Map<number, TrainingSpoolRecordV4[]>();
    const rows = byPosition.get(record.actionKey.servedPosition) ?? [];
    rows.push(record);
    byPosition.set(record.actionKey.servedPosition, rows);
    grouped.set(record.decisionId, byPosition);
  }
  return grouped;
}

async function writePredictionSpool(
  input: NormalizedInput,
  plan: Preflight,
  bundle: MultiwayCrossFittedModelBundleV4,
  models: ReadonlyMap<string, CellModels>,
): Promise<Readonly<{ spool: CanonicalSpoolV2; predictionCount: number }>
  | Readonly<{ blocker: string }>> {
  const writer = await createCanonicalSpoolWriterV2(SPOOL_LIMITS_V4);
  const rowsByDecision = groupTrainingRecords(plan.trainingRecords);
  const memberships = new Map(input.provenance.memberships.map((entry) => [
    entry.decisionId,
    entry,
  ]));
  const sourceDecisions = new Map(input.sources.decisions.map((entry) => [
    entry.syntheticDecisionLog.decisionId,
    entry,
  ]));
  const cellByDecision = new Map<string, Phase18MultiwayHoldoutCellV1>();
  for (const cell of input.plan.cells) {
    for (const decisionId of cell.evaluationDecisionIds) {
      if (cellByDecision.has(decisionId)) {
        await writer.abort().catch(() => undefined);
        return { blocker: 'prediction_v4_union_exclusion_invalid' };
      }
      cellByDecision.set(decisionId, cell);
    }
  }
  let predictionCount = 0;
  try {
    for (const membership of input.provenance.memberships) {
      const source = sourceDecisions.get(membership.decisionId);
      const cell = cellByDecision.get(membership.decisionId);
      const modelCell = bundle.cells.find((entry) => entry.cellSha256 === cell?.cellSha256);
      const cellModels = cell ? models.get(cell.cellSha256) : undefined;
      const byPosition = rowsByDecision.get(membership.decisionId);
      if (!source || !cell || !modelCell || !cellModels || !byPosition) {
        throw new Error('prediction_v4_binding_mismatch');
      }
      const decisionHash = createHash('sha256');
      const write = async (record: MultiwayPredictionRecordV4): Promise<string> => {
        const parsed = multiwayPredictionRecordV4Schema.safeParse(record);
        if (!parsed.success) throw new Error('prediction_v4_stream_contract_invalid');
        const line = `${canonicalWireJsonV1(parsed.data)}\n`;
        if (Buffer.byteLength(line) - 1 > PREDICTION_V4_RESOURCE_LIMITS.maximumLineBytes) {
          throw new Error('resource_limit_exceeded');
        }
        await writer.write(parsed.data);
        return line;
      };
      decisionHash.update(await write({
        recordType: 'decision_start',
        contractVersion: 'synthetic_multiway_prediction_stream_v4',
        decisionId: membership.decisionId,
        requestId: membership.requestId,
        inferenceClusterId: membership.viewerClusterId,
        clusterUnitVersion: VIEWER_CLUSTER_UNIT_VERSION,
        timeClusterId: membership.timeClusterId,
        cellSha256: cell.cellSha256,
        modelCellSha256: modelCell.modelCellSha256,
        modelBundleSha256: bundle.modelBundleSha256,
        expectedStepCount: membership.servedPositions.length,
        servable: false,
      }));
      let decisionPredictionCount = 0;
      for (const servedPosition of membership.servedPositions) {
        const rows = byPosition.get(servedPosition) ?? [];
        if (rows.length === 0) throw new Error('prediction_v4_fixture_mismatch');
        const stepHash = createHash('sha256');
        const startLine = await write({
          recordType: 'step_start',
          decisionId: membership.decisionId,
          servedPosition,
          expectedActionCount: rows.length,
        });
        stepHash.update(startLine);
        decisionHash.update(startLine);
        for (const row of rows) {
          const primitivePredictions = Object.fromEntries(
            OFFLINE_REWARD_HEADS_V1.map((head) => [
              head,
              positiveZero(predictLogisticV1(cellModels[head], row.features)),
            ]),
          ) as OfflinePrimitivePredictionsV1;
          const qHat = primitiveQHat(primitivePredictions, input.rewardDefinition);
          if (Math.abs(qHat) > plan.qHatAbsoluteBound + Number.EPSILON) {
            throw new Error('prediction_v4_numerical_error');
          }
          const line = await write({
            recordType: 'prediction',
            decisionId: membership.decisionId,
            servedPosition,
            actionKey: row.actionKey,
            viewerClusterId: membership.viewerClusterId,
            timeClusterId: membership.timeClusterId,
            cellSha256: cell.cellSha256,
            modelCellSha256: modelCell.modelCellSha256,
            primitivePredictions,
            qHat,
          });
          stepHash.update(line);
          decisionHash.update(line);
          decisionPredictionCount += 1;
          predictionCount += 1;
        }
        decisionHash.update(await write({
          recordType: 'step_end',
          decisionId: membership.decisionId,
          servedPosition,
          actualActionCount: rows.length,
          stepSha256: stepHash.digest('hex'),
        }));
      }
      await write({
        recordType: 'decision_end',
        decisionId: membership.decisionId,
        actualStepCount: membership.servedPositions.length,
        actualPredictionCount: decisionPredictionCount,
        decisionSha256: decisionHash.digest('hex'),
      });
    }
    if (predictionCount !== PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows) {
      throw new Error('prediction_v4_fixture_mismatch');
    }
    return { spool: await writer.finish(), predictionCount };
  } catch (error) {
    await writer.abort().catch(() => undefined);
    return { blocker: stableBlocker(error) };
  }
}

function assertCanonicalLineWithinLimit(value: unknown): void {
  if (Buffer.byteLength(canonicalWireJsonV1(value))
    > PREDICTION_V4_RESOURCE_LIMITS.maximumLineBytes) {
    throw new Error('resource_limit_exceeded');
  }
}

async function buildArtifacts(
  input: NormalizedInput,
): Promise<ProduceMultiwayPredictionResultV4> {
  let trainingSpool: CanonicalSpoolV2 | undefined;
  let predictionSpool: CanonicalSpoolV2 | undefined;
  try {
    const checked = await preflight(input);
    if ('blocker' in checked) return reject(checked.blocker);
    const plan = checked.preflight;
    trainingSpool = await writeTrainingSpool(plan.trainingRecords);
    const trained = await trainCellsFromSpool(trainingSpool, input, plan);
    if ('blocker' in trained) return reject(trained.blocker);

    const rewardDefinitionSha256 = input.predictionSet.receipt.rewardDefinitionSha256;
    const bundlePreimage = {
      contractVersion: 'synthetic_multiway_cross_fitted_model_bundle_v4' as const,
      datasetVersion: input.sources.targetEvidence.manifest.datasetVersion,
      sourcePredictionSetVersion: input.predictionSet.manifest.predictionSetVersion,
      sourcePredictionVerificationReceiptSha256: input.predictionSet.receipt.receiptSha256,
      snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
      targetManifestSha256: input.predictionSet.receipt.targetManifestSha256,
      targetVerificationReceiptSha256:
        input.predictionSet.receipt.targetVerificationReceiptSha256,
      decisionContextEvidenceSha256:
        input.predictionSet.receipt.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256:
        input.predictionSet.receipt.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256:
        input.predictionSet.receipt.syntheticOutcomeEvidenceRootSha256,
      viewerHoldoutPlanSha256: input.predictionSet.receipt.holdoutPlanSha256,
      phase18ProvenanceSha256: input.provenance.provenanceSha256,
      phase18PlanSha256: input.plan.planSha256,
      viewerMembershipSha256: input.plan.viewerMembershipSha256,
      timeMembershipSha256: input.plan.timeMembershipSha256,
      trainingSpoolSha256: trainingSpool.sha256,
      trainingConfigSha256: input.trainingConfigSha256,
      resourceLimitsVersion: PREDICTION_V4_RESOURCE_LIMITS_VERSION,
      resourceLimitsSha256: input.resourceLimitsSha256,
      runtimeConfigVersion: PREDICTION_V4_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: input.runtimeConfigSha256,
      rowOrder: PREDICTION_V4_ROW_ORDER,
      rewardDefinitionSha256,
      viewerClusterCount: 2 as const,
      timeClusterCount: 2 as const,
      evaluationCellCount: 4 as const,
      cells: trained.cells,
      crossFitted: true as const,
      unionExclusionApplied: true as const,
      trainingApplied: true as const,
      trainingEvidenceScope: PREDICTION_V4_TRAINING_EVIDENCE_SCOPE,
      multiwayQHatProvenanceStatus: 'verified_synthetic_only' as const,
      commonTimeShockHandlingVerified: false as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    const parsedBundle = multiwayCrossFittedModelBundleV4Schema.safeParse({
      ...bundlePreimage,
      modelBundleSha256: digest(bundlePreimage),
    });
    if (!parsedBundle.success) return reject('prediction_v4_model_bundle_invalid');
    const bundle = parsedBundle.data;
    assertCanonicalLineWithinLimit(bundle);

    const predicted = await writePredictionSpool(input, plan, bundle, trained.models);
    if ('blocker' in predicted) return reject(predicted.blocker);
    predictionSpool = predicted.spool;
    const combinedSpoolRecordCount = trainingSpool.recordCount + predictionSpool.recordCount;
    const combinedSpoolByteCount = trainingSpool.byteCount + predictionSpool.byteCount;
    if (
      trainingSpool.recordCount !== PREDICTION_V4_RESOURCE_LIMITS.maximumSupportActionRows
      || predictionSpool.recordCount !== PREDICTION_V4_RESOURCE_LIMITS.maximumPredictionRecords
      || combinedSpoolRecordCount
        !== PREDICTION_V4_RESOURCE_LIMITS.maximumCombinedSpoolRecords
      || combinedSpoolByteCount > plan.conservativeCombinedSpoolByteCount
      || combinedSpoolByteCount > PREDICTION_V4_RESOURCE_LIMITS.maximumCombinedSpoolBytes
    ) return reject('resource_limit_exceeded');

    const manifestPreimage = {
      contractVersion: 'synthetic_multiway_prediction_set_manifest_v4' as const,
      datasetVersion: input.sources.targetEvidence.manifest.datasetVersion,
      predictionStreamSha256: predictionSpool.sha256,
      physicalRecordCount: 44 as const,
      decisionCount: 4 as const,
      viewerClusterCount: 2 as const,
      timeClusterCount: 2 as const,
      evaluationCellCount: 4 as const,
      stepCount: 8 as const,
      predictionCount: 20 as const,
      trainingRowCount: 20 as const,
      labelRowCount: 8 as const,
      modelBundleSha256: bundle.modelBundleSha256,
      sourcePredictionSetVersion: input.predictionSet.manifest.predictionSetVersion,
      sourcePredictionVerificationReceiptSha256: input.predictionSet.receipt.receiptSha256,
      snapshotManifestSha256: input.snapshot.manifest.snapshotManifestSha256,
      targetManifestSha256: input.predictionSet.receipt.targetManifestSha256,
      targetVerificationReceiptSha256:
        input.predictionSet.receipt.targetVerificationReceiptSha256,
      decisionContextEvidenceSha256:
        input.predictionSet.receipt.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256:
        input.predictionSet.receipt.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256:
        input.predictionSet.receipt.syntheticOutcomeEvidenceRootSha256,
      viewerHoldoutPlanSha256: input.predictionSet.receipt.holdoutPlanSha256,
      phase18ProvenanceSha256: input.provenance.provenanceSha256,
      phase18PlanSha256: input.plan.planSha256,
      viewerMembershipSha256: input.plan.viewerMembershipSha256,
      timeMembershipSha256: input.plan.timeMembershipSha256,
      trainingConfigSha256: input.trainingConfigSha256,
      resourceLimitsVersion: PREDICTION_V4_RESOURCE_LIMITS_VERSION,
      resourceLimitsSha256: input.resourceLimitsSha256,
      runtimeConfigVersion: PREDICTION_V4_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: input.runtimeConfigSha256,
      rowOrder: PREDICTION_V4_ROW_ORDER,
      rewardDefinitionSha256,
      trainingApplied: true as const,
      trainingEvidenceScope: PREDICTION_V4_TRAINING_EVIDENCE_SCOPE,
      multiwayQHatProvenanceStatus: 'verified_synthetic_only' as const,
      commonTimeShockHandlingVerified: false as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    const parsedManifest = multiwayPredictionSetManifestV4Schema.safeParse({
      ...manifestPreimage,
      predictionSetVersion: digest(manifestPreimage),
    });
    if (!parsedManifest.success) return reject('prediction_v4_manifest_invalid');
    const manifest = parsedManifest.data;
    assertCanonicalLineWithinLimit(manifest);

    const diagnostics: MultiwayPredictionResourceDiagnosticsV4 = recursivelyFreeze({
      preflightCompletedBeforeSpoolAndTraining: true,
      decisionCount: 4,
      viewerClusterCount: 2,
      timeClusterCount: 2,
      evaluationCellCount: 4,
      slotCount: 8,
      supportActionRowCount: 20,
      labelRowCount: 8,
      trainingSpoolRecordCount: 20,
      predictionRecordCount: 44,
      combinedSpoolRecordCount: 64,
      combinedSpoolByteCount,
      peakLineBytes: Math.max(trainingSpool.peakLineBytes, predictionSpool.peakLineBytes),
      maximumCellFeatureCount: plan.maximumCellFeatureCount,
      workModelVersion: PREDICTION_V4_WORK_MODEL_VERSION,
      producerAndVerifierMathWorkUnits: plan.producerAndVerifierMathWorkUnits,
      producerAndVerifierTrainingSpoolReplayPasses: 8,
      producerAndVerifierTrainingSpoolReplayRows: 160,
      verificationPredictionStreamReadRows: 88,
      verificationPredictionStreamComparisonRows: 44,
    });
    const ownedPredictionSpool = predictionSpool;
    predictionSpool = undefined;
    const artifact: ProducedMultiwayPredictionSetV4 = recursivelyFreeze({
      contractVersion: 'produced_synthetic_multiway_prediction_set_v4',
      bundle,
      modelBundleRaw: `${canonicalWireJsonV1(bundle)}\n`,
      manifest,
      predictionSetManifestRaw: `${canonicalWireJsonV1(manifest)}\n`,
      predictionStream: ownedPredictionSpool.stream,
      artifactState: 'pre_publish',
      diagnostics,
      dispose: ownedPredictionSpool.cleanup,
    });
    return { status: 'produced', artifact };
  } catch (error) {
    return reject(stableBlocker(error));
  } finally {
    await trainingSpool?.cleanup().catch(() => undefined);
    await predictionSpool?.cleanup().catch(() => undefined);
  }
}

function parseCanonicalRaw<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  blocker: string,
): T {
  if (typeof raw !== 'string') throw new Error(blocker);
  const bytes = Buffer.byteLength(raw);
  if (
    bytes === 0
    || bytes > PREDICTION_V4_RESOURCE_LIMITS.maximumLineBytes + 1
    || !raw.endsWith('\n')
    || raw.slice(0, -1).includes('\n')
  ) throw new Error(blocker);
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(0, -1));
  } catch {
    throw new Error(blocker);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || `${canonicalWireJsonV1(parsed.data)}\n` !== raw) {
    throw new Error(blocker);
  }
  return parsed.data;
}

function isolateSuppliedPredictionStream(factory: ByteStreamFactoryV2): ByteStreamFactoryV2 {
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
          const done = Boolean(Reflect.get(candidate, 'done'));
          if (done) return;
          next = {
            done: false,
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
        // A hostile supplied stream cannot replace the verifier result.
      }
    }
  }());
}

async function compareAndCaptureCanonicalStreams(
  supplied: ByteStreamFactoryV2,
  expected: ByteStreamFactoryV2,
): Promise<ByteStreamFactoryV2 | undefined> {
  const left = readCanonicalSpoolRecordsV2(
    isolateSuppliedPredictionStream(supplied),
    SPOOL_LIMITS_V4,
  )[Symbol.asyncIterator]();
  const right = readCanonicalSpoolRecordsV2(expected, SPOOL_LIMITS_V4)[Symbol.asyncIterator]();
  const lines: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      let leftEntry: Awaited<ReturnType<typeof left.next>>;
      try {
        leftEntry = await left.next();
      } catch (error) {
        if (error instanceof Error
          && error.message === 'prediction_spool_resource_limit_exceeded') {
          throw new Error('resource_limit_exceeded');
        }
        throw new SuppliedPredictionStreamError();
      }
      const rightEntry = await right.next();
      if (leftEntry.done || rightEntry.done) {
        if (leftEntry.done !== rightEntry.done) return undefined;
        const captured = Object.freeze([...lines]);
        return () => (async function* verifiedPredictionStream() {
          for (const line of captured) yield line;
        }());
      }
      const parsed = multiwayPredictionRecordV4Schema.safeParse(leftEntry.value.value);
      if (!parsed.success || leftEntry.value.raw !== rightEntry.value.raw) return undefined;
      const line = `${leftEntry.value.raw}\n`;
      const lineBytes = Buffer.byteLength(line);
      if (lineBytes > SPOOL_LIMITS_V4.maxFileBytes - bytes) {
        throw new Error('resource_limit_exceeded');
      }
      bytes += lineBytes;
      lines.push(line);
    }
  } finally {
    await Promise.allSettled([left.return?.(undefined), right.return?.(undefined)]);
  }
}

const verifiedReplayBindings = new WeakMap<object, Readonly<{
  predictionStream: ByteStreamFactoryV2;
  spoolLimits: typeof SPOOL_LIMITS_V4;
}>>();

export async function produceMultiwayPredictionSetV4(
  raw: unknown,
): Promise<ProduceMultiwayPredictionResultV4> {
  const normalized = normalizeInput(raw);
  if ('blocker' in normalized) return reject(normalized.blocker);
  return buildArtifacts(normalized.input);
}

export async function verifyMultiwayPredictionSetV4(
  raw: unknown,
): Promise<VerifyMultiwayPredictionResultV4> {
  const normalized = normalizeInput(raw);
  if ('blocker' in normalized) return reject(normalized.blocker);
  let expected: ProducedMultiwayPredictionSetV4 | undefined;
  try {
    const modelRawValue = safeGet(raw, 'modelBundleRaw');
    if (!modelRawValue.ok) return reject('prediction_v4_supplied_artifact_mismatch');
    const manifestRawValue = safeGet(raw, 'predictionSetManifestRaw');
    if (!manifestRawValue.ok) return reject('prediction_v4_supplied_artifact_mismatch');
    const streamValue = safeGet(raw, 'predictionStream');
    if (!streamValue.ok || typeof streamValue.value !== 'function') {
      return reject('prediction_v4_supplied_artifact_mismatch');
    }
    const suppliedBundle = parseCanonicalRaw(
      modelRawValue.value,
      multiwayCrossFittedModelBundleV4Schema,
      'prediction_v4_supplied_artifact_mismatch',
    );
    const suppliedManifest = parseCanonicalRaw(
      manifestRawValue.value,
      multiwayPredictionSetManifestV4Schema,
      'prediction_v4_supplied_artifact_mismatch',
    );
    const rebuilt = await buildArtifacts(normalized.input);
    if (rebuilt.status !== 'produced') return rebuilt;
    expected = rebuilt.artifact;
    if (
      !same(suppliedBundle, expected.bundle)
      || !same(suppliedManifest, expected.manifest)
      || modelRawValue.value !== expected.modelBundleRaw
      || manifestRawValue.value !== expected.predictionSetManifestRaw
    ) return reject('prediction_v4_supplied_artifact_mismatch');
    const verifiedStream = await compareAndCaptureCanonicalStreams(
      streamValue.value as ByteStreamFactoryV2,
      expected.predictionStream,
    );
    if (!verifiedStream) return reject('prediction_v4_supplied_artifact_mismatch');

    const receiptPreimage = {
      contractVersion: 'synthetic_multiway_prediction_verification_receipt_v4' as const,
      verifierVersion: 'synthetic_multiway_prediction_set_verifier_v4' as const,
      predictionSetVersion: expected.manifest.predictionSetVersion,
      modelBundleSha256: expected.manifest.modelBundleSha256,
      predictionStreamSha256: expected.manifest.predictionStreamSha256,
      sourcePredictionSetVersion: expected.manifest.sourcePredictionSetVersion,
      sourcePredictionVerificationReceiptSha256:
        expected.manifest.sourcePredictionVerificationReceiptSha256,
      snapshotManifestSha256: expected.manifest.snapshotManifestSha256,
      targetManifestSha256: expected.manifest.targetManifestSha256,
      targetVerificationReceiptSha256:
        expected.manifest.targetVerificationReceiptSha256,
      decisionContextEvidenceSha256: expected.manifest.decisionContextEvidenceSha256,
      syntheticDecisionLogRootSha256: expected.manifest.syntheticDecisionLogRootSha256,
      syntheticOutcomeEvidenceRootSha256:
        expected.manifest.syntheticOutcomeEvidenceRootSha256,
      viewerHoldoutPlanSha256: expected.manifest.viewerHoldoutPlanSha256,
      phase18ProvenanceSha256: expected.manifest.phase18ProvenanceSha256,
      phase18PlanSha256: expected.manifest.phase18PlanSha256,
      viewerMembershipSha256: expected.manifest.viewerMembershipSha256,
      timeMembershipSha256: expected.manifest.timeMembershipSha256,
      trainingConfigSha256: expected.manifest.trainingConfigSha256,
      resourceLimitsVersion: PREDICTION_V4_RESOURCE_LIMITS_VERSION,
      resourceLimitsSha256: expected.manifest.resourceLimitsSha256,
      runtimeConfigVersion: PREDICTION_V4_RUNTIME_CONFIG_VERSION,
      runtimeConfigSha256: expected.manifest.runtimeConfigSha256,
      rowOrder: PREDICTION_V4_ROW_ORDER,
      rewardDefinitionSha256: expected.manifest.rewardDefinitionSha256,
      trainingApplied: true as const,
      trainingEvidenceScope: PREDICTION_V4_TRAINING_EVIDENCE_SCOPE,
      multiwayQHatProvenanceStatus: 'verified_synthetic_only' as const,
      commonTimeShockHandlingVerified: false as const,
      decisionCount: 4 as const,
      viewerClusterCount: 2 as const,
      timeClusterCount: 2 as const,
      evaluationCellCount: 4 as const,
      stepCount: 8 as const,
      predictionCount: 20 as const,
      trainingRowCount: 20 as const,
      labelRowCount: 8 as const,
      combinedSpoolRecordCount: 64 as const,
      combinedSpoolByteCount: expected.diagnostics.combinedSpoolByteCount,
      workModelVersion: PREDICTION_V4_WORK_MODEL_VERSION,
      producerAndVerifierMathWorkUnits:
        expected.diagnostics.producerAndVerifierMathWorkUnits,
      producerAndVerifierTrainingSpoolReplayPasses: 8 as const,
      producerAndVerifierTrainingSpoolReplayRows: 160 as const,
      verificationPredictionStreamReadRows: 88 as const,
      verificationPredictionStreamComparisonRows: 44 as const,
      candidateEvidenceEligible: false as const,
      qualificationEvidenceEligible: false as const,
      realDatasetEligible: false as const,
      servable: false as const,
    };
    const receipt: MultiwayPredictionVerificationReceiptV4 = recursivelyFreeze({
      ...receiptPreimage,
      receiptSha256: digest(receiptPreimage),
    });
    const predictionSet: VerifiedMultiwayPredictionSetV4 = recursivelyFreeze({
      contractVersion: 'verified_synthetic_multiway_prediction_set_v4',
      manifest: expected.manifest,
      receipt,
      trainingApplied: true,
      trainingEvidenceScope: PREDICTION_V4_TRAINING_EVIDENCE_SCOPE,
      multiwayQHatProvenanceStatus: 'verified_synthetic_only',
      candidateEvidenceEligible: false,
      qualificationEvidenceEligible: false,
      realDatasetEligible: false,
      servable: false,
    });
    verifiedSets.add(predictionSet);
    receiptOwners.set(predictionSet, receipt.receiptSha256);
    verifiedReplayBindings.set(predictionSet, Object.freeze({
      predictionStream: verifiedStream,
      spoolLimits: SPOOL_LIMITS_V4,
    }));
    return { status: 'verified', predictionSet };
  } catch (error) {
    return reject(stableBlocker(error));
  } finally {
    await expected?.dispose().catch(() => undefined);
  }
}

export function isVerifiedMultiwayPredictionSetV4(
  value: unknown,
): value is VerifiedMultiwayPredictionSetV4 {
  if (!value || typeof value !== 'object' || !verifiedSets.has(value)) return false;
  try {
    const typed = value as VerifiedMultiwayPredictionSetV4;
    const { receiptSha256: _ignored, ...receiptPreimage } = typed.receipt;
    return receiptOwners.get(value) === typed.receipt.receiptSha256
      && digest(receiptPreimage) === typed.receipt.receiptSha256
      && typed.manifest.predictionSetVersion === typed.receipt.predictionSetVersion
      && recursivelyFrozen(value);
  } catch {
    return false;
  }
}

export function multiwayPredictionSetReplayBindingV4(
  value: unknown,
): Readonly<{
  predictionStream: ByteStreamFactoryV2;
  spoolLimits: typeof SPOOL_LIMITS_V4;
}> | undefined {
  if (!isVerifiedMultiwayPredictionSetV4(value)) return undefined;
  return verifiedReplayBindings.get(value);
}
