import { z } from 'zod';

import { decisionActionKeySchema } from '../../decisionLog/contracts';
import {
  MAX_SLATE_SIZE,
  RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE,
  randomizedSlateConfigSchema,
  randomizedSlateSimulationInputSchema,
} from '../contracts';

export const DEVELOPMENT_FIXTURE_SHA256 = 'dafedbbe2c64389e0d8c3b3fa53850526b88691113cdc6afae74e87a97260146';
export const DEVELOPMENT_SOURCE_FIXTURE_SHA256 = '51a2c8d8ba3bf910ede869fa645244246e081fa4d8fc4e326d055a27fb188aaf';
export const DEVELOPMENT_INPUT_SHA256 = '1718ced2cfa29eeca3e878ba2e2a1a7dae20de4e6f4790e02accd280e51110ea';
export const DEVELOPMENT_TRANSCRIPT_SHA256 = 'e31870c6648d46ffc80a4d67c0c1614936b215fdf8881fedf0108e8859f7097b';
export const DEVELOPMENT_RNG_SUITE = 'hkdf-sha256+rfc8439-chacha20+open53/v1';
export const DEVELOPMENT_MAX_RAW_BYTES = 32 * 1024 * 1024;
export const DEVELOPMENT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const DEVELOPMENT_MAX_HASH_BYTES = 512 * 1024 * 1024;
export const DEVELOPMENT_MAX_ALLOCATION_BYTES = 128 * 1024 * 1024;
export const DEVELOPMENT_MAX_WORK_UNITS = 5_000_000;
export const OPEN53_WORDS_PER_DRAW = 4;
export const OPEN53_WORD_BYTES = 8;
export const OPEN53_MASK = (1n << 53n) - 1n;
export const OPEN53_DENOMINATOR = 2 ** 53;
export const FIXED_RECEIPT_BYTES = 1024 * 1024;
export const PER_ACTION_RECEIPT_BYTES = 4096;
export const JSON_STRING_EXPANSION = 6;
export const FIXED_RUST64_CANDIDATE_WORKING_BYTES = 96;
export const FIXED_RUST64_ACTION_WORKING_BYTES = 312;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const u32Schema = z.number().int().nonnegative().max(0xffff_ffff);
const positiveU32Schema = z.number().int().positive().max(0xffff_ffff);
const safeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const probabilitySchema = z.number().finite().gt(0).lte(1);

const randomTranscriptSchema = z.object({
  startByteOffset: safeCountSchema,
  rawWordsHex: z.array(z.string().regex(/^[0-9a-f]{16}$/)).min(1).max(OPEN53_WORDS_PER_DRAW),
  acceptedUnsigned53: z.string().regex(/^[1-9][0-9]*$/),
  uniformDraw: z.number().finite().gt(0).lt(1),
}).strict();

const actionSchema = z.object({
  actionKey: decisionActionKeySchema,
  deterministicTopActionKey: decisionActionKeySchema,
  selectedWasDeterministicTop: z.boolean(),
  prefixSha256: sha256Schema,
  remainingSupportSha256: sha256Schema,
  remainingCandidateCount: u32Schema,
  distributionSha256: sha256Schema,
  plackettLuceProbability: probabilitySchema,
  conditionalSelectionProbability: probabilitySchema,
  conditionalLogProbability: z.number().finite().nonpositive(),
  selectedIntervalLowerInclusive: z.number().finite().min(0).lt(1),
  selectedIntervalUpperExclusive: z.number().finite().gt(0).max(1),
  randomTranscript: randomTranscriptSchema,
}).strict();

const numericalStepSchema = z.object({
  servedPosition: positiveU32Schema,
  remainingCandidateCount: u32Schema,
  plackettLuceProbabilityMass: z.number().finite(),
  mixedProbabilityMass: z.number().finite(),
  probabilityMassError: z.number().finite().nonnegative(),
}).strict();

const resourceReceiptSchema = z.object({
  limitsVersion: z.literal('randomized_slate_development_resource_limits_v1'),
  rawInputAdmission: z.literal('admitted_before_parse_v1'),
  algorithmAdmission: z.literal('admitted_before_rng_and_policy_v1'),
  maximumRawInputBytes: safeCountSchema,
  maximumOutputCanonicalBytes: safeCountSchema,
  maximumHashBytes: safeCountSchema,
  maximumAlgorithmAllocationBytes: safeCountSchema,
  maximumCandidateWorkUnits: safeCountSchema,
  rawInputBytes: safeCountSchema,
  sourceDecisionCanonicalBytes: safeCountSchema,
  policyConfigCanonicalBytes: safeCountSchema,
  candidateCount: u32Schema,
  eligibleCandidateCount: u32Schema,
  slateSize: u32Schema,
  baselineSortPasses: u32Schema,
  baselineSortItems: u32Schema,
  baselineSortComparisonUpperBound: safeCountSchema,
  distributionEntryEvaluations: safeCountSchema,
  selectionComparisonUpperBound: safeCountSchema,
  removalShiftUpperBound: safeCountSchema,
  candidateWorkUnits: safeCountSchema,
  maximumRngWords: safeCountSchema,
  maximumRngBytes: safeCountSchema,
  plannedOutputCanonicalBytesUpperBound: safeCountSchema,
  plannedHashBytesUpperBound: safeCountSchema,
  plannedAlgorithmAllocationBytesUpperBound: safeCountSchema,
  actualRngWords: safeCountSchema,
  actualRngBytes: safeCountSchema,
  actualOutputCanonicalBytes: safeCountSchema,
}).strict();

