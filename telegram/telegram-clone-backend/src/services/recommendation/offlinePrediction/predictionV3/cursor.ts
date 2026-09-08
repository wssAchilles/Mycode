import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  createCanonicalSpoolWriterV2,
  readCanonicalSpoolRecordsV2,
  type CanonicalSpoolV2,
} from '../predictionV2/spool';
import {
  cohortPredictionSetReplayBindingV3,
  isVerifiedCrossFittedCohortPredictionSetV3,
} from './artifacts';
import {
  cohortPredictionRecordV3Schema,
  type CohortPredictionRecordV3,
  type VerifiedCohortPredictionCursorV3,
  type VerifiedCohortPredictionStepV3,
  type VerifiedCrossFittedCohortPredictionSetV3,
} from './contracts';

type ParsedDecisionStartRecord = Extract<
  CohortPredictionRecordV3,
  { recordType: 'decision_start' }
>;
type DecisionStartRecord = ParsedDecisionStartRecord;

type CursorMetadata = {
  predictionSet: VerifiedCrossFittedCohortPredictionSetV3;
  spool: CanonicalSpoolV2;
  iterator: AsyncIterator<{ value: unknown; raw: string }>;
  currentDecision?: DecisionStartRecord;
  nextPosition: number;
  currentPredictionCount: number;
  completedDecisionCount: number;
  terminalBlocker?: string;
  closed: boolean;
};

const cursors = new WeakMap<object, CursorMetadata>();
const steps = new WeakSet<object>();
const stepOwners = new WeakMap<object, VerifiedCohortPredictionCursorV3>();

export async function openVerifiedCohortPredictionCursorV3(
  predictionSet: VerifiedCrossFittedCohortPredictionSetV3,
): Promise<{ status: 'opened'; cursor: VerifiedCohortPredictionCursorV3 }
  | { status: 'not_evaluable'; blocker: string }> {
  if (!isVerifiedCrossFittedCohortPredictionSetV3(predictionSet)) {
    return { status: 'not_evaluable', blocker: 'prediction_v3_verified_brand_missing' };
  }
  const binding = cohortPredictionSetReplayBindingV3(predictionSet);
  if (!binding) {
    return { status: 'not_evaluable', blocker: 'prediction_v3_verified_brand_missing' };
  }
  let writer: Awaited<ReturnType<typeof createCanonicalSpoolWriterV2>> | undefined;
  try {
    writer = await createCanonicalSpoolWriterV2(binding.spoolLimits);
    const grammar = createGrammarValidator(predictionSet);
    for await (const entry of readCanonicalSpoolRecordsV2(
      binding.predictionStream,
      binding.spoolLimits,
    )) {
      const parsed = cohortPredictionRecordV3Schema.safeParse(entry.value);
      if (!parsed.success) throw new Error('prediction_v3_cursor_contract_invalid');
      grammar.consume(parsed.data, entry.raw);
      await writer.write(parsed.data);
    }
    grammar.finish();
    const spool = await writer.finish();
    if (
      spool.sha256 !== predictionSet.manifest.predictionStreamSha256
      || spool.recordCount !== predictionSet.manifest.physicalRecordCount
    ) {
      await spool.cleanup().catch(() => undefined);
      return { status: 'not_evaluable', blocker: 'prediction_v3_cursor_digest_mismatch' };
    }
    const cursor = Object.freeze({
      contractVersion: 'verified_cohort_prediction_cursor_v3' as const,
    });
    cursors.set(cursor, {
      predictionSet,
      spool,
      iterator: readCanonicalSpoolRecordsV2(
        spool.stream,
        binding.spoolLimits,
      )[Symbol.asyncIterator](),
      nextPosition: 1,
      currentPredictionCount: 0,
      completedDecisionCount: 0,
      closed: false,
    });
    return { status: 'opened', cursor };
  } catch (error) {
    try {
      await writer?.abort();
    } catch {
      // The cursor remains unopened; preserve the primary stable blocker.
    }
    return { status: 'not_evaluable', blocker: cursorBlocker(error) };
  }
}

