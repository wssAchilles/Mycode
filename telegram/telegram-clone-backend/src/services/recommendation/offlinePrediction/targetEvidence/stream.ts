import { createHash } from 'crypto';

import { z } from 'zod';

import {
  canonicalDecisionJson,
  decisionLogSha256,
  recommendationDecisionLogSchema,
  type RecommendationDecisionLogV1,
} from '../../decisionLog/contracts';
import {
  TARGET_DISTRIBUTION_MASS_TOLERANCE,
  targetDistributionManifestSchema,
  targetDistributionPolicyConfigSchema,
  targetDistributionRecordSchema,
  targetDistributionSourceManifestSchema,
  targetDistributionStreamReceiptV2Schema,
  type TargetDistributionRecordV1,
} from '../contracts/targetDistribution';
import {
  copyBoundedByteStreamChunkV1,
  maximumByteStreamChunksV1,
} from '../artifacts/byteStream';
import { canonicalWireJsonV1, selfSha256V1, sha256Text } from '../artifacts/canonical';
import type {
  ByteStreamFactoryV2,
  TargetDistributionContractValidationV2,
  TargetDistributionReplayVisitorV2,
  TargetDistributionStreamVerificationInputV2,
  VerifiedTargetDistributionDecisionV2,
  VerifiedTargetDistributionEvidenceV2,
  VerifyTargetDistributionStreamResultV2,
} from './contracts';

const MAX_LINE_BYTES = 1 << 20;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_AGGREGATE_BYTES = 1024 * 1024 * 1024;
const MAX_SOURCE_RECORDS = 1_000_000;
const MAX_DISTRIBUTION_RECORDS = 2_000_000;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const trustRootSchema = z.object({
  contractVersion: z.literal('rust_target_verifier_trust_root_v1'),
  scope: z.literal('synthetic_fixture'),
  receiptSchema: z.literal('target_distribution_stream_verification_receipt_v2'),
  verifierBuildFingerprintSha256: sha256Schema,
  expectedReceiptSha256: sha256Schema,
  expectedReceiptRawSha256: sha256Schema,
  sourceBundleSha256: sha256Schema,
  validFrom: z.string().datetime({ offset: true }),
  validThrough: z.string().datetime({ offset: true }),
  rootDigest: sha256Schema,
}).strict();

const SYNTHETIC_ROOT_PREIMAGE = Object.freeze({
  contractVersion: 'rust_target_verifier_trust_root_v1' as const,
  scope: 'synthetic_fixture' as const,
  receiptSchema: 'target_distribution_stream_verification_receipt_v2' as const,
  verifierBuildFingerprintSha256:
    'a8a15191a185a2f485906f3d9ddc378039720487d036f4fb2e29c4092b5fcb35',
  expectedReceiptSha256:
    'ed54b74127a8be8c83d5ac48a908f69ef8a37df0691c15346a3c4e9dac772148',
  expectedReceiptRawSha256:
    '1e5022f8f151801ede37c4b353b2603d019e2f1df938e166c71121386050ee16',
  sourceBundleSha256:
    'ddc9db1cf053a31baa33e87457266e4cd6cf19c2be6b37964bf80246f32baae9',
  validFrom: '2026-07-19T00:00:00.000Z',
  validThrough: '2027-07-19T00:00:00.000Z',
});
const SYNTHETIC_ROOT = Object.freeze(trustRootSchema.parse({
  ...SYNTHETIC_ROOT_PREIMAGE,
  rootDigest: 'dbe75b6de7b192dad5802d88e2a0269422a47726a7d9614d4733f436e4eb29af',
}));
const PHASE16_MULTI_DECISION_SYNTHETIC_ROOT_PREIMAGE = Object.freeze({
  contractVersion: 'rust_target_verifier_trust_root_v1' as const,
  scope: 'synthetic_fixture' as const,
  receiptSchema: 'target_distribution_stream_verification_receipt_v2' as const,
  verifierBuildFingerprintSha256:
    'a8a15191a185a2f485906f3d9ddc378039720487d036f4fb2e29c4092b5fcb35',
  expectedReceiptSha256:
    '3585a13ad071c68f6ab1071bddafbb4b866867db84c0c8b78edb96c9ffb8692d',
  expectedReceiptRawSha256:
    '602ca490ae53617b256226523fa0e5b06c8f74e00bff8e649f534e8b22a1cf44',
  sourceBundleSha256:
    'bca29f196410359fccf0804f981c4a167f67dc86284e33ad5d928a31a1668bfd',
  validFrom: '2026-07-30T00:00:00.000Z',
  validThrough: '2027-07-30T00:00:00.000Z',
});
const PHASE16_MULTI_DECISION_SYNTHETIC_ROOT = Object.freeze(trustRootSchema.parse({
  ...PHASE16_MULTI_DECISION_SYNTHETIC_ROOT_PREIMAGE,
  rootDigest: 'bf27133617bb3a35cc9bfc6f11581ca5b83efb5aa0360853872314193fb3a5ed',
}));
const SYNTHETIC_ROOT_REGISTRY = Object.freeze([
  Object.freeze({
    root: SYNTHETIC_ROOT,
    preimage: SYNTHETIC_ROOT_PREIMAGE,
    fixtureVersion: 'target_distribution_stream_receipt_fixture_v2',
    sourceFixturePath: 'target_policy_distribution_stream_v1.json',
  }),
  Object.freeze({
    root: PHASE16_MULTI_DECISION_SYNTHETIC_ROOT,
    preimage: PHASE16_MULTI_DECISION_SYNTHETIC_ROOT_PREIMAGE,
    fixtureVersion: 'target_distribution_stream_receipt_phase16_multi_decision_fixture_v1',
    sourceFixturePath: 'private_phase16_multi_decision_target_distribution_v1',
  }),
]);
for (const registration of SYNTHETIC_ROOT_REGISTRY) {
  if (registration.root.rootDigest
      !== sha256Text(canonicalDecisionJson(registration.preimage))) {
    throw new Error('registered synthetic Rust trust root is invalid');
  }
}