const receiptSchema = z.object({
  contractVersion: z.literal('randomized_slate_development_receipt_v2'),
  status: z.literal('simulated'),
  policy: randomizedSlateConfigSchema,
  policyConfigSha256: sha256Schema,
  policyArithmeticVersion: z.literal('rust_epsilon_plackett_luce_binary64_v1'),
  baselineOrderVersion: z.literal('decision_pool_rank_then_identity_v1'),
  probabilitySemantics: z.literal('conditional_on_prior_slate_prefix_v1'),
  rngProtocol: z.literal(DEVELOPMENT_RNG_SUITE),
  commitmentPurpose: z.literal('development_reveal_consistency_only_v1'),
  epochId: z.string().min(1).max(128),
  revealedDevelopmentSeedHex: z.string().regex(/^[0-9a-f]{64}$/),
  seedCommitmentSha256: sha256Schema,
  rngContextSha256: sha256Schema,
  decisionFingerprint: z.object({
    decisionId: z.string().min(1),
    sha256: sha256Schema,
  }).strict(),
  candidatePoolFingerprint: z.object({ sha256: sha256Schema }).strict(),
  orderedActions: z.array(actionSchema).min(1).max(MAX_SLATE_SIZE),
  orderedJointProbability: z.object({
    status: z.enum(['finite_positive', 'underflow_log_only']),
    logJointConditionalSelectionProbability: z.number().finite().nonpositive(),
    jointConditionalSelectionProbability: probabilitySchema.nullable(),
  }).strict(),
  supportDiagnostics: z.object({
    sourceCandidateCount: u32Schema,
    eligibleCandidateCount: u32Schema,
    excludedIneligibleCandidateCount: u32Schema,
    sampledCount: u32Schema,
    withoutReplacement: z.literal(true),
  }).strict(),
  numericalDiagnostics: z.object({
    probabilityMassTolerance: z.literal(RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE),
    maxProbabilityMassError: z.number().finite().nonnegative(),
    steps: z.array(numericalStepSchema).min(1).max(MAX_SLATE_SIZE),
  }).strict(),
  resourceReceipt: resourceReceiptSchema,
  evidenceKind: z.literal('simulated_propensity'),
  servable: z.literal(false),
  realDatasetEligible: z.literal(false),
  transcriptSha256: sha256Schema,
}).strict();

export const developmentSourceFixtureSchema = z.object({
  fixtureVersion: z.literal('randomized_slate_simulation_fixture_v1'),
  input: randomizedSlateSimulationInputSchema,
  expected: z.unknown(),
}).strict();

export const developmentFixtureSchema = z.object({
  fixtureVersion: z.literal('randomized_slate_development_fixture_v2'),
  sourceFixturePath: z.literal('randomized_slate_simulation_v1.json'),
  sourceFixtureSha256: sha256Schema,
  inputSha256: sha256Schema,
  epochId: z.string().min(1).max(128),
  revealedDevelopmentSeedHex: z.string().regex(/^[0-9a-f]{64}$/),
  seedCommitmentSha256: sha256Schema,
  expected: receiptSchema,
}).strict();

export type DevelopmentFixtureV2 = z.infer<typeof developmentFixtureSchema>;
export type DevelopmentSourceFixtureV1 = z.infer<typeof developmentSourceFixtureSchema>;

export type VerifiedRandomizedSlateDevelopmentTranscriptV2 = Readonly<{
  contractVersion: 'verified_randomized_slate_development_transcript_v2';
  verificationStatus: 'verified_development_fixture_only';
  fixtureSha256: string;
  sourceFixtureSha256: string;
  inputSha256: string;
  transcriptSha256: string;
  rngContextSha256: string;
  evidenceKind: 'simulated_propensity';
  servable: false;
  realDatasetEligible: false;
  verificationSha256: string;
}>;

export type DevelopmentVerificationBlockerV2 =
  | 'resource_limit_exceeded'
  | 'fixture_root_mismatch'
  | 'source_fixture_root_mismatch'
  | 'development_transcript_invalid';

export type RandomizedSlateDevelopmentVerificationV2 =
  | { status: 'verified'; evidence: VerifiedRandomizedSlateDevelopmentTranscriptV2 }
  | { status: 'rejected'; blocker: DevelopmentVerificationBlockerV2 };
