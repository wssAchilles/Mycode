import { createHash } from 'crypto';

import { canonicalDecisionJson } from '../../decisionLog/contracts';
import { canonicalWireJsonV1, selfSha256V1 } from '../../offlinePrediction/artifacts/canonical';
import {
  HOLDOUT_LEDGER_LIMITS_V1,
  HOLDOUT_USE_LEDGER_RECEIPT_V1,
  MULTIPLICITY_BLOCKER,
  holdoutUseLedgerManifestV1Schema,
  holdoutUseLedgerReceiptV1Schema,
  holdoutUseLedgerRecordV1Schema,
  type HoldoutLedgerBlockerV1,
  type HoldoutUseLedgerManifestV1,
  type HoldoutUseLedgerReceiptDataV1,
  type HoldoutUseLedgerRecordV1,
} from './contracts';
import {
  isVerifiedFrozenEvaluationFamilyV1,
  type VerifiedFrozenEvaluationFamilyV1,
} from './family';

export type HoldoutLedgerByteStreamFactoryV1 = () => AsyncIterable<string | Uint8Array>;

export type VerifyHoldoutUseLedgerInputV1 = {
  trustScope: 'synthetic_fixture' | 'production';
  family: VerifiedFrozenEvaluationFamilyV1;
  ledgerStream: HoldoutLedgerByteStreamFactoryV1;
  manifestRaw: string;
};

const verifiedReceipt = Symbol('verifiedHoldoutUseLedgerReceiptV1');
const verifiedReceipts = new WeakSet<object>();
const verifiedReceiptDigests = new WeakMap<object, string>();

export type VerifiedHoldoutUseLedgerReceiptV1 = HoldoutUseLedgerReceiptDataV1 & {
  readonly [verifiedReceipt]: true;
};

export type VerifyHoldoutUseLedgerResultV1 =
  | { status: 'verified'; receipt: VerifiedHoldoutUseLedgerReceiptV1 }
  | {
    status: 'not_evaluable';
    blocker: Exclude<HoldoutLedgerBlockerV1, typeof MULTIPLICITY_BLOCKER>;
    blockers: [typeof MULTIPLICITY_BLOCKER, Exclude<HoldoutLedgerBlockerV1, typeof MULTIPLICITY_BLOCKER>];
  };

type RegisteredSyntheticRootV1 = {
  contractVersion: 'holdout_ledger_trust_root_v1';
  scope: 'synthetic_fixture';
  familySha256: string;
  holdoutSha256: string;
  rawSha256: string;
  recordCount: number;
  initialRoot: string;
  finalChainHead: string;
  manifestSha256: string;
  rootSha256: string;
};

// This root is intentionally repository-private and synthetic-only. Its reviewed values are
// replaced only when the canonical fixture itself is reviewed.
const REGISTERED_SYNTHETIC_ROOT: RegisteredSyntheticRootV1 = Object.freeze({
  contractVersion: 'holdout_ledger_trust_root_v1',
  scope: 'synthetic_fixture',
  familySha256: '04193c82bf2be3a2f4755bd92a318ec8cca7086dfe88a28ec300ff1d7f7fe89a',
  holdoutSha256: '4'.repeat(64),
  rawSha256: 'ad1a4767eaa131cedf1cd5d6ad6a24d2c8249efffa0265a701c4bacddf9c4114',
  recordCount: 3,
  initialRoot: 'a'.repeat(64),
  finalChainHead: 'b89bc36d10bd0df07dabda44d5dc4a3b33db26d2d8abe455f079680a788dcd1d',
  manifestSha256: 'a97292b57024d29cb262306a0118d1fa268e01632fd3ed70223e75ef50d67a13',
  rootSha256: '7cc5ad1810dfa25ffa7e3e8ebc3161de9d987d519d1c99957e77ce1a8780e30a',
});

type LedgerBlocker = Exclude<HoldoutLedgerBlockerV1, typeof MULTIPLICITY_BLOCKER>;

const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get;

class HoldoutLedgerError extends Error {
  constructor(readonly blocker: LedgerBlocker) {
    super(blocker);
    this.name = 'HoldoutLedgerError';
  }
}

function fail(blocker: LedgerBlocker): never {
  throw new HoldoutLedgerError(blocker);
}