export async function readVerifiedCohortPredictionStepV3(
  cursor: VerifiedCohortPredictionCursorV3,
  expected: { decisionId: string; servedPosition: number },
): Promise<{ status: 'verified'; step: VerifiedCohortPredictionStepV3 }
  | { status: 'not_evaluable'; blocker: string }> {
  const metadata = cursors.get(cursor);
  if (!metadata || metadata.closed) {
    return { status: 'not_evaluable', blocker: 'prediction_v3_cursor_brand_missing' };
  }
  if (metadata.terminalBlocker) {
    return { status: 'not_evaluable', blocker: metadata.terminalBlocker };
  }
  try {
    const decision = await prepareDecision(metadata);
    if (
      decision.decisionId !== expected.decisionId
      || expected.servedPosition !== metadata.nextPosition
    ) return poison(metadata, 'prediction_v3_cursor_order_mismatch');

    const start = await nextRecord(metadata);
    if (
      start.recordType !== 'step_start'
      || start.decisionId !== expected.decisionId
      || start.servedPosition !== expected.servedPosition
    ) return poison(metadata, 'prediction_v3_cursor_order_mismatch');

    const qHat: VerifiedCohortPredictionStepV3['qHat'] = [];
    for (let index = 0; index < start.expectedActionCount; index += 1) {
      const prediction = await nextRecord(metadata);
      if (
        prediction.recordType !== 'prediction'
        || prediction.decisionId !== expected.decisionId
        || prediction.servedPosition !== expected.servedPosition
        || prediction.foldId !== decision.foldId
      ) return poison(metadata, 'prediction_v3_cursor_order_mismatch');
      qHat.push({ actionKey: prediction.actionKey, value: prediction.qHat });
    }

    const end = await nextRecord(metadata);
    if (
      end.recordType !== 'step_end'
      || end.decisionId !== expected.decisionId
      || end.servedPosition !== expected.servedPosition
      || end.actualActionCount !== qHat.length
    ) return poison(metadata, 'prediction_v3_cursor_order_mismatch');

    const step = recursivelyFreeze({
      contractVersion: 'verified_cohort_prediction_step_v3' as const,
      predictionSetVersion: metadata.predictionSet.manifest.predictionSetVersion,
      verificationReceiptSha256: metadata.predictionSet.receipt.receiptSha256,
      decisionId: decision.decisionId,
      requestId: decision.requestId,
      inferenceClusterId: decision.inferenceClusterId,
      clusterUnitVersion: decision.clusterUnitVersion,
      foldId: decision.foldId,
      servedPosition: expected.servedPosition,
      qHat,
    });
    steps.add(step);
    stepOwners.set(step, cursor);
    metadata.nextPosition += 1;
    metadata.currentPredictionCount += qHat.length;
    return { status: 'verified', step };
  } catch (error) {
    return poison(metadata, cursorBlocker(error));
  }
}

export function isVerifiedCohortPredictionStepV3(
  value: unknown,
): value is VerifiedCohortPredictionStepV3 {
  try {
    if (!value || typeof value !== 'object' || !steps.has(value)) return false;
    if (!recursivelyFrozen(value)) return false;
    const owner = stepOwners.get(value);
    const metadata = owner && cursors.get(owner);
    const candidate = value as VerifiedCohortPredictionStepV3;
    return metadata !== undefined
      && !metadata.closed
      && !metadata.terminalBlocker
      && candidate.predictionSetVersion === metadata.predictionSet.manifest.predictionSetVersion
      && candidate.verificationReceiptSha256 === metadata.predictionSet.receipt.receiptSha256;
  } catch {
    return false;
  }
}

export async function closeVerifiedCohortPredictionCursorV3(
  cursor: VerifiedCohortPredictionCursorV3,
): Promise<void> {
  const metadata = cursors.get(cursor);
  if (!metadata || metadata.closed) return;
  metadata.closed = true;
  try {
    await metadata.iterator.return?.();
  } finally {
    await metadata.spool.cleanup().catch(() => undefined);
  }
}

async function prepareDecision(metadata: CursorMetadata): Promise<DecisionStartRecord> {
  const current = metadata.currentDecision;
  if (current && metadata.nextPosition <= current.expectedStepCount) return current;

  if (current) {
    const end = await nextRecord(metadata);
    if (
      end.recordType !== 'decision_end'
      || end.decisionId !== current.decisionId
      || end.actualStepCount !== current.expectedStepCount
      || end.actualPredictionCount !== metadata.currentPredictionCount
    ) throw new Error('prediction_v3_cursor_order_mismatch');
    metadata.completedDecisionCount += 1;
    metadata.currentDecision = undefined;
    metadata.nextPosition = 1;
    metadata.currentPredictionCount = 0;
  }

  if (metadata.completedDecisionCount >= metadata.predictionSet.manifest.decisionCount) {
    throw new Error('prediction_v3_cursor_order_mismatch');
  }
  const start = await nextRecord(metadata);
  if (
    start.recordType !== 'decision_start'
    || (start.foldId !== 0 && start.foldId !== 1)
    || start.modelBundleSha256 !== metadata.predictionSet.manifest.modelBundleSha256
  ) throw new Error('prediction_v3_cursor_order_mismatch');
  const decision = start as DecisionStartRecord;
  metadata.currentDecision = decision;
  return decision;
}

async function nextRecord(metadata: CursorMetadata): Promise<CohortPredictionRecordV3> {
  const next = await metadata.iterator.next();
  if (next.done) throw new Error('prediction_v3_cursor_unexpected_eof');
  const parsed = cohortPredictionRecordV3Schema.safeParse(next.value.value);
  if (!parsed.success) throw new Error('prediction_v3_cursor_contract_invalid');
  return parsed.data;
}

