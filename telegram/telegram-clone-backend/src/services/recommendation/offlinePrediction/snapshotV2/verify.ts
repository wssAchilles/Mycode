import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import {
  copyBoundedByteStreamChunkV1,
  maximumByteStreamChunksV1,
} from '../artifacts/byteStream';
import { canonicalWireJsonV1, selfSha256V1, sha256Text } from '../artifacts/canonical';
import { encodeOfflineActionFeaturesV1 } from '../features/encode';
import {
  isVerifiedTargetDistributionEvidenceV2,
  replayVerifiedTargetDistributionV2,
  type ByteStreamFactoryV2,
  type VerifiedTargetDistributionEvidenceV2,
} from '../targetEvidence';
import {
  fullSupportPitActionSnapshotManifestV2Schema,
  fullSupportPitActionSnapshotRecordV2Schema,
  type ExpandedSnapshotPositionFeatureV2,
  type FullSupportPitActionSnapshotManifestV2,
  type FullSupportPitActionSnapshotRecordV2,
  type SnapshotPositionReplayTransactionV2,
  type VerifiedFullSupportPitActionSnapshotV2,
  type VerifyFullSupportPitActionSnapshotInputV2,
  type VerifyFullSupportPitActionSnapshotResultV2,
} from './contracts';

const MAX_LINE_BYTES = 1 << 20;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_RECORDS = 4_000_000;

class SnapshotError extends Error {
  constructor(readonly blocker: string) {
    super(blocker);
    this.name = 'SnapshotError';
  }
}

function fail(blocker: string): never { throw new SnapshotError(blocker); }
const identity = (value: { candidateNamespace: string; candidateId: string }): string => (
  `${value.candidateNamespace}\u0000${value.candidateId}`
);
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

class SnapshotReader {
  private iterator?: AsyncIterator<string | Uint8Array>;
  private readonly pending = Buffer.allocUnsafe(MAX_LINE_BYTES);
  private pendingLength = 0;
  private currentChunk = Buffer.alloc(0);
  private currentChunkOffset = 0;
  private ended = false;
  private bytes = 0;
  private records = 0;
  private chunks = 0;
  private readonly maximumChunks = maximumByteStreamChunksV1(MAX_RECORDS);
  private readonly hash = createHash('sha256');

  constructor(private readonly factory: ByteStreamFactoryV2) {}

  private async readChunk(): Promise<void> {
    if (!this.iterator) {
      const stream = this.factory();
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        fail('snapshot_contract_invalid');
      }
      this.iterator = stream[Symbol.asyncIterator]();
    }
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      if (this.pendingLength !== 0) fail('snapshot_contract_invalid');
      return;
    }
    const copied = copyBoundedByteStreamChunkV1(
      next.value,
      MAX_FILE_BYTES - this.bytes,
      this.maximumChunks - this.chunks,
    );
    if (copied.status === 'invalid') fail('snapshot_contract_invalid');
    if (copied.status === 'resource_limit_exceeded') fail('resource_limit_exceeded');
    this.chunks += 1;
    const chunk = copied.chunk;
    this.bytes += copied.byteLength;
    this.hash.update(chunk);
    this.currentChunk = chunk;
    this.currentChunkOffset = 0;
  }

  async nextLine(): Promise<string | undefined> {
    while (true) {
      if (this.currentChunkOffset < this.currentChunk.length) {
        const newline = this.currentChunk.indexOf(0x0a, this.currentChunkOffset);
        const segmentEnd = newline < 0 ? this.currentChunk.length : newline;
        const segmentLength = segmentEnd - this.currentChunkOffset;
        if (this.pendingLength + segmentLength > MAX_LINE_BYTES) {
          fail('resource_limit_exceeded');
        }
        this.currentChunk.copy(
          this.pending,
          this.pendingLength,
          this.currentChunkOffset,
          segmentEnd,
        );
        this.pendingLength += segmentLength;
        this.currentChunkOffset = newline < 0 ? segmentEnd : newline + 1;
        if (newline < 0) continue;
        if (this.pendingLength === 0 || this.pending[this.pendingLength - 1] === 0x0d) {
          fail('snapshot_contract_invalid');
        }
        this.records += 1;
        if (this.records > MAX_RECORDS) fail('resource_limit_exceeded');
        try {
          const line = new TextDecoder('utf-8', { fatal: true }).decode(
            this.pending.subarray(0, this.pendingLength),
          );
          this.pendingLength = 0;
          return line;
        } catch {
          fail('snapshot_contract_invalid');
        }
      }
      if (this.ended) return undefined;
      await this.readChunk();
    }
  }

  digest(): string {
    if (!this.ended || this.pendingLength !== 0) fail('snapshot_contract_invalid');
    return this.hash.digest('hex');
  }

  count(): number { return this.records; }

  async close(): Promise<void> {
    if (!this.ended && this.iterator?.return) await this.iterator.return();
    this.ended = true;
    this.pendingLength = 0;
    this.currentChunk = Buffer.alloc(0);
    this.currentChunkOffset = 0;
  }
}