class BoundedLedgerReader {
  private readonly hash = createHash('sha256');
  private iterator?: AsyncIterator<string | Uint8Array>;
  private currentChunk = Buffer.alloc(0);
  private currentOffset = 0;
  private readonly pending = Buffer.allocUnsafe(HOLDOUT_LEDGER_LIMITS_V1.maximumLineBytes);
  private pendingLength = 0;
  private ended = false;
  private bytes = 0;
  private records = 0;
  maximumLineBytes = 0;

  constructor(private readonly factory: HoldoutLedgerByteStreamFactoryV1) {}

  async nextLine(): Promise<string | undefined> {
    while (true) {
      if (this.currentOffset < this.currentChunk.length) {
        const newline = this.currentChunk.indexOf(0x0a, this.currentOffset);
        const end = newline < 0 ? this.currentChunk.length : newline;
        const length = end - this.currentOffset;
        if (this.pendingLength + length >= HOLDOUT_LEDGER_LIMITS_V1.maximumLineBytes) {
          fail('resource_limit_exceeded');
        }
        this.currentChunk.copy(this.pending, this.pendingLength, this.currentOffset, end);
        this.pendingLength += length;
        this.currentOffset = newline < 0 ? end : newline + 1;
        if (newline < 0) continue;
        if (this.pendingLength === 0 || this.pending[this.pendingLength - 1] === 0x0d) {
          fail('holdout_ledger_contract_invalid');
        }
        this.records += 1;
        if (this.records > HOLDOUT_LEDGER_LIMITS_V1.maximumRecords) {
          fail('resource_limit_exceeded');
        }
        this.maximumLineBytes = Math.max(this.maximumLineBytes, this.pendingLength + 1);
        try {
          const line = new TextDecoder('utf-8', { fatal: true }).decode(
            this.pending.subarray(0, this.pendingLength),
          );
          this.pendingLength = 0;
          return line;
        } catch {
          fail('holdout_ledger_contract_invalid');
        }
      }
      if (this.ended) return undefined;
      await this.readChunk();
    }
  }

  private async readChunk(): Promise<void> {
    if (!this.iterator) {
      let candidate: AsyncIterable<string | Uint8Array>;
      try { candidate = this.factory(); } catch { fail('holdout_ledger_stream_error'); }
      if (!candidate || typeof candidate[Symbol.asyncIterator] !== 'function') {
        fail('holdout_ledger_contract_invalid');
      }
      this.iterator = candidate[Symbol.asyncIterator]();
    }
    let next: IteratorResult<string | Uint8Array>;
    try { next = await this.iterator.next(); } catch { fail('holdout_ledger_stream_error'); }
    if (next.done) {
      this.ended = true;
      if (this.pendingLength !== 0) fail('holdout_ledger_contract_invalid');
      return;
    }
    if (typeof next.value !== 'string' && !(next.value instanceof Uint8Array)) {
      fail('holdout_ledger_contract_invalid');
    }
    const chunkByteLength = typeof next.value === 'string'
      ? Buffer.byteLength(next.value)
      : intrinsicUint8ArrayByteLength(next.value);
    if (chunkByteLength === 0) fail('holdout_ledger_contract_invalid');
    if (chunkByteLength > HOLDOUT_LEDGER_LIMITS_V1.maximumFileBytes - this.bytes) {
      fail('resource_limit_exceeded');
    }
    const chunk = typeof next.value === 'string'
      ? Buffer.from(next.value)
      : copyUint8Array(next.value, chunkByteLength);
    this.bytes += chunkByteLength;
    this.hash.update(chunk);
    this.currentChunk = chunk;
    this.currentOffset = 0;
  }

  digest(): string {
    if (!this.ended || this.pendingLength !== 0) fail('holdout_ledger_contract_invalid');
    return this.hash.digest('hex');
  }

  recordCount(): number { return this.records; }
  byteCount(): number { return this.bytes; }

  async close(): Promise<void> {
    if (!this.ended && this.iterator?.return) {
      try { await this.iterator.return(); } catch { /* best-effort close after failure */ }
    }
    this.ended = true;
    this.pendingLength = 0;
    this.currentChunk = Buffer.alloc(0);
    this.currentOffset = 0;
  }
}

function intrinsicUint8ArrayByteLength(value: Uint8Array): number {
  if (!TYPED_ARRAY_BYTE_LENGTH_GETTER) fail('holdout_ledger_contract_invalid');
  try {
    return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
  } catch {
    fail('holdout_ledger_contract_invalid');
  }
}

