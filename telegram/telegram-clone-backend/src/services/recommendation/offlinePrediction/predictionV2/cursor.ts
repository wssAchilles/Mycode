import { createHash } from 'crypto';

import {
  isVerifiedCrossFittedPredictionSetV2,
  predictionSetReplayBindingV2,
} from './artifacts';
import {
  predictionRecordV2Schema,
  type PredictionRecordV2,
  type VerifiedCrossFittedPredictionSetV2,
  type VerifiedPredictionCursorV2,
  type VerifiedPredictionStepV2,
} from './contracts';
import {
  createCanonicalSpoolWriterV2,
  readCanonicalSpoolRecordsV2,
  type CanonicalSpoolV2,
} from './spool';

type CursorMetadata = {
  predictionSet: VerifiedCrossFittedPredictionSetV2;
  spool: CanonicalSpoolV2;
  iterator: AsyncIterator<{ value: unknown; raw: string }>;
  initialized: boolean;
  nextPosition: number;
  terminalBlocker?: string;
  closed: boolean;
};

const cursors = new WeakMap<object, CursorMetadata>();
const steps = new WeakSet<object>();
const stepOwners = new WeakMap<object, VerifiedPredictionCursorV2>();

export async function openVerifiedPredictionCursorV2(
  predictionSet: VerifiedCrossFittedPredictionSetV2,
): Promise<{ status: 'opened'; cursor: VerifiedPredictionCursorV2 }
  | { status: 'not_evaluable'; blocker: string }> {
  if (!isVerifiedCrossFittedPredictionSetV2(predictionSet)) {
    return { status: 'not_evaluable', blocker: 'prediction_v2_verified_brand_missing' };
  }
  const binding = predictionSetReplayBindingV2(predictionSet);
  if (!binding) return { status: 'not_evaluable', blocker: 'prediction_v2_verified_brand_missing' };
  const writer = await createCanonicalSpoolWriterV2(binding.spoolLimits);
  try {
    const grammar = createGrammarValidator(predictionSet);
    for await (const entry of readCanonicalSpoolRecordsV2(
      binding.predictionStream,
      binding.spoolLimits,
    )) {
      const parsed = predictionRecordV2Schema.safeParse(entry.value);
      if (!parsed.success) throw new Error('prediction_v2_cursor_contract_invalid');
      grammar.consume(parsed.data, entry.raw);
      await writer.write(parsed.data);
    }
    grammar.finish();
    const spool = await writer.finish();
    if (
      spool.sha256 !== predictionSet.manifest.predictionStreamSha256
      || spool.recordCount !== predictionSet.manifest.physicalRecordCount
    ) {
      await spool.cleanup();
      return { status: 'not_evaluable', blocker: 'prediction_v2_cursor_digest_mismatch' };
    }
    const cursor = Object.freeze({ contractVersion: 'verified_prediction_cursor_v2' as const });
    cursors.set(cursor, {
      predictionSet,
      spool,
      iterator: readCanonicalSpoolRecordsV2(spool.stream, binding.spoolLimits)[Symbol.asyncIterator](),
      initialized: false,
      nextPosition: 1,
      closed: false,
    });
    return { status: 'opened', cursor };
  } catch (error) {
    await writer.abort();
    return { status: 'not_evaluable', blocker: cursorBlocker(error) };
  }
}

export async function readVerifiedPredictionStepV2(
  cursor: VerifiedPredictionCursorV2,
  expected: { decisionId: string; servedPosition: number },
): Promise<{ status: 'verified'; step: VerifiedPredictionStepV2 }
  | { status: 'not_evaluable'; blocker: string }> {
  const metadata = cursors.get(cursor);
  if (!metadata || metadata.closed) {
    return { status: 'not_evaluable', blocker: 'prediction_v2_cursor_brand_missing' };
  }
  if (metadata.terminalBlocker) {
    return { status: 'not_evaluable', blocker: metadata.terminalBlocker };
  }
  try {
    if (expected.servedPosition !== metadata.nextPosition) {
      return poison(metadata, 'prediction_v2_cursor_order_mismatch');
    }
    if (!metadata.initialized) {
      const start = await nextRecord(metadata);
      if (start.recordType !== 'decision_start' || start.decisionId !== expected.decisionId) {
        return poison(metadata, 'prediction_v2_cursor_order_mismatch');
      }
      metadata.initialized = true;
    }
    const start = await nextRecord(metadata);
    if (
      start.recordType !== 'step_start'
      || start.decisionId !== expected.decisionId
      || start.servedPosition !== expected.servedPosition
    ) return poison(metadata, 'prediction_v2_cursor_order_mismatch');
    const qHat: VerifiedPredictionStepV2['qHat'] = [];
    for (let index = 0; index < start.expectedActionCount; index += 1) {
      const prediction = await nextRecord(metadata);
      if (
        prediction.recordType !== 'prediction'
        || prediction.decisionId !== expected.decisionId
        || prediction.servedPosition !== expected.servedPosition
      ) return poison(metadata, 'prediction_v2_cursor_order_mismatch');
      qHat.push({ actionKey: prediction.actionKey, value: prediction.qHat });
    }
    const end = await nextRecord(metadata);
    if (
      end.recordType !== 'step_end'
      || end.decisionId !== expected.decisionId
      || end.servedPosition !== expected.servedPosition
      || end.actualActionCount !== qHat.length
    ) return poison(metadata, 'prediction_v2_cursor_order_mismatch');
    const step = recursivelyFreeze({
      contractVersion: 'verified_prediction_step_v2' as const,
      predictionSetVersion: metadata.predictionSet.manifest.predictionSetVersion,
      verificationReceiptSha256: metadata.predictionSet.receipt.receiptSha256,
      decisionId: expected.decisionId,
      servedPosition: expected.servedPosition,
      qHat,
    });
    steps.add(step);
    stepOwners.set(step, cursor);
    metadata.nextPosition += 1;
    return { status: 'verified', step };
  } catch (error) {
    return poison(metadata, cursorBlocker(error));
  }
}

