import {
  createCipheriv,
  createHash,
  hkdfSync,
} from 'crypto';

import {
  canonicalDecisionJson,
  decisionLogSha256,
} from '../../decisionLog/contracts';
import {
  MAX_CANDIDATE_POOL_SIZE,
  MAX_SLATE_SIZE,
  RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE,
} from '../contracts';
import {
  DEVELOPMENT_FIXTURE_SHA256,
  DEVELOPMENT_INPUT_SHA256,
  DEVELOPMENT_MAX_ALLOCATION_BYTES,
  DEVELOPMENT_MAX_HASH_BYTES,
  DEVELOPMENT_MAX_OUTPUT_BYTES,
  DEVELOPMENT_MAX_RAW_BYTES,
  DEVELOPMENT_MAX_WORK_UNITS,
  DEVELOPMENT_RNG_SUITE,
  DEVELOPMENT_SOURCE_FIXTURE_SHA256,
  DEVELOPMENT_TRANSCRIPT_SHA256,
  FIXED_RECEIPT_BYTES,
  FIXED_RUST64_ACTION_WORKING_BYTES,
  FIXED_RUST64_CANDIDATE_WORKING_BYTES,
  JSON_STRING_EXPANSION,
  OPEN53_DENOMINATOR,
  OPEN53_MASK,
  OPEN53_WORD_BYTES,
  OPEN53_WORDS_PER_DRAW,
  PER_ACTION_RECEIPT_BYTES,
  developmentFixtureSchema,
  developmentSourceFixtureSchema,
  type DevelopmentFixtureV2,
  type DevelopmentSourceFixtureV1,
  type DevelopmentVerificationBlockerV2,
  type RandomizedSlateDevelopmentVerificationV2,
  type VerifiedRandomizedSlateDevelopmentTranscriptV2,
} from './contracts';

const verifiedEvidence = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function frame(parts: readonly Buffer[]): Buffer {
  return Buffer.concat(parts.flatMap((part) => {
    const size = Buffer.allocUnsafe(4);
    size.writeUInt32BE(part.length);
    return [size, part];
  }));
}

function utf8(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

function digestFrames(parts: readonly Buffer[]): string {
  return sha256(frame(parts));
}

function recursivelyFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) recursivelyFreeze(Reflect.get(value, key), seen);
  return Object.freeze(value);
}

function isRecursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  try {
    return Object.isFrozen(value)
      && Reflect.ownKeys(value).every((key) => isRecursivelyFrozen(Reflect.get(value, key), seen));
  } catch {
    return false;
  }
}