function copyUint8Array(value: Uint8Array, byteLength: number): Buffer {
  const copy = Buffer.allocUnsafe(byteLength);
  copy.set(value);
  return copy;
}

export async function verifyHoldoutUseLedgerV1(
  input: VerifyHoldoutUseLedgerInputV1,
): Promise<VerifyHoldoutUseLedgerResultV1> {
  let stableInput: VerifyHoldoutUseLedgerInputV1 | undefined;
  try {
    stableInput = snapshotExactInput(input);
    if (!stableInput) {
      return notEvaluable('holdout_ledger_completeness_unverified');
    }
  } catch {
    return notEvaluable('holdout_ledger_contract_invalid');
  }
  const {
    family,
    ledgerStream,
    manifestRaw,
    trustScope,
  } = stableInput;
  if (!isVerifiedFrozenEvaluationFamilyV1(family)) {
    return notEvaluable('frozen_evaluation_family_unverified');
  }
  let reader: BoundedLedgerReader | undefined;
  try {
    const manifest = parseManifest(manifestRaw);
    reader = new BoundedLedgerReader(ledgerStream);
    const summary = await verifyStream(reader, family, manifest);
    if (trustScope !== 'synthetic_fixture' || !matchesRegisteredRoot({
      ...summary,
      familySha256: family.familySha256,
      holdoutSha256: family.holdout.holdoutSha256,
    })) {
      return notEvaluable('holdout_ledger_completeness_unverified');
    }
    const receiptPreimage = {
      contractVersion: HOLDOUT_USE_LEDGER_RECEIPT_V1,
      trustScope: 'synthetic_fixture' as const,
      familySha256: family.familySha256,
      holdoutSha256: family.holdout.holdoutSha256,
      rawSha256: summary.rawSha256,
      recordCount: summary.recordCount,
      initialRoot: summary.initialRoot,
      finalChainHead: summary.finalChainHead,
      manifestSha256: manifest.manifestSha256,
      trustedRootSha256: REGISTERED_SYNTHETIC_ROOT.rootSha256,
      diagnostics: summary.diagnostics,
      blockers: [MULTIPLICITY_BLOCKER] as [typeof MULTIPLICITY_BLOCKER],
      realDatasetEligible: false as const,
    };
    const receipt = holdoutUseLedgerReceiptV1Schema.parse({
      ...receiptPreimage,
      receiptSha256: digest(receiptPreimage),
    }) as VerifiedHoldoutUseLedgerReceiptV1;
    Object.defineProperty(receipt, verifiedReceipt, {
      value: true,
      enumerable: false,
      configurable: false,
    });
    verifiedReceipts.add(receipt);
    recursivelyFreeze(receipt);
    verifiedReceiptDigests.set(receipt, receipt.receiptSha256);
    return { status: 'verified', receipt };
  } catch (error) {
    return notEvaluable(error instanceof HoldoutLedgerError
      ? error.blocker
      : 'holdout_ledger_stream_error');
  } finally {
    await reader?.close();
  }
}

export function isVerifiedHoldoutUseLedgerReceiptV1(
  value: unknown,
): value is VerifiedHoldoutUseLedgerReceiptV1 {
  try {
    if (!value || typeof value !== 'object' || !verifiedReceipts.has(value)) return false;
    const receipt = value as VerifiedHoldoutUseLedgerReceiptV1;
    const { receiptSha256: _digest, ...preimage } = receipt;
    return receipt[verifiedReceipt] === true
      && recursivelyFrozen(receipt)
      && receipt.realDatasetEligible === false
      && receipt.blockers.length === 1
      && receipt.blockers[0] === MULTIPLICITY_BLOCKER
      && receipt.receiptSha256 === digest(preimage)
      && verifiedReceiptDigests.get(receipt) === receipt.receiptSha256
      && matchesRegisteredRoot(receipt);
  } catch {
    return false;
  }
}