export function isVerifiedPredictionStepV2(
  value: unknown,
): value is VerifiedPredictionStepV2 {
  try {
    if (!value || typeof value !== 'object' || !recursivelyFrozen(value)) return false;
    const owner = stepOwners.get(value);
    const metadata = owner && cursors.get(owner);
    const candidate = value as VerifiedPredictionStepV2;
    return steps.has(value)
      && metadata !== undefined
      && !metadata.closed
      && !metadata.terminalBlocker
      && candidate.predictionSetVersion === metadata.predictionSet.manifest.predictionSetVersion
      && candidate.verificationReceiptSha256 === metadata.predictionSet.receipt.receiptSha256;
  } catch {
    return false;
  }
}

export async function closeVerifiedPredictionCursorV2(
  cursor: VerifiedPredictionCursorV2,
): Promise<void> {
  const metadata = cursors.get(cursor);
  if (!metadata || metadata.closed) return;
  metadata.closed = true;
  try {
    await metadata.iterator.return?.();
  } finally {
    await metadata.spool.cleanup();
  }
}

async function nextRecord(metadata: CursorMetadata): Promise<PredictionRecordV2> {
  const next = await metadata.iterator.next();
  if (next.done) throw new Error('prediction_v2_cursor_unexpected_eof');
  const parsed = predictionRecordV2Schema.safeParse(next.value.value);
  if (!parsed.success) throw new Error('prediction_v2_cursor_contract_invalid');
  return parsed.data;
}

function createGrammarValidator(predictionSet: VerifiedCrossFittedPredictionSetV2) {
  let state: 'decision_start' | 'step_start' | 'prediction_or_end' | 'decision_end' | 'done' = 'decision_start';
  let decisionId = '';
  let expectedSteps = 0;
  let stepCount = 0;
  let expectedActions = 0;
  let actionCount = 0;
  let predictionCount = 0;
  let stepHash = createHash('sha256');
  let decisionHash = createHash('sha256');
  return {
    consume(record: PredictionRecordV2, raw: string) {
      const line = `${raw}\n`;
      if (state === 'decision_start') {
        if (
          record.recordType !== 'decision_start'
          || record.modelBundleSha256 !== predictionSet.manifest.modelBundleSha256
        ) throw new Error('prediction_v2_cursor_grammar_invalid');
        decisionId = record.decisionId;
        expectedSteps = record.expectedStepCount;
        decisionHash.update(line);
        state = 'step_start';
        return;
      }
      if (state === 'step_start') {
        if (
          record.recordType !== 'step_start'
          || record.decisionId !== decisionId
          || record.servedPosition !== stepCount + 1
        ) throw new Error('prediction_v2_cursor_grammar_invalid');
        expectedActions = record.expectedActionCount;
        actionCount = 0;
        stepHash = createHash('sha256').update(line);
        decisionHash.update(line);
        state = 'prediction_or_end';
        return;
      }
      if (state === 'prediction_or_end') {
        if (record.recordType === 'prediction') {
          if (
            record.decisionId !== decisionId
            || record.servedPosition !== stepCount + 1
            || record.actionKey.servedPosition !== stepCount + 1
            || actionCount >= expectedActions
          ) throw new Error('prediction_v2_cursor_grammar_invalid');
          actionCount += 1;
          predictionCount += 1;
          stepHash.update(line);
          decisionHash.update(line);
          return;
        }
        if (
          record.recordType !== 'step_end'
          || record.decisionId !== decisionId
          || record.servedPosition !== stepCount + 1
          || record.actualActionCount !== actionCount
          || actionCount !== expectedActions
          || record.stepSha256 !== stepHash.digest('hex')
        ) throw new Error('prediction_v2_cursor_grammar_invalid');
        decisionHash.update(line);
        stepCount += 1;
        state = stepCount === expectedSteps ? 'decision_end' : 'step_start';
        return;
      }
      if (state === 'decision_end') {
        if (
          record.recordType !== 'decision_end'
          || record.decisionId !== decisionId
          || record.actualStepCount !== stepCount
          || record.actualPredictionCount !== predictionCount
          || record.decisionSha256 !== decisionHash.digest('hex')
        ) throw new Error('prediction_v2_cursor_grammar_invalid');
        state = 'done';
        return;
      }
      throw new Error('prediction_v2_cursor_grammar_invalid');
    },
    finish() {
      if (
        state !== 'done'
        || stepCount !== predictionSet.manifest.stepCount
        || predictionCount !== predictionSet.manifest.predictionCount
      ) throw new Error('prediction_v2_cursor_grammar_invalid');
    },
  };
}

function poison(metadata: CursorMetadata, blocker: string) {
  metadata.terminalBlocker ??= blocker;
  return { status: 'not_evaluable' as const, blocker: metadata.terminalBlocker };
}

function cursorBlocker(error: unknown): string {
  const blocker = error instanceof Error ? error.message : '';
  return blocker.startsWith('prediction_v2_cursor_')
    || blocker === 'prediction_spool_resource_limit_exceeded'
    ? blocker
    : 'prediction_v2_cursor_io_failed';
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
