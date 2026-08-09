import { z } from 'zod';

import {
  recommendationDecisionLogSchema,
  type RecommendationDecisionLogV1,
} from '../decisionLog/contracts';

export const DECISION_CONTEXT_EVIDENCE_VERSION = 'verified_decision_context_evidence_v1' as const;
export const DECISION_CONTEXT_LIMITS_VERSION = 'decision_context_evidence_limits_v1' as const;
export const DECISION_CONTEXT_LIMITS = Object.freeze({
  version: DECISION_CONTEXT_LIMITS_VERSION,
  maxDecisions: 100_000,
} as const);
export const VIEWER_CLUSTER_UNIT_VERSION = 'viewer_account_pseudonym_v1' as const;
export const SYNTHETIC_CLUSTER_UNIT_VERSION = 'independent_decision_synthetic_v1' as const;
export const DECISION_CONTEXT_MAX_SEGMENTS = 256;

const nonEmptyString = z.string().trim().min(1).max(256);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const decisionContextSubjectV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('viewer'), viewerAccountPseudonym: nonEmptyString }).strict(),
  z.object({ kind: z.literal('synthetic_cluster'), syntheticViewerId: nonEmptyString }).strict(),
]);

export const crossUserDependenceV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none_observed_in_verified_source_v1') }).strict(),
  z.object({ status: z.literal('unhandled_time_shock_v1') }).strict(),
]);

export const decisionContextSegmentsV1Schema = z.record(nonEmptyString, nonEmptyString)
  .superRefine((segments, context) => {
    if (Object.keys(segments).length > DECISION_CONTEXT_MAX_SEGMENTS) {
      context.addIssue({ code: 'custom', message: 'decision context segment limit exceeded' });
    }
  });

const contextEntryShape = {
  decisionLog: z.unknown(),
  contextAt: timestampSchema,
  availableAt: timestampSchema,
  sourceSha256: sha256Schema,
  sourceVersion: nonEmptyString,
  inferenceClusterId: nonEmptyString,
  segments: decisionContextSegmentsV1Schema,
};

export const decisionContextVerificationEntryV1Schema = z.discriminatedUnion('clusterUnitVersion', [
  z.object({
    ...contextEntryShape,
    subject: decisionContextSubjectV1Schema.options[0],
    clusterUnitVersion: z.literal(VIEWER_CLUSTER_UNIT_VERSION),
    realDatasetEligible: z.boolean(),
  }).strict(),
  z.object({
    ...contextEntryShape,
    subject: decisionContextSubjectV1Schema.options[1],
    clusterUnitVersion: z.literal(SYNTHETIC_CLUSTER_UNIT_VERSION),
    realDatasetEligible: z.literal(false),
  }).strict(),
]);

export const decisionContextVerificationInputV1Schema = z.object({
  datasetVersion: nonEmptyString,
  crossUserDependence: crossUserDependenceV1Schema,
  decisions: z.array(decisionContextVerificationEntryV1Schema)
    .min(1)
    .max(DECISION_CONTEXT_LIMITS.maxDecisions),
}).strict();

const verifiedContextShape = {
  datasetVersion: nonEmptyString,
  decisionId: z.string().uuid(),
  requestId: z.string().uuid(),
  decisionAt: timestampSchema,
  decisionLogSha256: sha256Schema,
  candidatePoolSha256: sha256Schema,
  decisionLog: recommendationDecisionLogSchema,
  contextAt: timestampSchema,
  availableAt: timestampSchema,
  sourceSha256: sha256Schema,
  sourceVersion: nonEmptyString,
  inferenceClusterId: nonEmptyString,
  segments: decisionContextSegmentsV1Schema,
};

export const verifiedDecisionContextDecisionV1Schema = z.discriminatedUnion('clusterUnitVersion', [
  z.object({
    ...verifiedContextShape,
    subject: decisionContextSubjectV1Schema.options[0],
    clusterUnitVersion: z.literal(VIEWER_CLUSTER_UNIT_VERSION),
    realDatasetEligible: z.boolean(),
  }).strict(),
  z.object({
    ...verifiedContextShape,
    subject: decisionContextSubjectV1Schema.options[1],
    clusterUnitVersion: z.literal(SYNTHETIC_CLUSTER_UNIT_VERSION),
    realDatasetEligible: z.literal(false),
  }).strict(),
]);

export type DecisionContextSubjectV1 = z.infer<typeof decisionContextSubjectV1Schema>;
export type CrossUserDependenceV1 = z.infer<typeof crossUserDependenceV1Schema>;
export type DecisionContextVerificationInputV1 = z.input<typeof decisionContextVerificationInputV1Schema>;
export type VerifiedDecisionContextDecisionV1 = z.infer<typeof verifiedDecisionContextDecisionV1Schema> & {
  decisionLog: RecommendationDecisionLogV1;
};

export type DecisionContextEvidenceV1 = {
  contractVersion: typeof DECISION_CONTEXT_EVIDENCE_VERSION;
  resourceLimitsVersion: typeof DECISION_CONTEXT_LIMITS_VERSION;
  datasetVersion: string;
  crossUserDependence: CrossUserDependenceV1;
  decisions: VerifiedDecisionContextDecisionV1[];
  decisionContextEvidenceSha256: string;
};
