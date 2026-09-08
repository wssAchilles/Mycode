import { z } from 'zod';

import { decisionActionKeySchema } from '../../decisionLog/contracts';
import {
  randomizedSlateConfigSchema,
  randomizedSlateSimulationInputSchema,
  randomizedSlateSimulationSchema,
} from '../../randomizedSlate/contracts';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const simulatedSyntheticActionV1Schema = z.object({
  actionKey: decisionActionKeySchema,
  selectionRank: z.number().int().positive().max(64),
  behaviorPropensity: z.object({
    status: z.literal('simulated_propensity'),
    plackettLuceProbability: z.number().finite().gt(0).lte(1),
    conditionalSelectionProbability: z.number().finite().gt(0).lte(1),
  }).strict(),
}).strict();

export const syntheticDecisionLogV1Schema = z.object({
  contractVersion: z.literal('synthetic_decision_log_v1'),
  decisionId: z.string().uuid(),
  requestId: z.string().uuid(),
  decisionAt: z.string().datetime({ offset: true }),
  sourceDecisionLogSha256: sha256Schema,
  sourceCandidatePoolSha256: sha256Schema,
  behaviorPolicy: randomizedSlateConfigSchema,
  behaviorPolicyConfigSha256: sha256Schema,
  uniformDraws: z.array(z.number().finite().gt(0).lt(1)).min(1).max(64),
  actions: z.array(simulatedSyntheticActionV1Schema).min(1).max(64),
  evidenceKind: z.literal('simulated_propensity'),
  realDatasetEligible: z.literal(false),
  servable: z.literal(false),
}).strict();

export const phase11SyntheticBehaviorFixtureV1Schema = z.object({
  fixtureVersion: z.literal('randomized_slate_simulation_fixture_v1'),
  targetFixturePath: z.literal('target_policy_distribution_stream_v1.json'),
  behaviorPolicyConfigSha256: sha256Schema,
  targetPolicyConfigSha256: sha256Schema,
  input: randomizedSlateSimulationInputSchema,
  expected: randomizedSlateSimulationSchema,
}).strict();

export type SyntheticDecisionLogV1 = z.infer<typeof syntheticDecisionLogV1Schema>;
export type Phase11SyntheticBehaviorFixtureV1 = z.infer<
  typeof phase11SyntheticBehaviorFixtureV1Schema
>;