function parseRecord(line: string): FullSupportPitActionSnapshotRecordV2 {
  let value: unknown;
  try { value = JSON.parse(line); } catch { fail('snapshot_contract_invalid'); }
  const parsed = fullSupportPitActionSnapshotRecordV2Schema.safeParse(value);
  if (!parsed.success) fail('snapshot_contract_invalid');
  if (line !== canonicalWireJsonV1(parsed.data)) fail('snapshot_canonical_wire_mismatch');
  return parsed.data;
}

function parseManifest(raw: string): FullSupportPitActionSnapshotManifestV2 {
  if (!raw.endsWith('\n') || Buffer.byteLength(raw) > MAX_LINE_BYTES) {
    fail(Buffer.byteLength(raw) > MAX_LINE_BYTES
      ? 'resource_limit_exceeded'
      : 'snapshot_contract_invalid');
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail('snapshot_contract_invalid'); }
  const parsed = fullSupportPitActionSnapshotManifestV2Schema.safeParse(value);
  if (!parsed.success) fail('snapshot_contract_invalid');
  if (raw !== `${canonicalWireJsonV1(parsed.data)}\n`) fail('snapshot_canonical_wire_mismatch');
  if (selfSha256V1(parsed.data, 'snapshotManifestSha256') !== parsed.data.snapshotManifestSha256) {
    fail('snapshot_manifest_digest_mismatch');
  }
  return parsed.data;
}

type RunSummary = {
  manifest: FullSupportPitActionSnapshotManifestV2;
  snapshotNdjsonSha256: string;
  decisionCount: number;
  candidateBaseCount: number;
  physicalRecordCount: number;
  maxCandidateMembershipCount: number;
};