async function verifyStream(
  reader: BoundedLedgerReader,
  family: VerifiedFrozenEvaluationFamilyV1,
  manifest: HoldoutUseLedgerManifestV1,
) {
  const startLine = await reader.nextLine();
  if (startLine === undefined) fail('holdout_ledger_stream_grammar_mismatch');
  const start = parseRecord(startLine);
  if (start.recordType !== 'ledger_start') fail('holdout_ledger_stream_grammar_mismatch');
  if (start.familySha256 !== family.familySha256) fail('holdout_ledger_family_mismatch');
  if (start.holdoutSha256 !== family.holdout.holdoutSha256) {
    fail('holdout_ledger_holdout_mismatch');
  }

  let chainHead = start.initialRoot;
  let useCount = 0;
  let estimatedMembershipBytes = 0;
  const uses = new Map<string, string>();
  const holdouts = new Map<string, string>();
  let end: Extract<HoldoutUseLedgerRecordV1, { recordType: 'ledger_end' }> | undefined;
  while (true) {
    const line = await reader.nextLine();
    if (line === undefined) fail('holdout_ledger_stream_grammar_mismatch');
    const record = parseRecord(line);
    if (record.recordType === 'ledger_end') {
      end = record;
      break;
    }
    if (record.recordType !== 'holdout_use') fail('holdout_ledger_stream_grammar_mismatch');
    if (record.sequence !== useCount + 1) fail('holdout_ledger_stream_grammar_mismatch');
    if (record.familySha256 !== family.familySha256) fail('holdout_ledger_family_mismatch');
    if (record.holdoutSha256 !== family.holdout.holdoutSha256) {
      fail('holdout_ledger_holdout_mismatch');
    }
    if (record.priorChainHead !== chainHead) fail('holdout_ledger_chain_mismatch');
    if (selfSha256V1(record, 'recordSha256') !== record.recordSha256) {
      fail('holdout_ledger_digest_mismatch');
    }
    if (uses.has(record.useId)) fail('holdout_use_conflict');
    if (holdouts.has(record.holdoutSha256)) fail('holdout_already_used');
    if (
      Date.parse(record.revealedAt) < Date.parse(family.holdoutRevealNotBefore)
      || Date.parse(record.usedAt) < Date.parse(record.revealedAt)
    ) {
      fail('holdout_ledger_time_boundary_mismatch');
    }
    uses.set(record.useId, record.recordSha256);
    holdouts.set(record.holdoutSha256, record.useId);
    estimatedMembershipBytes += Buffer.byteLength(record.useId)
      + Buffer.byteLength(record.holdoutSha256)
      + Buffer.byteLength(record.recordSha256)
      + 96;
    if (
      uses.size > HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries
      || holdouts.size > HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries
      || estimatedMembershipBytes > HOLDOUT_LEDGER_LIMITS_V1.maximumEstimatedMembershipBytes
    ) {
      fail('resource_limit_exceeded');
    }
    chainHead = record.recordSha256;
    useCount += 1;
  }
  if (await reader.nextLine() !== undefined) fail('holdout_ledger_stream_grammar_mismatch');
  if (
    end.ledgerId !== start.ledgerId
  ) fail('holdout_ledger_stream_grammar_mismatch');
  if (end.actualUseCount !== useCount) fail('holdout_ledger_count_mismatch');
  if (end.finalChainHead !== chainHead) fail('holdout_ledger_chain_mismatch');
  if (start.expectedUseCount !== useCount) fail('holdout_ledger_count_mismatch');
  const rawSha256 = reader.digest();
  const recordCount = reader.recordCount();
  if (manifest.ledgerId !== start.ledgerId) fail('holdout_ledger_stream_grammar_mismatch');
  if (manifest.familySha256 !== family.familySha256) fail('holdout_ledger_family_mismatch');
  if (manifest.holdoutSha256 !== family.holdout.holdoutSha256) {
    fail('holdout_ledger_holdout_mismatch');
  }
  if (manifest.rawSha256 !== rawSha256) fail('holdout_ledger_digest_mismatch');
  if (manifest.recordCount !== recordCount || manifest.useCount !== useCount) {
    fail('holdout_ledger_count_mismatch');
  }
  if (manifest.initialRoot !== start.initialRoot || manifest.finalChainHead !== chainHead) {
    fail('holdout_ledger_chain_mismatch');
  }
  return {
    rawSha256,
    recordCount,
    initialRoot: start.initialRoot,
    finalChainHead: chainHead,
    manifestSha256: manifest.manifestSha256,
    diagnostics: {
      totalBytes: reader.byteCount(),
      maximumLineBytes: reader.maximumLineBytes,
      highWaterUseIdCount: uses.size,
      highWaterHoldoutCount: holdouts.size,
      estimatedMembershipBytes,
      configuredMembershipCountLimit: HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries,
      configuredMembershipByteLimit: HOLDOUT_LEDGER_LIMITS_V1.maximumEstimatedMembershipBytes,
    },
  };
}