const verifiedEvidence = new WeakSet<object>();
const verifiedBindings = new WeakMap<object, {
  digest: string;
  sourceDecisionStream: ByteStreamFactoryV2;
  distributionStream: ByteStreamFactoryV2;
  input: TargetDistributionStreamVerificationInputV2;
}>();

type Blocker =
  | 'resource_limit_exceeded'
  | 'target_contract_invalid'
  | 'target_canonical_wire_mismatch'
  | 'target_receipt_digest_mismatch'
  | 'target_root_digest_mismatch'
  | 'target_source_decision_duplicate'
  | 'target_decision_binding_mismatch'
  | 'target_source_position_mismatch'
  | 'target_source_candidate_duplicate'
  | 'target_stream_grammar_mismatch'
  | 'target_step_binding_mismatch'
  | 'target_support_mismatch'
  | 'target_deterministic_top_mismatch'
  | 'target_mixture_mismatch'
  | 'target_prefix_support_mismatch'
  | 'target_probability_mass_mismatch'
  | 'target_decision_digest_mismatch'
  | 'target_count_mismatch'
  | 'target_source_membership_mismatch';

export class TargetEvidenceStreamError extends Error {
  constructor(readonly blocker: Blocker) {
    super(blocker);
    this.name = 'TargetEvidenceStreamError';
  }
}

function fail(blocker: Blocker): never {
  throw new TargetEvidenceStreamError(blocker);
}
const identity = (key: { candidateNamespace: string; candidateId: string }): string => (
  `${key.candidateNamespace}\u0000${key.candidateId}`
);
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left),
  Buffer.from(right),
);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeWireNumberLexemes(raw: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length;) {
    const character = raw[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      index += 1;
      continue;
    }
    if (character && /[-0-9]/.test(character)) {
      const match = raw.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (match) {
        const numeric = Number(match[0]);
        if (Number.isFinite(numeric)) {
          output += Object.is(numeric, -0) ? '0' : String(numeric);
          index += match[0].length;
          continue;
        }
      }
    }
    output += character;
    index += 1;
  }
  return output;
}

function sourceNumberLexemesAreCanonical(raw: string): boolean {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length;) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      index += 1;
      continue;
    }
    const match = raw.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.(\d+))?(?:[eE][+-]?\d+)?/);
    if (match) {
      const fraction = match[1];
      if (fraction && fraction.length > 1 && fraction.endsWith('0')) return false;
      const exponent = match[0].match(/([eE])([+-]?)(\d+)$/);
      if (exponent) {
        const mantissa = match[0].slice(0, exponent.index);
        const exponentDigits = exponent[3];
        if (
          exponent[1] !== 'e'
          || exponent[2] === '+'
          || exponentDigits === '0'
          || (exponentDigits.length > 1 && exponentDigits.startsWith('0'))
          || Number(mantissa) === 0
        ) return false;
      }
      index += match[0].length;
      continue;
    }
    index += 1;
  }
  return true;
}