async function runSnapshotVerification(
  input: VerifyFullSupportPitActionSnapshotInputV2,
  onPositionFeature?: (feature: ExpandedSnapshotPositionFeatureV2) => Promise<void> | void,
): Promise<RunSummary> {
  if (input.sourceKind === 'historical_backfill') {
    fail('full_support_feature_snapshot_unavailable');
  }
  if (input.sourceKind !== 'synthetic_fixture') {
    fail('rust_verification_trust_root_unavailable');
  }
  if (!isVerifiedTargetDistributionEvidenceV2(input.targetEvidence)) {
    fail('rust_verification_trust_root_unavailable');
  }
  const manifest = parseManifest(input.manifestRaw);
  const reader = new SnapshotReader(input.snapshotStream);
  try {
  let decisionCount = 0;
  let candidateBaseCount = 0;
  let maxCandidateMembershipCount = 0;
  type CandidateBase = Extract<FullSupportPitActionSnapshotRecordV2, {
    recordType: 'candidate_base';
  }>;
  let active: {
    targetDecision: import('../targetEvidence').VerifiedTargetDistributionDecisionV2;
    candidates: Map<string, CandidateBase>;
    recordsHash: ReturnType<typeof createHash>;
  } | undefined;
  let targetCallbackFailure: unknown;
  const captureTargetCallback = async (callback: () => Promise<void>): Promise<void> => {
    try {
      await callback();
    } catch (error) {
      targetCallbackFailure = error;
      throw error;
    }
  };

  const targetResult = await replayVerifiedTargetDistributionV2(input.targetEvidence, {
    onDecisionStart: (targetDecision) => captureTargetCallback(async () => {
      const startLine = await reader.nextLine();
      if (startLine === undefined) fail('snapshot_target_membership_mismatch');
      const start = parseRecord(startLine);
      if (start.recordType !== 'decision_start') fail('snapshot_stream_grammar_mismatch');
      if (start.featureDependency === 'prefix_dependent') {
        fail('prefix_feature_snapshot_unavailable');
      }
      const source = targetDecision.source;
      const decisionAt = new Date(source.decisionAt).toISOString();
      const eligible = [...source.candidatePool.candidates]
        .filter((candidate) => candidate.eligible)
        .sort((left, right) => (
          left.poolRank - right.poolRank
          || compareText(left.candidateNamespace, right.candidateNamespace)
          || compareText(left.candidateId, right.candidateId)
        ));
      if (
        start.decisionId !== source.decisionId
        || start.requestId !== source.requestId
        || start.decisionAt !== decisionAt
        || start.decisionLogSha256 !== targetDecision.decisionLogSha256
        || start.candidatePoolSha256 !== targetDecision.candidatePoolSha256
        || start.expectedCandidateCount !== eligible.length
        || canonicalDecisionJson(start.versions) !== canonicalDecisionJson(source.versions)
      ) {
        fail('snapshot_decision_binding_mismatch');
      }
      const recordsHash = createHash('sha256');
      recordsHash.update(`${canonicalDecisionJson(start)}\n`);
      const candidates = new Map<string, CandidateBase>();
      for (let index = 0; index < start.expectedCandidateCount; index += 1) {
        const candidateLine = await reader.nextLine();
        if (candidateLine === undefined) fail('snapshot_stream_grammar_mismatch');
        const candidate = parseRecord(candidateLine);
        if (candidate.recordType !== 'candidate_base') fail('snapshot_stream_grammar_mismatch');
        const expected = eligible[index]!;
        if (
          candidate.decisionId !== source.decisionId
          || candidate.candidateNamespace !== expected.candidateNamespace
          || candidate.candidateId !== expected.candidateId
          || candidate.poolRank !== expected.poolRank
          || selfSha256V1(candidate, 'sourceSha256') !== candidate.sourceSha256
        ) {
          fail('snapshot_candidate_binding_mismatch');
        }
        const featureAt = Date.parse(candidate.featureAt);
        const availableAt = Date.parse(candidate.availableAt);
        const decisionTime = Date.parse(decisionAt);
        if (
          featureAt > availableAt
          || availableAt > decisionTime
          || Date.parse(candidate.featureInput.createdAt) > decisionTime
        ) {
          fail('snapshot_pit_boundary_mismatch');
        }
        const key = identity(candidate);
        if (candidates.has(key)) fail('snapshot_candidate_duplicate');
        candidates.set(key, candidate);
        recordsHash.update(`${canonicalDecisionJson(candidate)}\n`);
      }
      maxCandidateMembershipCount = Math.max(maxCandidateMembershipCount, candidates.size);
      active = { targetDecision, candidates, recordsHash };
    }),
    onStep: (targetDecision, step) => captureTargetCallback(async () => {
      if (!active || active.targetDecision !== targetDecision) {
        fail('snapshot_stream_grammar_mismatch');
      }
      const source = targetDecision.source;
      const decisionAt = new Date(source.decisionAt).toISOString();
      for (const action of step.actions) {
        const candidate = active.candidates.get(identity(action.actionKey));
        if (!candidate) fail('full_support_feature_snapshot_unavailable');
        const encoded = encodeOfflineActionFeaturesV1({
          decisionId: source.decisionId,
          actionKey: action.actionKey,
          decisionAt,
          featureAt: candidate.featureAt,
          referenceAt: decisionAt,
          featureInput: candidate.featureInput,
        });
        if (encoded.status !== 'encoded') fail('snapshot_feature_boundary_mismatch');
        if (onPositionFeature) {
          await onPositionFeature({
            decisionId: source.decisionId,
            servedPosition: step.servedPosition,
            row: encoded.row,
          });
        }
      }
    }),
    onDecisionEnd: (targetDecision) => captureTargetCallback(async () => {
      if (!active || active.targetDecision !== targetDecision) {
        fail('snapshot_stream_grammar_mismatch');
      }
      const candidateCount = active.candidates.size;
      const endLine = await reader.nextLine();
      if (endLine === undefined) fail('snapshot_stream_grammar_mismatch');
      const end = parseRecord(endLine);
      if (
        end.recordType !== 'decision_end'
        || end.decisionId !== targetDecision.source.decisionId
        || end.candidateBaseCount !== candidateCount
        || end.decisionRecordsSha256 !== active.recordsHash.digest('hex')
      ) {
        fail('snapshot_decision_digest_mismatch');
      }
      decisionCount += 1;
      candidateBaseCount += candidateCount;
      active = undefined;
    }),
    commit: () => undefined,
    abort: () => undefined,
  });
  if (targetCallbackFailure !== undefined) throw targetCallbackFailure;
  if (targetResult.status !== 'verified') fail(targetResult.blocker);
  if (active) fail('snapshot_stream_grammar_mismatch');
  if (await reader.nextLine() !== undefined) fail('snapshot_target_membership_mismatch');
  const snapshotDigest = reader.digest();
  const physicalRecordCount = reader.count();
  if (
    manifest.snapshotNdjsonSha256 !== snapshotDigest
    || manifest.targetDistributionNdjsonSha256
      !== input.targetEvidence.receipt.distributionNdjsonSha256
    || manifest.targetManifestSha256 !== input.targetEvidence.targetManifestSha256
    || manifest.targetVerificationReceiptSha256
      !== input.targetEvidence.receipt.verificationReceiptSha256
    || manifest.decisionCount !== decisionCount
    || manifest.candidateBaseCount !== candidateBaseCount
    || manifest.physicalRecordCount !== physicalRecordCount
    || manifest.maxCandidateMembershipCount !== maxCandidateMembershipCount
  ) {
    fail('snapshot_manifest_digest_mismatch');
  }
  return {
    manifest,
    snapshotNdjsonSha256: snapshotDigest,
    decisionCount,
    candidateBaseCount,
    physicalRecordCount,
    maxCandidateMembershipCount,
  };
  } finally {
    await Promise.allSettled([reader.close()]);
  }
}

