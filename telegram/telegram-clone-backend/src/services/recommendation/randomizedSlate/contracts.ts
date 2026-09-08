import { z } from 'zod';

import {
  decisionActionKeySchema,
  recommendationDecisionLogSchema,
} from '../decisionLog/contracts';

export const RANDOMIZED_SLATE_SIMULATION_INPUT_VERSION =
  'randomized_slate_simulation_input_v1' as const;
export const RANDOMIZED_SLATE_SIMULATION_VERSION = 'randomized_slate_simulation_v1' as const;
export const RANDOMIZED_SLATE_POLICY_ID =
  'eligible_pool_epsilon_plackett_luce_v1' as const;
export const RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE = 1e-12;
export const MAX_CANDIDATE_POOL_SIZE = 2048;
export const MAX_SLATE_SIZE = 64;

const U32_MAX = 0xffff_ffff;
const nonEmptyString = z.string().trim().min(1);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const u32Schema = z.number().int().nonnegative().max(U32_MAX);
const oneBasedU32Schema = z.number().int().positive().max(U32_MAX);
const probabilitySchema = z.number().finite().gt(0).lte(1);

export const randomizedSlateConfigSchema = z.object({
  policyId: z.literal(RANDOMIZED_SLATE_POLICY_ID),
  policyVersion: nonEmptyString,
  configVersion: nonEmptyString,
  epsilon: z.number().finite().gt(0).lte(1),
  temperature: z.number().finite().gt(0),
  slateSize: oneBasedU32Schema,
}).strict();

export const randomizedSlateSimulationInputSchema = z.object({
  contractVersion: z.literal(RANDOMIZED_SLATE_SIMULATION_INPUT_VERSION),
  sourceDecisionLog: recommendationDecisionLogSchema,
  sourceDecisionLogSha256: sha256Schema,
  config: randomizedSlateConfigSchema,
  uniformDraws: z.array(z.number().finite().gt(0).lt(1)),
}).strict();

const orderedActionSchema = z.object({
  actionKey: decisionActionKeySchema,
  selectedWasDeterministicTop: z.boolean(),
  plackettLuceProbability: probabilitySchema,
  conditionalSelectionProbability: probabilitySchema,
}).strict();

const supportDiagnosticsSchema = z.object({
  sourceCandidateCount: u32Schema,
  eligibleCandidateCount: u32Schema,
  excludedIneligibleCandidateCount: u32Schema,
  sampledCount: u32Schema,
  withoutReplacement: z.literal(true),
}).strict();

const numericalDiagnosticsStepSchema = z.object({
  servedPosition: oneBasedU32Schema,
  remainingCandidateCount: u32Schema,
  plackettLuceProbabilityMass: z.number().finite(),
  mixedProbabilityMass: z.number().finite(),
  probabilityMassError: z.number().finite().nonnegative(),
}).strict();

const numericalDiagnosticsSchema = z.object({
  probabilityMassTolerance: z.literal(RANDOMIZED_SLATE_PROBABILITY_MASS_TOLERANCE),
  maxProbabilityMassError: z.number().finite().nonnegative(),
  steps: z.array(numericalDiagnosticsStepSchema),
}).strict();

export const randomizedSlateSimulationSchema = z.object({
  contractVersion: z.literal(RANDOMIZED_SLATE_SIMULATION_VERSION),
  status: z.literal('simulated'),
  policy: randomizedSlateConfigSchema,
  baselineOrderVersion: z.literal('decision_pool_rank_then_identity_v1'),
  probabilitySemantics: z.literal('conditional_on_prior_slate_prefix_v1'),
  decisionFingerprint: z.object({
    decisionId: nonEmptyString,
    sha256: sha256Schema,
  }).strict(),
  candidatePoolFingerprint: z.object({ sha256: sha256Schema }).strict(),
  orderedActions: z.array(orderedActionSchema),
  supportDiagnostics: supportDiagnosticsSchema,
  numericalDiagnostics: numericalDiagnosticsSchema,
  evidenceKind: z.literal('simulated_propensity'),
  servable: z.literal(false),
  simulationSha256: sha256Schema,
}).strict();

export type RandomizedSlateSimulationInputV1 = z.infer<
  typeof randomizedSlateSimulationInputSchema
>;
export type RandomizedSlateSimulationV1 = z.infer<typeof randomizedSlateSimulationSchema>;