class AggregateLimit {
  bytes = 0;

  add(bytes: number): void {
    this.bytes += bytes;
    if (this.bytes > MAX_AGGREGATE_BYTES) fail('resource_limit_exceeded');
  }
}

class NdjsonReader {
  private readonly hash = createHash('sha256');
  private iterator?: AsyncIterator<string | Uint8Array>;
  private readonly pending = Buffer.allocUnsafe(MAX_LINE_BYTES);
  private pendingLength = 0;
  private currentChunk = Buffer.alloc(0);
  private currentChunkOffset = 0;
  private ended = false;
  private bytes = 0;
  private records = 0;
  private chunks = 0;
  private readonly maximumChunks: number;
  maxLineBytes = 0;

  constructor(
    private readonly factory: ByteStreamFactoryV2,
    private readonly maxRecords: number,
    private readonly aggregate: AggregateLimit,
  ) {
    this.maximumChunks = maximumByteStreamChunksV1(maxRecords);
  }

  private async readChunk(): Promise<void> {
    if (!this.iterator) {
      const stream = this.factory();
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        fail('target_contract_invalid');
      }
      this.iterator = stream[Symbol.asyncIterator]();
    }
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      if (this.pendingLength !== 0) fail('target_contract_invalid');
      return;
    }
    const copied = copyBoundedByteStreamChunkV1(
      next.value,
      MAX_FILE_BYTES - this.bytes,
      this.maximumChunks - this.chunks,
    );
    if (copied.status === 'invalid') fail('target_contract_invalid');
    if (copied.status === 'resource_limit_exceeded') fail('resource_limit_exceeded');
    this.chunks += 1;
    const chunk = copied.chunk;
    this.bytes += copied.byteLength;
    this.aggregate.add(copied.byteLength);
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
          fail('target_contract_invalid');
        }
        this.records += 1;
        if (this.records > this.maxRecords) fail('resource_limit_exceeded');
        this.maxLineBytes = Math.max(this.maxLineBytes, this.pendingLength + 1);
        try {
          const line = new TextDecoder('utf-8', { fatal: true }).decode(
            this.pending.subarray(0, this.pendingLength),
          );
          this.pendingLength = 0;
          return line;
        } catch {
          fail('target_contract_invalid');
        }
      }
      if (this.ended) return undefined;
      await this.readChunk();
    }
  }

  digest(): string {
    if (!this.ended || this.pendingLength !== 0) fail('target_contract_invalid');
    return this.hash.digest('hex');
  }

  recordCount(): number { return this.records; }

  async close(): Promise<void> {
    if (!this.ended && this.iterator?.return) await this.iterator.return();
    this.ended = true;
    this.pendingLength = 0;
    this.currentChunk = Buffer.alloc(0);
    this.currentChunkOffset = 0;
  }
}

