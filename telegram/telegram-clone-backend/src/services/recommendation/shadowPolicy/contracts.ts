import { z } from 'zod';

import {
  decisionActionKeySchema,
  recommendationDecisionLogSchema,
} from '../decisionLog/contracts';
import {
  behaviorSupportEvidenceSchema,
  predictionArtifactSchema,
} from '../ope/contracts';

export const MULTI_OBJECTIVE_SHADOW_POLICY_VERSION = 'multi_objective_shadow_policy_v1' as const;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SEARCH_STATES = 100_000;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SLATE_SIZE = 64;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SUPPORT_ACTIONS = 256;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_OBJECTIVES = 16;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_PREDICTION_ARTIFACTS = 16;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_PREDICTIONS_PER_ARTIFACT = 256;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_CANDIDATE_POOL = 2_048;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_DECISION_ACTIONS = 256;
export const MAX_MULTI_OBJECTIVE_SHADOW_POLICY_OBJECTIVE_EVIDENCE_PER_CANDIDATE = 32;

const nonEmptyString = z.string().trim().min(1);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const decisionVersionsSchema = z.object({
  pipeline: nonEmptyString,
  strategy: nonEmptyString,
  policy: nonEmptyString,
  graph: nonEmptyString,
  model: nonEmptyString,
  artifact: nonEmptyString,
  index: nonEmptyString,
}).strict();
const objectiveSchema = z.object({
  objective: nonEmptyString,
  predictionArtifactVersion: nonEmptyString,
  rewardDefinitionVersion: nonEmptyString,
  weight: z.number().finite(),
}).strict();

export const multiObjectiveShadowPolicyConfigSchema = z.object({
  contractVersion: z.literal(MULTI_OBJECTIVE_SHADOW_POLICY_VERSION),
  policyId: nonEmptyString,
  policyVersion: nonEmptyString,
  datasetVersion: nonEmptyString,
  decisionVersions: decisionVersionsSchema,
  horizonMs: z.number().int().nonnegative(),
  slateSize: z.number().int().positive().max(MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SLATE_SIZE),
  maxSearchStates: z.number().int().positive().max(MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SEARCH_STATES),
  objectives: z.array(objectiveSchema).min(1).max(MAX_MULTI_OBJECTIVE_SHADOW_POLICY_OBJECTIVES),
  candidateSafetyLimit: z.object({
    objective: nonEmptyString,
    maxPrediction: z.number().finite(),
  }).strict(),
  slateSafetyConstraint: z.object({
    objective: nonEmptyString,
    maxMeanPrediction: z.number().finite(),
  }).strict(),
}).strict().superRefine((config, context) => {
  const objectives = config.objectives.map(({ objective }) => objective);
  if (new Set(objectives).size !== objectives.length) {
    context.addIssue({
      code: 'custom',
      message: 'objectives must be unique',
      path: ['objectives'],
    });
  }
  for (const [field, objective] of [
    ['candidateSafetyLimit', config.candidateSafetyLimit.objective],
    ['slateSafetyConstraint', config.slateSafetyConstraint.objective],
  ] as const) {
    if (!objectives.includes(objective)) {
      context.addIssue({
        code: 'custom',
        message: 'constraint objective must be configured',
        path: [field, 'objective'],
      });
    }
  }
});

export const multiObjectiveShadowPolicyInputSchema = z.object({
  config: multiObjectiveShadowPolicyConfigSchema,
  decisionLog: recommendationDecisionLogSchema,
  decisionLogSha256: sha256,
  behaviorSupport: behaviorSupportEvidenceSchema,
  predictionArtifacts: z.array(predictionArtifactSchema)
    .max(MAX_MULTI_OBJECTIVE_SHADOW_POLICY_PREDICTION_ARTIFACTS),
}).strict().superRefine((input, context) => {
  if (input.behaviorSupport.actions.length > MAX_MULTI_OBJECTIVE_SHADOW_POLICY_SUPPORT_ACTIONS) {
    context.addIssue({
      code: 'custom',
      message: 'behavior support actions exceed search limit',
      path: ['behaviorSupport', 'actions'],
    });
  }
});

export type MultiObjectiveShadowPolicyConfigV1 = z.infer<
  typeof multiObjectiveShadowPolicyConfigSchema
>;
export type MultiObjectiveShadowPolicyInputV1 = z.infer<
  typeof multiObjectiveShadowPolicyInputSchema
>;
export type ShadowPolicyActionKeyV1 = z.infer<typeof decisionActionKeySchema>;

export type ShadowPolicyFingerprintV1 =
  | { status: 'available'; sha256: string }
  | { status: 'unavailable'; reason: 'input_not_canonicalizable' | 'input_too_large' };

export type ShadowRankedActionV1 = {
  actionKey: ShadowPolicyActionKeyV1;
  shadowRank: number;
  utility: number;
  objectivePredictions: Array<{ objective: string; qHat: number }>;
};

export type ShadowConstraintDiagnosticsV1 = {
  candidateSafetyLimit:
    | { status: 'not_evaluated' }
    | {
      status: 'evaluated';
      objective: string;
      maxPrediction: number;
      excludedActions: Array<{ actionKey: ShadowPolicyActionKeyV1; prediction: number }>;
      safeActionCount: number;
    };
  slateSafetyConstraint:
    | { status: 'not_evaluated' }
    | {
      status: 'evaluated';
      objective: string;
      maxMeanPrediction: number;
      selectedMeanPrediction: number;
      satisfied: boolean;
    };
};

type ShadowPolicyResultBaseV1 = {
  contractVersion: typeof MULTI_OBJECTIVE_SHADOW_POLICY_VERSION;
  servable: false;
  constraintDiagnostics: ShadowConstraintDiagnosticsV1;
  fingerprint: ShadowPolicyFingerprintV1;
};

export type MultiObjectiveShadowPolicyResultV1 =
  | (ShadowPolicyResultBaseV1 & {
    status: 'evaluated';
    rankedActions: ShadowRankedActionV1[];
  })
  | (ShadowPolicyResultBaseV1 & {
    status: 'not_evaluable';
    blockers: string[];
    rankedActions: [];
  });