const verifiedSnapshots = new WeakSet<object>();
const snapshotBindings = new WeakMap<object, {
  digest: string;
  input: VerifyFullSupportPitActionSnapshotInputV2;
}>();

function snapshotDigest(snapshot: VerifiedFullSupportPitActionSnapshotV2): string {
  return sha256Text(canonicalDecisionJson(snapshot));
}

export async function verifyFullSupportPitActionSnapshotV2(
  input: VerifyFullSupportPitActionSnapshotInputV2,
): Promise<VerifyFullSupportPitActionSnapshotResultV2> {
  try {
    const summary = await runSnapshotVerification(input);
    if (!isVerifiedTargetDistributionEvidenceV2(input.targetEvidence)) {
      fail('rust_verification_trust_root_unavailable');
    }
    const snapshot: VerifiedFullSupportPitActionSnapshotV2 = deepFreeze({
      contractVersion: 'verified_full_support_pit_action_snapshot_v2',
      manifest: summary.manifest,
      targetDistributionNdjsonSha256: summary.manifest.targetDistributionNdjsonSha256,
      historicalBackfill: 'unavailable',
      futureShadowCapture: 'code_ready_activation_blocked',
      realDatasetEligible: false,
      servable: false,
    });
    verifiedSnapshots.add(snapshot);
    snapshotBindings.set(snapshot, { digest: snapshotDigest(snapshot), input });
    return deepFreeze({ status: 'verified' as const, snapshot });
  } catch (error) {
    if (error instanceof SnapshotError) {
      return { status: 'not_evaluable', blocker: error.blocker };
    }
    return { status: 'not_evaluable', blocker: 'snapshot_contract_invalid' };
  }
}