function parseRecord(line: string): HoldoutUseLedgerRecordV1 {
  let value: unknown;
  try { value = JSON.parse(line); } catch { fail('holdout_ledger_contract_invalid'); }
  const parsed = holdoutUseLedgerRecordV1Schema.safeParse(value);
  if (!parsed.success) fail('holdout_ledger_contract_invalid');
  if (line !== canonicalWireJsonV1(parsed.data)) fail('holdout_ledger_canonical_wire_mismatch');
  return parsed.data;
}

function parseManifest(raw: string): HoldoutUseLedgerManifestV1 {
  if (
    !raw.endsWith('\n')
    || Buffer.byteLength(raw) > HOLDOUT_LEDGER_LIMITS_V1.maximumLineBytes
  ) {
    fail(Buffer.byteLength(raw) > HOLDOUT_LEDGER_LIMITS_V1.maximumLineBytes
      ? 'resource_limit_exceeded'
      : 'holdout_ledger_contract_invalid');
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail('holdout_ledger_contract_invalid'); }
  const parsed = holdoutUseLedgerManifestV1Schema.safeParse(value);
  if (!parsed.success) fail('holdout_ledger_contract_invalid');
  if (raw !== `${canonicalWireJsonV1(parsed.data)}\n`) {
    fail('holdout_ledger_canonical_wire_mismatch');
  }
  if (selfSha256V1(parsed.data, 'manifestSha256') !== parsed.data.manifestSha256) {
    fail('holdout_ledger_digest_mismatch');
  }
  return parsed.data;
}

function snapshotExactInput(input: unknown): VerifyHoldoutUseLedgerInputV1 | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const keys = Object.keys(input).sort();
  if (keys.join('\u0000') !== ['family', 'ledgerStream', 'manifestRaw', 'trustScope'].join('\u0000')) {
    return undefined;
  }
  const value = input as Record<string, unknown>;
  const family = value.family;
  const ledgerStream = value.ledgerStream;
  const manifestRaw = value.manifestRaw;
  const trustScope = value.trustScope;
  if (
    (trustScope !== 'synthetic_fixture' && trustScope !== 'production')
    || typeof ledgerStream !== 'function'
    || typeof manifestRaw !== 'string'
  ) return undefined;
  return {
    family: family as VerifiedFrozenEvaluationFamilyV1,
    ledgerStream: ledgerStream as HoldoutLedgerByteStreamFactoryV1,
    manifestRaw,
    trustScope,
  };
}

function matchesRegisteredRoot(value: {
  familySha256: string;
  holdoutSha256: string;
  rawSha256: string;
  recordCount: number;
  initialRoot: string;
  finalChainHead: string;
  manifestSha256: string;
  trustedRootSha256?: string;
}): boolean {
  const { rootSha256: _digest, ...preimage } = REGISTERED_SYNTHETIC_ROOT;
  return REGISTERED_SYNTHETIC_ROOT.rootSha256 === digest(preimage)
    && (value.trustedRootSha256 === undefined
      || value.trustedRootSha256 === REGISTERED_SYNTHETIC_ROOT.rootSha256)
    && value.familySha256 === REGISTERED_SYNTHETIC_ROOT.familySha256
    && value.holdoutSha256 === REGISTERED_SYNTHETIC_ROOT.holdoutSha256
    && value.rawSha256 === REGISTERED_SYNTHETIC_ROOT.rawSha256
    && value.recordCount === REGISTERED_SYNTHETIC_ROOT.recordCount
    && value.initialRoot === REGISTERED_SYNTHETIC_ROOT.initialRoot
    && value.finalChainHead === REGISTERED_SYNTHETIC_ROOT.finalChainHead
    && value.manifestSha256 === REGISTERED_SYNTHETIC_ROOT.manifestSha256;
}

function notEvaluable(blocker: LedgerBlocker): VerifyHoldoutUseLedgerResultV1 {
  return {
    status: 'not_evaluable',
    blocker,
    blockers: [MULTIPLICITY_BLOCKER, blocker],
  };
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalDecisionJson(value)).digest('hex');
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const property of Reflect.ownKeys(value)) {
    recursivelyFreeze(Reflect.get(value, property), seen);
  }
  Object.freeze(value);
  return value;
}

function recursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Reflect.ownKeys(value).every((property) => recursivelyFrozen(Reflect.get(value, property), seen));
}