function parseCanonicalSingle<T>(raw: string, schema: z.ZodType<T>, requireLf = true): T {
  if (Buffer.byteLength(raw) > MAX_LINE_BYTES || (requireLf && !raw.endsWith('\n'))) {
    fail(Buffer.byteLength(raw) > MAX_LINE_BYTES ? 'resource_limit_exceeded' : 'target_contract_invalid');
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail('target_contract_invalid'); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail('target_contract_invalid');
  if (requireLf && raw !== `${canonicalWireJsonV1(parsed.data)}\n`) {
    fail('target_canonical_wire_mismatch');
  }
  return parsed.data;
}

function parseDistributionLine(line: string): TargetDistributionRecordV1 {
  let value: unknown;
  try { value = JSON.parse(line); } catch { fail('target_contract_invalid'); }
  const parsed = targetDistributionRecordSchema.safeParse(value);
  if (!parsed.success) fail('target_contract_invalid');
  if (normalizeWireNumberLexemes(line) !== canonicalWireJsonV1(parsed.data)) {
    fail('target_canonical_wire_mismatch');
  }
  return parsed.data;
}

type RunSummary = TargetDistributionContractValidationV2 & {
  manifest: z.infer<typeof targetDistributionManifestSchema>;
  receipt: z.infer<typeof targetDistributionStreamReceiptV2Schema>;
  sourceDatasetManifestSha256: string;
  targetManifestSha256: string;
  verificationReceiptRawSha256: string;
};

async function runVerification(
  input: TargetDistributionStreamVerificationInputV2,
  visitor?: TargetDistributionReplayVisitorV2,
): Promise<RunSummary> {
  const sourceManifest = parseCanonicalSingle(
    input.sourceDatasetManifestRaw,
    targetDistributionSourceManifestSchema,
  );
  const manifest = parseCanonicalSingle(input.targetManifestRaw, targetDistributionManifestSchema);
  const receipt = parseCanonicalSingle(
    input.verificationReceiptRaw,
    targetDistributionStreamReceiptV2Schema,
  );
  const policy = parseCanonicalSingle(input.policyConfigRaw, targetDistributionPolicyConfigSchema, false);
  if (selfSha256V1(receipt, 'verificationReceiptSha256') !== receipt.verificationReceiptSha256) {
    fail('target_receipt_digest_mismatch');
  }

  const aggregate = new AggregateLimit();
  const sourceReader = new NdjsonReader(input.sourceDecisionStream, MAX_SOURCE_RECORDS, aggregate);
  const distributionReader = new NdjsonReader(
    input.distributionStream,
    MAX_DISTRIBUTION_RECORDS,
    aggregate,
  );
  try {
  let previousDecisionId: string | undefined;
  let decisionCount = 0;
  let stepCount = 0;
  let actionCount = 0;
  let maxCandidateCount = 0;
  let maxStepActionCount = 0;
  let maxPrefixActionCount = 0;

  while (true) {
    const sourceLine = await sourceReader.nextLine();
    if (sourceLine === undefined) break;
    let sourceRaw: unknown;
    try { sourceRaw = JSON.parse(sourceLine); } catch { fail('target_contract_invalid'); }
    const parsedSource = recommendationDecisionLogSchema.safeParse(sourceRaw);
    if (!parsedSource.success) fail('target_contract_invalid');
    const source = parsedSource.data;
    if (
      !sourceNumberLexemesAreCanonical(sourceLine)
      || normalizeWireNumberLexemes(sourceLine) !== JSON.stringify(source)
    ) {
      fail('target_canonical_wire_mismatch');
    }
    if (
      previousDecisionId !== undefined
      && compareText(previousDecisionId, source.decisionId) >= 0
    ) {
      fail(previousDecisionId === source.decisionId
        ? 'target_source_decision_duplicate'
        : 'target_source_membership_mismatch');
    }
    previousDecisionId = source.decisionId;

    const startLine = await distributionReader.nextLine();
    if (startLine === undefined) fail('target_stream_grammar_mismatch');
    const start = parseDistributionLine(startLine);
    if (start.recordType !== 'decision_start') fail('target_stream_grammar_mismatch');
    if (
      source.candidatePool.supportEvidence.status !== 'complete'
      || source.candidatePool.truncated
      || source.candidatePool.candidates.length > 2048
      || start.decisionId !== source.decisionId
      || start.decisionFingerprint.decisionId !== source.decisionId
      || start.decisionFingerprint.sha256 !== decisionLogSha256(source)
      || start.candidatePoolFingerprint.sha256 !== source.candidatePool.candidatePoolSha256
      || canonicalDecisionJson(start.policy) !== canonicalDecisionJson(policy)
    ) {
      fail('target_decision_binding_mismatch');
    }
    const sourceActions = [...source.actions].sort((left, right) => (
      left.actionKey.servedPosition - right.actionKey.servedPosition
    ));
    if (
      sourceActions.length !== start.policy.slateSize
      || sourceActions.some((action, index) => action.actionKey.servedPosition !== index + 1)
    ) {
      fail('target_source_position_mismatch');
    }
    const eligibleBaseline = [...source.candidatePool.candidates]
      .filter((candidate) => candidate.eligible)
      .sort((left, right) => (
        left.poolRank - right.poolRank
        || compareText(left.candidateNamespace, right.candidateNamespace)
        || compareText(left.candidateId, right.candidateId)
      ));
    const eligibleIdentities = new Set(eligibleBaseline.map(identity));
    if (eligibleIdentities.size !== eligibleBaseline.length) fail('target_source_candidate_duplicate');
    maxCandidateCount = Math.max(maxCandidateCount, source.candidatePool.candidates.length);

    const recordsHash = createHash('sha256');
    recordsHash.update(`${canonicalDecisionJson(start)}\n`);
    const decision: VerifiedTargetDistributionDecisionV2 = {
      source,
      decisionLogSha256: start.decisionFingerprint.sha256,
      candidatePoolSha256: start.candidatePoolFingerprint.sha256,
    };
    await visitor?.onDecisionStart?.(decision);
    let decisionStepCount = 0;
    let decisionActionCount = 0;
    for (let position = 1; position <= sourceActions.length; position += 1) {
      const stepLine = await distributionReader.nextLine();
      if (stepLine === undefined) fail('target_stream_grammar_mismatch');
      const step = parseDistributionLine(stepLine);
      if (step.recordType !== 'step_start') fail('target_stream_grammar_mismatch');
      const expectedPrefix = sourceActions.slice(0, position - 1).map((action) => action.actionKey);
      if (
        step.decisionId !== source.decisionId
        || step.servedPosition !== position
        || step.prefixActionKeys.length !== position - 1
        || canonicalDecisionJson(step.prefixActionKeys) !== canonicalDecisionJson(expectedPrefix)
      ) {
        fail('target_step_binding_mismatch');
      }
      recordsHash.update(`${canonicalDecisionJson(step)}\n`);
      const prefixIdentities = new Set(step.prefixActionKeys.map(identity));
      if (
        prefixIdentities.size !== step.prefixActionKeys.length
        || [...prefixIdentities].some((value) => !eligibleIdentities.has(value))
      ) {
        fail('target_prefix_support_mismatch');
      }
      const expectedRemaining = eligibleBaseline.filter(
        (candidate) => !prefixIdentities.has(identity(candidate)),
      );
      if (step.expectedActionCount !== expectedRemaining.length) fail('target_support_mismatch');
      let plMass = 0;
      let mixedMass = 0;
      const actions: import('./contracts').VerifiedTargetDistributionStepV2['actions'] = [];
      for (let actionIndex = 0; actionIndex < step.expectedActionCount; actionIndex += 1) {
        const actionLine = await distributionReader.nextLine();
        if (actionLine === undefined) fail('target_stream_grammar_mismatch');
        const action = parseDistributionLine(actionLine);
        if (action.recordType !== 'action_probability') fail('target_stream_grammar_mismatch');
        const expectedCandidate = expectedRemaining[actionIndex]!;
        if (
          action.decisionId !== source.decisionId
          || action.actionKey.servedPosition !== position
          || identity(action.actionKey) !== identity(expectedCandidate)
        ) {
          fail('target_support_mismatch');
        }
        const deterministicTop = actionIndex === 0;
        if (action.deterministicTop !== deterministicTop) {
          fail('target_deterministic_top_mismatch');
        }
        const expectedMixed = (deterministicTop ? 1 - start.policy.epsilon : 0)
          + start.policy.epsilon * action.plackettLuceProbability;
        if (
          !Number.isFinite(action.plackettLuceProbability)
          || !Number.isFinite(action.conditionalSelectionProbability)
          || action.plackettLuceProbability < 0
          || action.plackettLuceProbability > 1
          || action.conditionalSelectionProbability < 0
          || action.conditionalSelectionProbability > 1
          || Math.abs(action.conditionalSelectionProbability - expectedMixed)
            > TARGET_DISTRIBUTION_MASS_TOLERANCE
        ) {
          fail('target_mixture_mismatch');
        }
        plMass += action.plackettLuceProbability;
        mixedMass += action.conditionalSelectionProbability;
        recordsHash.update(`${canonicalDecisionJson(action)}\n`);
        actions.push({
          actionKey: action.actionKey,
          deterministicTop: action.deterministicTop,
          plackettLuceProbability: action.plackettLuceProbability,
          conditionalSelectionProbability: action.conditionalSelectionProbability,
        });
      }
      if (
        Math.abs(plMass - 1) > TARGET_DISTRIBUTION_MASS_TOLERANCE
        || Math.abs(mixedMass - 1) > TARGET_DISTRIBUTION_MASS_TOLERANCE
        || Math.abs(Math.abs(plMass - 1) - step.plackettLuceMassError) > Number.EPSILON
        || Math.abs(Math.abs(mixedMass - 1) - step.mixedMassError) > Number.EPSILON
        || Math.abs(step.plackettLuceProbabilityMass - plMass) > TARGET_DISTRIBUTION_MASS_TOLERANCE
        || Math.abs(step.mixedProbabilityMass - mixedMass) > TARGET_DISTRIBUTION_MASS_TOLERANCE
      ) {
        fail('target_probability_mass_mismatch');
      }
      maxStepActionCount = Math.max(maxStepActionCount, actions.length);
      maxPrefixActionCount = Math.max(maxPrefixActionCount, step.prefixActionKeys.length);
      await visitor?.onStep?.(decision, {
        servedPosition: position,
        prefixActionKeys: step.prefixActionKeys,
        actions,
      });
      decisionStepCount += 1;
      decisionActionCount += actions.length;
      stepCount += 1;
      actionCount += actions.length;
    }
    const endLine = await distributionReader.nextLine();
    if (endLine === undefined) fail('target_stream_grammar_mismatch');
    const end = parseDistributionLine(endLine);
    if (end.recordType !== 'decision_end') fail('target_stream_grammar_mismatch');
    if (
      end.decisionId !== source.decisionId
      || end.stepCount !== decisionStepCount
      || end.actionProbabilityCount !== decisionActionCount
      || end.decisionRecordsSha256 !== recordsHash.digest('hex')
    ) {
      fail('target_decision_digest_mismatch');
    }
    decisionCount += 1;
    await visitor?.onDecisionEnd?.(decision);
  }
  if (await distributionReader.nextLine() !== undefined) fail('target_source_membership_mismatch');
  const sourceDigest = sourceReader.digest();
  const distributionDigest = distributionReader.digest();
  const sourceManifestDigest = sha256Text(input.sourceDatasetManifestRaw);
  const targetManifestDigest = sha256Text(input.targetManifestRaw);
  const receiptRawDigest = sha256Text(input.verificationReceiptRaw);
  const policyDigest = sha256Text(canonicalDecisionJson(policy));
  const policyRawDigest = sha256Text(input.policyConfigRaw);
  if (
    sourceManifest.sourceDecisionNdjsonSha256 !== sourceDigest
    || sourceManifest.decisionCount !== decisionCount
    || manifest.datasetVersion !== sourceManifest.datasetVersion
    || manifest.sourceDecisionNdjsonSha256 !== sourceDigest
    || manifest.sourceDatasetManifestSha256 !== sourceManifestDigest
    || manifest.policyConfigSha256 !== policyDigest
    || manifest.distributionNdjsonSha256 !== distributionDigest
    || receipt.sourceDecisionNdjsonSha256 !== sourceDigest
    || receipt.sourceDatasetManifestSha256 !== sourceManifestDigest
    || receipt.policyConfigSha256 !== policyDigest
    || receipt.policyConfigRawSha256 !== policyRawDigest
    || receipt.distributionNdjsonSha256 !== distributionDigest
    || receipt.targetManifestSha256 !== targetManifestDigest
  ) {
    fail('target_root_digest_mismatch');
  }
  const physicalRecordCount = distributionReader.recordCount();
  if (
    manifest.decisionCount !== decisionCount
    || manifest.stepCount !== stepCount
    || manifest.actionProbabilityCount !== actionCount
    || manifest.physicalRecordCount !== physicalRecordCount
    || receipt.verifiedDecisionCount !== decisionCount
    || receipt.verifiedStepCount !== stepCount
    || receipt.verifiedActionProbabilityCount !== actionCount
    || receipt.verifiedPhysicalRecordCount !== physicalRecordCount
  ) {
    fail('target_count_mismatch');
  }
  const diagnostics = receipt.highWaterDiagnostics;
  if (
    diagnostics.maxSourceLineBytes !== sourceReader.maxLineBytes
    || diagnostics.maxDistributionLineBytes !== distributionReader.maxLineBytes
    || diagnostics.maxCandidateCount !== maxCandidateCount
    || diagnostics.maxStepActionCount !== maxStepActionCount
    || diagnostics.maxPrefixActionCount !== maxPrefixActionCount
  ) {
    fail('target_count_mismatch');
  }
  return {
    contractVersion: 'target_distribution_contract_validation_v2',
    receiptSha256: receipt.verificationReceiptSha256,
    sourceDecisionNdjsonSha256: sourceDigest,
    distributionNdjsonSha256: distributionDigest,
    decisionCount,
    stepCount,
    actionProbabilityCount: actionCount,
    physicalRecordCount,
    realDatasetEligible: false,
    servable: false,
    manifest,
    receipt,
    sourceDatasetManifestSha256: sourceManifestDigest,
    targetManifestSha256: targetManifestDigest,
    verificationReceiptRawSha256: receiptRawDigest,
  };
  } finally {
    await Promise.allSettled([sourceReader.close(), distributionReader.close()]);
  }
}

function evidenceDigest(evidence: VerifiedTargetDistributionEvidenceV2): string {
  return sha256Text(canonicalDecisionJson(evidence));
}

function hasTrustedSyntheticRoot(
  input: TargetDistributionStreamVerificationInputV2,
  evidence: Pick<
    VerifiedTargetDistributionEvidenceV2,
    'receipt' | 'verificationReceiptRawSha256'
  >,
): boolean {
  if (input.trustScope !== 'synthetic_fixture') return false;
  const now = Date.now();
  return SYNTHETIC_ROOT_REGISTRY.some((registration) => (
    evidence.receipt.verifierBuildFingerprintSha256
      === registration.root.verifierBuildFingerprintSha256
    && evidence.receipt.verificationReceiptSha256
      === registration.root.expectedReceiptSha256
    && evidence.verificationReceiptRawSha256
      === registration.root.expectedReceiptRawSha256
    && sha256Text(`${JSON.stringify({
      fixtureVersion: registration.fixtureVersion,
      sourceFixturePath: registration.sourceFixturePath,
      expectedReceipt: evidence.receipt,
    }, null, 2)}\n`) === registration.root.sourceBundleSha256
    && now >= Date.parse(registration.root.validFrom)
    && now <= Date.parse(registration.root.validThrough)
    && registration.root.rootDigest
      === sha256Text(canonicalDecisionJson(registration.preimage))
  ));
}

export function syntheticTargetTrustRootAuditV1(): Readonly<typeof SYNTHETIC_ROOT> {
  return SYNTHETIC_ROOT;
}

export async function verifyTargetDistributionStreamV2(
  input: TargetDistributionStreamVerificationInputV2,
): Promise<VerifyTargetDistributionStreamResultV2> {
  try {
    const summary = await runVerification(input);
    if (!hasTrustedSyntheticRoot(input, summary)) {
      const { manifest: _manifest, receipt: _receipt, sourceDatasetManifestSha256: _sourceRoot,
        targetManifestSha256: _targetRoot, verificationReceiptRawSha256: _receiptRaw,
        ...validation } = summary;
      return deepFreeze({
        status: 'contract_validated' as const,
        blocker: 'rust_verification_trust_root_unavailable' as const,
        validation,
      });
    }
    const evidence: VerifiedTargetDistributionEvidenceV2 = deepFreeze({
      contractVersion: 'verified_target_distribution_evidence_v2',
      trustScope: 'synthetic_fixture',
      manifest: summary.manifest,
      receipt: summary.receipt,
      sourceDatasetManifestSha256: summary.sourceDatasetManifestSha256,
      targetManifestSha256: summary.targetManifestSha256,
      verificationReceiptRawSha256: summary.verificationReceiptRawSha256,
      realDatasetEligible: false,
      servable: false,
    });
    verifiedEvidence.add(evidence);
    verifiedBindings.set(evidence, {
      digest: evidenceDigest(evidence),
      sourceDecisionStream: input.sourceDecisionStream,
      distributionStream: input.distributionStream,
      input,
    });
    return deepFreeze({ status: 'verified' as const, evidence });
  } catch (error) {
    if (error instanceof TargetEvidenceStreamError) {
      return { status: 'not_evaluable', blocker: error.blocker };
    }
    return { status: 'not_evaluable', blocker: 'target_contract_invalid' };
  }
}

export function isVerifiedTargetDistributionEvidenceV2(
  value: unknown,
): value is VerifiedTargetDistributionEvidenceV2 {
  try {
    if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
    const binding = verifiedBindings.get(value);
    return verifiedEvidence.has(value)
      && binding !== undefined
      && binding.digest === evidenceDigest(value as VerifiedTargetDistributionEvidenceV2)
      && hasTrustedSyntheticRoot(
        binding.input,
        value as VerifiedTargetDistributionEvidenceV2,
      );
  } catch {
    return false;
  }
}

class TargetTransactionCallbackError extends Error {
  constructor() {
    super('target_transaction_callback_failed');
    this.name = 'TargetTransactionCallbackError';
  }
}

async function safeAbortTargetTransaction(
  visitor: TargetDistributionReplayVisitorV2,
  blocker: string,
): Promise<string> {
  try {
    await visitor.abort(blocker);
    return blocker;
  } catch {
    return 'target_transaction_abort_failed';
  }
}

async function invokeTargetTransactionCallback(
  callback: (() => Promise<void> | void) | undefined,
): Promise<void> {
  if (!callback) return;
  try {
    await callback();
  } catch {
    throw new TargetTransactionCallbackError();
  }
}

export async function replayVerifiedTargetDistributionV2(
  evidence: VerifiedTargetDistributionEvidenceV2,
  visitor: TargetDistributionReplayVisitorV2,
): Promise<{ status: 'verified' } | { status: 'not_evaluable'; blocker: string }> {
  let binding: ReturnType<typeof verifiedBindings.get>;
  try {
    if (!evidence || typeof evidence !== 'object' || !Object.isFrozen(evidence)) {
      return { status: 'not_evaluable', blocker: 'target_verified_brand_missing' };
    }
    binding = verifiedBindings.get(evidence);
    if (
      !verifiedEvidence.has(evidence)
      || binding === undefined
      || binding.digest !== evidenceDigest(evidence)
    ) {
      return { status: 'not_evaluable', blocker: 'target_verified_brand_missing' };
    }
  } catch {
    return { status: 'not_evaluable', blocker: 'target_verified_brand_missing' };
  }
  if (!hasTrustedSyntheticRoot(binding.input, evidence)) {
    return {
      status: 'not_evaluable',
      blocker: await safeAbortTargetTransaction(
        visitor,
        'rust_verification_trust_root_unavailable',
      ),
    };
  }
  let summary: RunSummary;
  try {
    summary = await runVerification({
      ...binding.input,
      sourceDecisionStream: binding.sourceDecisionStream,
      distributionStream: binding.distributionStream,
    }, {
      onDecisionStart: visitor.onDecisionStart
        ? (decision) => invokeTargetTransactionCallback(
          () => visitor.onDecisionStart!(decision),
        )
        : undefined,
      onStep: visitor.onStep
        ? (decision, step) => invokeTargetTransactionCallback(
          () => visitor.onStep!(decision, step),
        )
        : undefined,
      onDecisionEnd: visitor.onDecisionEnd
        ? (decision) => invokeTargetTransactionCallback(
          () => visitor.onDecisionEnd!(decision),
        )
        : undefined,
      commit: visitor.commit,
      abort: visitor.abort,
    });
  } catch (error) {
    const blocker = error instanceof TargetTransactionCallbackError
      ? 'target_transaction_callback_failed'
      : error instanceof TargetEvidenceStreamError
        ? error.blocker
        : 'target_contract_invalid';
    return {
      status: 'not_evaluable',
      blocker: await safeAbortTargetTransaction(visitor, blocker),
    };
  }
  if (!hasTrustedSyntheticRoot(binding.input, evidence)) {
    return {
      status: 'not_evaluable',
      blocker: await safeAbortTargetTransaction(
        visitor,
        'rust_verification_trust_root_unavailable',
      ),
    };
  }
  if (
    summary.sourceDecisionNdjsonSha256 !== evidence.receipt.sourceDecisionNdjsonSha256
    || summary.distributionNdjsonSha256 !== evidence.receipt.distributionNdjsonSha256
  ) {
    return {
      status: 'not_evaluable',
      blocker: await safeAbortTargetTransaction(visitor, 'target_root_digest_mismatch'),
    };
  }
  try {
    await visitor.commit();
  } catch {
    return {
      status: 'not_evaluable',
      blocker: await safeAbortTargetTransaction(visitor, 'target_transaction_commit_failed'),
    };
  }
  return { status: 'verified' };
}