export function isVerifiedFullSupportPitActionSnapshotV2(
  value: unknown,
): value is VerifiedFullSupportPitActionSnapshotV2 {
  try {
    if (!value || typeof value !== 'object' || !verifiedSnapshots.has(value)) return false;
    if (!Object.isFrozen(value)) return false;
    const binding = snapshotBindings.get(value);
    return binding !== undefined
      && binding.digest === snapshotDigest(value as VerifiedFullSupportPitActionSnapshotV2)
      && isVerifiedTargetDistributionEvidenceV2(binding.input.targetEvidence);
  } catch {
    return false;
  }
}

class SnapshotTransactionCallbackError extends Error {
  constructor() {
    super('snapshot_transaction_callback_failed');
    this.name = 'SnapshotTransactionCallbackError';
  }
}

async function safeAbortSnapshotTransaction(
  transaction: SnapshotPositionReplayTransactionV2,
  blocker: string,
): Promise<string> {
  try {
    await transaction.abort(blocker);
    return blocker;
  } catch {
    return 'snapshot_transaction_abort_failed';
  }
}

export async function replayVerifiedSnapshotPositionFeaturesV2(
  snapshot: VerifiedFullSupportPitActionSnapshotV2,
  targetEvidence: VerifiedTargetDistributionEvidenceV2,
  transaction: SnapshotPositionReplayTransactionV2,
): Promise<{ status: 'verified' } | { status: 'not_evaluable'; blocker: string }> {
  let binding: ReturnType<typeof snapshotBindings.get>;
  try {
    if (!snapshot || typeof snapshot !== 'object' || !Object.isFrozen(snapshot)) {
      return { status: 'not_evaluable', blocker: 'snapshot_verified_brand_missing' };
    }
    binding = snapshotBindings.get(snapshot);
    if (
      !verifiedSnapshots.has(snapshot)
      || binding === undefined
      || binding.digest !== snapshotDigest(snapshot)
    ) {
      return { status: 'not_evaluable', blocker: 'snapshot_verified_brand_missing' };
    }
  } catch {
    return { status: 'not_evaluable', blocker: 'snapshot_verified_brand_missing' };
  }
  if (binding.input.targetEvidence !== targetEvidence) {
    return { status: 'not_evaluable', blocker: 'snapshot_target_binding_mismatch' };
  }
  if (!isVerifiedTargetDistributionEvidenceV2(targetEvidence)) {
    return {
      status: 'not_evaluable',
      blocker: await safeAbortSnapshotTransaction(
        transaction,
        'rust_verification_trust_root_unavailable',
      ),
    };
  }
  try {
    await runSnapshotVerification(
      { ...binding.input, targetEvidence },
      async (feature) => {
        try {
          await transaction.onPositionFeature(feature);
        } catch {
          throw new SnapshotTransactionCallbackError();
        }
      },
    );
  } catch (error) {
    const blocker = error instanceof SnapshotTransactionCallbackError
      ? 'snapshot_transaction_callback_failed'
      : error instanceof SnapshotError
        ? error.blocker
        : 'snapshot_contract_invalid';
    return {
      status: 'not_evaluable',
      blocker: await safeAbortSnapshotTransaction(transaction, blocker),
    };
  }
  if (!isVerifiedTargetDistributionEvidenceV2(targetEvidence)) {
    return {
      status: 'not_evaluable',
      blocker: await safeAbortSnapshotTransaction(
        transaction,
        'rust_verification_trust_root_unavailable',
      ),
    };
  }
  try {
    await transaction.commit();
  } catch {
    return {
      status: 'not_evaluable',
      blocker: await safeAbortSnapshotTransaction(
        transaction,
        'snapshot_transaction_commit_failed',
      ),
    };
  }
  return { status: 'verified' };
}