function createGrammarValidator(predictionSet: VerifiedCrossFittedCohortPredictionSetV3) {
  let state: 'decision_start' | 'step_start' | 'prediction_or_end' | 'decision_end' =
    'decision_start';
  let decisionId = '';
  let previousDecisionId: string | undefined;
  let decisionFoldId = 0;
  let expectedSteps = 0;
  let decisionStepCount = 0;
  let expectedActions = 0;
  let actionCount = 0;
  let decisionPredictionCount = 0;
  let decisionCount = 0;
  let stepCount = 0;
  let predictionCount = 0;
  let previousActionIdentity: string | undefined;
  let stepHash = createHash('sha256');
  let decisionHash = createHash('sha256');
  const inferenceClusterIds = new Set<string>();
  const assignments = new Map<string, { inferenceClusterId: string; foldId: number }>();
  for (const assignment of predictionSet.holdoutPlan.assignments) {
    for (const assignedDecisionId of assignment.decisionIds) {
      assignments.set(assignedDecisionId, {
        inferenceClusterId: assignment.inferenceClusterId,
        foldId: assignment.foldId,
      });
    }
  }

  return {
    consume(record: CohortPredictionRecordV3, raw: string) {
      const line = `${raw}\n`;
      if (state === 'decision_start') {
        const assignment = record.recordType === 'decision_start'
          ? assignments.get(record.decisionId)
          : undefined;
        if (
          record.recordType !== 'decision_start'
          || decisionCount >= predictionSet.manifest.decisionCount
          || record.modelBundleSha256 !== predictionSet.manifest.modelBundleSha256
          || (previousDecisionId !== undefined
            && compareText(previousDecisionId, record.decisionId) >= 0)
          || !assignment
          || assignment.inferenceClusterId !== record.inferenceClusterId
          || assignment.foldId !== record.foldId
        ) throw new Error('prediction_v3_cursor_grammar_invalid');
        decisionId = record.decisionId;
        decisionFoldId = record.foldId;
        expectedSteps = record.expectedStepCount;
        decisionStepCount = 0;
        decisionPredictionCount = 0;
        inferenceClusterIds.add(record.inferenceClusterId);
        decisionHash = createHash('sha256').update(line);
        state = 'step_start';
        return;
      }
      if (state === 'step_start') {
        if (
          record.recordType !== 'step_start'
          || record.decisionId !== decisionId
          || record.servedPosition !== decisionStepCount + 1
          || decisionStepCount >= expectedSteps
        ) throw new Error('prediction_v3_cursor_grammar_invalid');
        expectedActions = record.expectedActionCount;
        actionCount = 0;
        previousActionIdentity = undefined;
        stepHash = createHash('sha256').update(line);
        decisionHash.update(line);
        state = 'prediction_or_end';
        return;
      }
      if (state === 'prediction_or_end') {
        if (record.recordType === 'prediction') {
          const identity = actionIdentity(record.actionKey);
          if (
            record.decisionId !== decisionId
            || record.servedPosition !== decisionStepCount + 1
            || record.actionKey.servedPosition !== decisionStepCount + 1
            || record.foldId !== decisionFoldId
            || actionCount >= expectedActions
            || (previousActionIdentity !== undefined
              && compareText(previousActionIdentity, identity) >= 0)
          ) throw new Error('prediction_v3_cursor_grammar_invalid');
          actionCount += 1;
          decisionPredictionCount += 1;
          predictionCount += 1;
          previousActionIdentity = identity;
          stepHash.update(line);
          decisionHash.update(line);
          return;
        }
        if (
          record.recordType !== 'step_end'
          || record.decisionId !== decisionId
          || record.servedPosition !== decisionStepCount + 1
          || record.actualActionCount !== actionCount
          || actionCount !== expectedActions
          || record.stepSha256 !== stepHash.digest('hex')
        ) throw new Error('prediction_v3_cursor_grammar_invalid');
        decisionHash.update(line);
        decisionStepCount += 1;
        stepCount += 1;
        state = decisionStepCount === expectedSteps ? 'decision_end' : 'step_start';
        return;
      }
      if (
        record.recordType !== 'decision_end'
        || record.decisionId !== decisionId
        || record.actualStepCount !== decisionStepCount
        || record.actualPredictionCount !== decisionPredictionCount
        || record.decisionSha256 !== decisionHash.digest('hex')
      ) throw new Error('prediction_v3_cursor_grammar_invalid');
      decisionCount += 1;
      previousDecisionId = decisionId;
      state = 'decision_start';
    },
    finish() {
      if (
        state !== 'decision_start'
        || decisionCount !== predictionSet.manifest.decisionCount
        || stepCount !== predictionSet.manifest.stepCount
        || predictionCount !== predictionSet.manifest.predictionCount
        || inferenceClusterIds.size !== predictionSet.manifest.viewerClusterCount
      ) throw new Error('prediction_v3_cursor_grammar_invalid');
    },
  };
}

function actionIdentity(
  actionKey: Extract<CohortPredictionRecordV3, { recordType: 'prediction' }>['actionKey'],
): string {
  return canonicalDecisionJson(actionKey);
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function poison(metadata: CursorMetadata, blocker: string) {
  metadata.terminalBlocker ??= blocker;
  return { status: 'not_evaluable' as const, blocker: metadata.terminalBlocker };
}

function cursorBlocker(error: unknown): string {
  const blocker = error instanceof Error ? error.message : '';
  return blocker.startsWith('prediction_v3_cursor_')
    || blocker === 'prediction_spool_resource_limit_exceeded'
    ? blocker
    : 'prediction_v3_cursor_io_failed';
}

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