function reject(blocker: DevelopmentVerificationBlockerV2): RandomizedSlateDevelopmentVerificationV2 {
  return Object.freeze({ status: 'rejected', blocker });
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function canonicalWireNumber(value: number, forceFloat: boolean): string {
  if (!Number.isFinite(value)) throw new Error('wire number must be finite');
  if (forceFloat && Number.isInteger(value)) return `${value}.0`;
  return JSON.stringify(Object.is(value, -0) ? 0 : value);
}

function rustDevelopmentInputWireJson(value: unknown, path: readonly string[] = []): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    const joined = path.join('.');
    const forceFloat = joined === 'config.epsilon'
      || joined === 'config.temperature'
      || /sourceDecisionLog\.candidatePool\.candidates\.\d+\.score$/.test(joined)
      || /sourceDecisionLog\.candidatePool\.candidates\.\d+\.objectiveEvidence\.\d+\.prediction$/.test(joined)
      || /sourceDecisionLog\.actions\.\d+\.behaviorPropensity\.selectionProbability$/.test(joined);
    return canonicalWireNumber(value, forceFloat);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => rustDevelopmentInputWireJson(entry, [...path, String(index)])).join(',')}]`;
  }
  if (!value || typeof value !== 'object') throw new Error('unsupported wire value');
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${rustDevelopmentInputWireJson((value as Record<string, unknown>)[key], [...path, key])}`
  )).join(',')}}`;
}

function verifyReceipt(
  fixture: DevelopmentFixtureV2,
  sourceFixture: DevelopmentSourceFixtureV1,
): boolean {
  const receipt = fixture.expected;
  const sourceInput = sourceFixture.input;
  const source = sourceInput.sourceDecisionLog;
  const sourceSha = decisionLogSha256(source);
  const configSha = sha256(canonicalDecisionJson(sourceInput.config));
  const poolSha = source.candidatePool.candidatePoolSha256;
  if (fixture.sourceFixtureSha256 !== DEVELOPMENT_SOURCE_FIXTURE_SHA256
    || fixture.inputSha256 !== DEVELOPMENT_INPUT_SHA256
    || receipt.transcriptSha256 !== DEVELOPMENT_TRANSCRIPT_SHA256
    || receipt.policyConfigSha256 !== configSha
    || receipt.decisionFingerprint.decisionId !== source.decisionId
    || receipt.decisionFingerprint.sha256 !== sourceInput.sourceDecisionLogSha256
    || sourceSha !== sourceInput.sourceDecisionLogSha256
    || receipt.candidatePoolFingerprint.sha256 !== poolSha
    || receipt.epochId !== fixture.epochId
    || receipt.revealedDevelopmentSeedHex !== fixture.revealedDevelopmentSeedHex
    || receipt.seedCommitmentSha256 !== fixture.seedCommitmentSha256
    || canonicalDecisionJson(receipt.policy) !== canonicalDecisionJson(sourceInput.config)) return false;

  const seed = Buffer.from(fixture.revealedDevelopmentSeedHex, 'hex');
  const commitment = digestFrames([
    utf8('telegram/randomized-logging/seed-commit/v1'),
    utf8(DEVELOPMENT_RNG_SUITE),
    utf8(fixture.epochId),
    seed,
  ]);
  if (commitment !== fixture.seedCommitmentSha256) return false;

  const info = frame([
    utf8('telegram/randomized-slate/draw-key/v1'),
    utf8(DEVELOPMENT_RNG_SUITE),
    utf8(fixture.epochId),
    utf8(source.decisionId),
    Buffer.from(sourceSha, 'hex'),
    Buffer.from(poolSha, 'hex'),
    Buffer.from(configSha, 'hex'),
  ]);
  if (sha256(info) !== receipt.rngContextSha256) return false;
  const salt = createHash('sha256')
    .update(frame([utf8('telegram/randomized-logging/hkdf-salt/v1')]))
    .digest();
  const key = Buffer.from(hkdfSync('sha256', seed, salt, info, 32));
  const cipher = createCipheriv('chacha20', key, Buffer.alloc(16));
  const stream = Buffer.concat([
    cipher.update(Buffer.alloc(receipt.resourceReceipt.actualRngBytes)),
    cipher.final(),
  ]);

  const input = {
    contractVersion: 'randomized_slate_development_input_v2',
    sourceDecisionLog: source,
    sourceDecisionLogSha256: sourceInput.sourceDecisionLogSha256,
    config: sourceInput.config,
    epochId: fixture.epochId,
    revealedDevelopmentSeedHex: fixture.revealedDevelopmentSeedHex,
    seedCommitmentSha256: fixture.seedCommitmentSha256,
  };
  const inputRaw = rustDevelopmentInputWireJson(input);
  if (Buffer.byteLength(inputRaw) !== receipt.resourceReceipt.rawInputBytes
    || sha256(inputRaw) !== fixture.inputSha256) return false;

  const remaining = source.candidatePool.candidates
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => left.poolRank - right.poolRank
      || compareText(left.candidateNamespace, right.candidateNamespace)
      || compareText(left.candidateId, right.candidateId));
  const prefix: Array<(typeof receipt.orderedActions)[number]['actionKey']> = [];
  let expectedOffset = 0;
  let actualWords = 0;
  let jointLog = 0;
  let joint = 1;

  for (const [index, action] of receipt.orderedActions.entries()) {
    const position = index + 1;
    const selectedIndex = remaining.findIndex((candidate) => (
      candidate.candidateNamespace === action.actionKey.candidateNamespace
      && candidate.candidateId === action.actionKey.candidateId
    ));
    const top = remaining[0];
    const transcript = action.randomTranscript;
    if (selectedIndex < 0 || !top
      || action.actionKey.servedPosition !== position
      || action.deterministicTopActionKey.servedPosition !== position
      || action.deterministicTopActionKey.candidateNamespace !== top.candidateNamespace
      || action.deterministicTopActionKey.candidateId !== top.candidateId
      || action.selectedWasDeterministicTop !== (selectedIndex === 0)
      || action.remainingCandidateCount !== remaining.length
      || action.prefixSha256 !== sha256(canonicalDecisionJson(prefix))
      || action.remainingSupportSha256 !== sha256(canonicalDecisionJson(remaining))
      || transcript.startByteOffset !== expectedOffset) return false;

    for (const [wordIndex, wordHex] of transcript.rawWordsHex.entries()) {
      const offset = expectedOffset + wordIndex * OPEN53_WORD_BYTES;
      const word = stream.subarray(offset, offset + OPEN53_WORD_BYTES).readBigUInt64LE();
      if (word.toString(16).padStart(16, '0') !== wordHex
        || (wordIndex + 1 < transcript.rawWordsHex.length && (word & OPEN53_MASK) !== 0n)) return false;
    }
    const lastWord = BigInt(`0x${transcript.rawWordsHex[transcript.rawWordsHex.length - 1]}`);
    const accepted = lastWord & OPEN53_MASK;
    const uniform = Number(accepted) / OPEN53_DENOMINATOR;
    if (accepted === 0n || accepted.toString() !== transcript.acceptedUnsigned53
      || uniform !== transcript.uniformDraw
      || uniform < action.selectedIntervalLowerInclusive
      || uniform >= action.selectedIntervalUpperExclusive
      || Math.abs(action.selectedIntervalUpperExclusive - action.selectedIntervalLowerInclusive
        - action.conditionalSelectionProbability) > RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE) return false;

    expectedOffset += transcript.rawWordsHex.length * OPEN53_WORD_BYTES;
    actualWords += transcript.rawWordsHex.length;
    jointLog += action.conditionalLogProbability;
    joint *= action.conditionalSelectionProbability;
    prefix.push(action.actionKey);
    remaining.splice(selectedIndex, 1);
  }

  const jointEvidence = receipt.orderedJointProbability;
  if (jointEvidence.logJointConditionalSelectionProbability !== jointLog
    || (joint > 0 && (jointEvidence.status !== 'finite_positive'
      || jointEvidence.jointConditionalSelectionProbability !== joint))
    || (joint === 0 && (jointEvidence.status !== 'underflow_log_only'
      || jointEvidence.jointConditionalSelectionProbability !== null))) return false;

  const support = receipt.supportDiagnostics;
  const resource = receipt.resourceReceipt;
  const sourceCount = source.candidatePool.candidates.length;
  const eligibleCount = source.candidatePool.candidates.filter((candidate) => candidate.eligible).length;
  const slateSize = receipt.policy.slateSize;
  const evaluations = slateSize * eligibleCount - (slateSize * (slateSize - 1)) / 2;
  const shifts = evaluations - slateSize;
  const sortComparisons = eligibleCount * eligibleCount;
  const work = sortComparisons + evaluations * 2 + shifts;
  const identityBytes = source.candidatePool.candidates
    .filter((candidate) => candidate.eligible)
    .map((candidate) => Buffer.byteLength(candidate.candidateNamespace) + Buffer.byteLength(candidate.candidateId));
  const plannedOutput = FIXED_RECEIPT_BYTES
    + Buffer.byteLength(canonicalDecisionJson(receipt.policy))
    + Buffer.byteLength(fixture.epochId) * JSON_STRING_EXPANSION
    + (identityBytes.reduce((sum, value) => sum + value, 0)
      + slateSize * Math.max(...identityBytes)) * JSON_STRING_EXPANSION
    + slateSize * PER_ACTION_RECEIPT_BYTES;
  const plannedHash = Buffer.byteLength(canonicalDecisionJson(source)) * (slateSize * 3 + 8)
    + Buffer.byteLength(canonicalDecisionJson(receipt.policy)) * 4
    + Buffer.byteLength(inputRaw)
    + plannedOutput * 12;
  // This fixed fixture pins the producing 64-bit Rust ABI, not a portable admission formula.
  const plannedAllocation = Buffer.byteLength(canonicalDecisionJson(source))
    + Buffer.byteLength(canonicalDecisionJson(receipt.policy))
    + plannedOutput
    + eligibleCount * FIXED_RUST64_CANDIDATE_WORKING_BYTES
    + slateSize * FIXED_RUST64_ACTION_WORKING_BYTES;
  if (sourceCount > MAX_CANDIDATE_POOL_SIZE || slateSize > MAX_SLATE_SIZE
    || slateSize > eligibleCount
    || support.sourceCandidateCount !== sourceCount
    || support.eligibleCandidateCount !== eligibleCount
    || support.excludedIneligibleCandidateCount !== sourceCount - eligibleCount
    || support.sampledCount !== slateSize
    || receipt.orderedActions.length !== slateSize
    || resource.maximumRawInputBytes !== DEVELOPMENT_MAX_RAW_BYTES
    || resource.maximumOutputCanonicalBytes !== DEVELOPMENT_MAX_OUTPUT_BYTES
    || resource.maximumHashBytes !== DEVELOPMENT_MAX_HASH_BYTES
    || resource.maximumAlgorithmAllocationBytes !== DEVELOPMENT_MAX_ALLOCATION_BYTES
    || resource.maximumCandidateWorkUnits !== DEVELOPMENT_MAX_WORK_UNITS
    || resource.rawInputBytes > resource.maximumRawInputBytes
    || resource.plannedOutputCanonicalBytesUpperBound > resource.maximumOutputCanonicalBytes
    || resource.plannedHashBytesUpperBound > resource.maximumHashBytes
    || resource.plannedAlgorithmAllocationBytesUpperBound
      > resource.maximumAlgorithmAllocationBytes
    || resource.candidateWorkUnits > resource.maximumCandidateWorkUnits
    || resource.actualRngWords > resource.maximumRngWords
    || resource.actualRngBytes > resource.maximumRngBytes
    || resource.actualOutputCanonicalBytes
      > resource.plannedOutputCanonicalBytesUpperBound
    || resource.rawInputBytes !== Buffer.byteLength(inputRaw)
    || resource.sourceDecisionCanonicalBytes !== Buffer.byteLength(canonicalDecisionJson(source))
    || resource.policyConfigCanonicalBytes !== Buffer.byteLength(canonicalDecisionJson(receipt.policy))
    || resource.candidateCount !== sourceCount
    || resource.eligibleCandidateCount !== eligibleCount
    || resource.slateSize !== slateSize
    || resource.baselineSortPasses !== 1
    || resource.baselineSortItems !== eligibleCount
    || resource.baselineSortComparisonUpperBound !== sortComparisons
    || resource.distributionEntryEvaluations !== evaluations
    || resource.selectionComparisonUpperBound !== evaluations
    || resource.removalShiftUpperBound !== shifts
    || resource.candidateWorkUnits !== work
    || resource.maximumRngWords !== slateSize * OPEN53_WORDS_PER_DRAW
    || resource.maximumRngBytes !== slateSize * OPEN53_WORDS_PER_DRAW * OPEN53_WORD_BYTES
    || resource.actualRngWords !== actualWords
    || resource.actualRngBytes !== expectedOffset
    || resource.plannedOutputCanonicalBytesUpperBound !== plannedOutput
    || resource.plannedHashBytesUpperBound !== plannedHash
    || resource.plannedAlgorithmAllocationBytesUpperBound !== plannedAllocation
    || resource.actualOutputCanonicalBytes !== Buffer.byteLength(canonicalDecisionJson(receipt))) return false;

  if (receipt.numericalDiagnostics.steps.length !== slateSize) return false;
  let maxError = 0;
  for (const [index, step] of receipt.numericalDiagnostics.steps.entries()) {
    const error = Math.max(
      Math.abs(step.plackettLuceProbabilityMass - 1),
      Math.abs(step.mixedProbabilityMass - 1),
    );
    if (step.servedPosition !== index + 1
      || step.remainingCandidateCount !== eligibleCount - index
      || step.probabilityMassError !== error
      || error > RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE) return false;
    maxError = Math.max(maxError, error);
  }
  if (receipt.numericalDiagnostics.maxProbabilityMassError !== maxError) return false;

  const { transcriptSha256: _, ...preimage } = receipt;
  return sha256(canonicalDecisionJson(preimage)) === receipt.transcriptSha256;
}

export function verifyRandomizedSlateDevelopmentFixtureV2(
  fixtureRaw: unknown,
  sourceFixtureRaw: unknown,
): RandomizedSlateDevelopmentVerificationV2 {
  if (!Buffer.isBuffer(fixtureRaw) || !Buffer.isBuffer(sourceFixtureRaw)
    || fixtureRaw.length > DEVELOPMENT_MAX_RAW_BYTES
    || sourceFixtureRaw.length > DEVELOPMENT_MAX_RAW_BYTES) {
    return reject('resource_limit_exceeded');
  }
  if (sha256(fixtureRaw) !== DEVELOPMENT_FIXTURE_SHA256) return reject('fixture_root_mismatch');
  if (sha256(sourceFixtureRaw) !== DEVELOPMENT_SOURCE_FIXTURE_SHA256) {
    return reject('source_fixture_root_mismatch');
  }

  try {
    const parsedFixture = developmentFixtureSchema.safeParse(JSON.parse(fixtureRaw.toString('utf8')));
    const parsedSource = developmentSourceFixtureSchema.safeParse(JSON.parse(sourceFixtureRaw.toString('utf8')));
    if (!parsedFixture.success || !parsedSource.success
      || !verifyReceipt(parsedFixture.data, parsedSource.data)) {
      return reject('development_transcript_invalid');
    }
    const preimage = {
      contractVersion: 'verified_randomized_slate_development_transcript_v2' as const,
      verificationStatus: 'verified_development_fixture_only' as const,
      fixtureSha256: DEVELOPMENT_FIXTURE_SHA256,
      sourceFixtureSha256: DEVELOPMENT_SOURCE_FIXTURE_SHA256,
      inputSha256: DEVELOPMENT_INPUT_SHA256,
      transcriptSha256: DEVELOPMENT_TRANSCRIPT_SHA256,
      rngContextSha256: parsedFixture.data.expected.rngContextSha256,
      evidenceKind: 'simulated_propensity' as const,
      servable: false as const,
      realDatasetEligible: false as const,
    };
    const evidence = recursivelyFreeze({
      ...preimage,
      verificationSha256: sha256(canonicalDecisionJson(preimage)),
    });
    verifiedEvidence.add(evidence);
    verifiedDigests.set(evidence, evidence.verificationSha256);
    return Object.freeze({ status: 'verified', evidence });
  } catch {
    return reject('development_transcript_invalid');
  }
}

export function isVerifiedRandomizedSlateDevelopmentTranscriptV2(
  value: unknown,
): value is VerifiedRandomizedSlateDevelopmentTranscriptV2 {
  if (!value || typeof value !== 'object') return false;
  try {
    const candidate = value as VerifiedRandomizedSlateDevelopmentTranscriptV2;
    const { verificationSha256: _, ...preimage } = candidate;
    return verifiedEvidence.has(value)
      && isRecursivelyFrozen(value)
      && verifiedDigests.get(value) === candidate.verificationSha256
      && candidate.verificationSha256 === sha256(canonicalDecisionJson(preimage));
  } catch {
    return false;
  }
}
