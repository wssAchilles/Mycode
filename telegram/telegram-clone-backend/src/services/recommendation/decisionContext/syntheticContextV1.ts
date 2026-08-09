import { createHash } from 'crypto';

import { z } from 'zod';

import { canonicalDecisionJson } from '../decisionLog/contracts';
import { syntheticDecisionLogV1Schema } from '../offlinePrediction/streamingV2/contracts';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().trim().min(1).max(256);
const timestamp = z.string().datetime({ offset: true });
const segmentsSchema = z.record(nonEmpty, nonEmpty).superRefine((segments, context) => {
  if (Object.keys(segments).length > 256) {
    context.addIssue({ code: 'custom', message: 'segment limit exceeded' });
  }
});

export const syntheticContextVerificationInputV1Schema = z.object({
  contractVersion: z.literal('synthetic_context_verification_input_v1'),
  datasetVersion: nonEmpty,
  syntheticDecisionLog: syntheticDecisionLogV1Schema,
  syntheticDecisionLogSha256: sha256Schema,
  contextAt: timestamp,
  availableAt: timestamp,
  sourceSha256: sha256Schema,
  sourceVersion: nonEmpty,
  inferenceClusterId: nonEmpty,
  segments: segmentsSchema,
}).strict();

export type SyntheticSegmentAssignmentV1 = { key: string; value: string };

export type VerifiedSyntheticContextV1 = {
  contractVersion: 'verified_synthetic_context_v1';
  datasetVersion: string;
  decisionId: string;
  requestId: string;
  decisionAt: string;
  syntheticDecisionLogSha256: string;
  contextAt: string;
  availableAt: string;
  sourceSha256: string;
  sourceVersion: string;
  inferenceClusterId: string;
  segmentAssignments: SyntheticSegmentAssignmentV1[];
  syntheticContextSha256: string;
  clusterUnitVersion: 'independent_decision_synthetic_v1';
  realDatasetEligible: false;
  servable: false;
};

export type VerifySyntheticContextResultV1 =
  | { status: 'verified'; evidence: VerifiedSyntheticContextV1 }
  | { status: 'not_evaluable'; blocker: string };

const verified = new WeakSet<object>();
const verifiedDigests = new WeakMap<object, string>();
const digest = (value: unknown): string => createHash('sha256')
  .update(canonicalDecisionJson(value))
  .digest('hex');
const compareText = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left), Buffer.from(right),
);

export function isVerifiedSyntheticContextV1(value: unknown): value is VerifiedSyntheticContextV1 {
  try {
    if (!value || typeof value !== 'object' || !recursivelyFrozen(value)) return false;
    const candidate = value as VerifiedSyntheticContextV1;
    const expected = verifiedDigests.get(value);
    const { syntheticContextSha256: _ignored, ...preimage } = candidate;
    return verified.has(value)
      && expected !== undefined
      && candidate.syntheticContextSha256 === expected
      && digest(preimage) === expected;
  } catch {
    return false;
  }
}

export function verifySyntheticContextV1(raw: unknown): VerifySyntheticContextResultV1 {
  let parsed: ReturnType<typeof syntheticContextVerificationInputV1Schema.safeParse>;
  try {
    parsed = syntheticContextVerificationInputV1Schema.safeParse(raw);
  } catch {
    return reject('synthetic_context_contract_invalid');
  }
  if (!parsed.success) return reject('synthetic_context_contract_invalid');
  const input = parsed.data;
  if (input.syntheticDecisionLogSha256 !== digest(input.syntheticDecisionLog)) {
    return reject('synthetic_context_decision_digest_mismatch');
  }
  const contextAt = Date.parse(input.contextAt);
  const availableAt = Date.parse(input.availableAt);
  const decisionAt = Date.parse(input.syntheticDecisionLog.decisionAt);
  if (contextAt > availableAt || availableAt > decisionAt) {
    return reject('synthetic_context_point_in_time_violation');
  }
  const segmentAssignments = Object.entries(input.segments)
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => compareText(left.key, right.key) || compareText(left.value, right.value));
  const preimage = {
    contractVersion: 'verified_synthetic_context_v1' as const,
    datasetVersion: input.datasetVersion,
    decisionId: input.syntheticDecisionLog.decisionId,
    requestId: input.syntheticDecisionLog.requestId,
    decisionAt: input.syntheticDecisionLog.decisionAt,
    syntheticDecisionLogSha256: input.syntheticDecisionLogSha256,
    contextAt: new Date(contextAt).toISOString(),
    availableAt: new Date(availableAt).toISOString(),
    sourceSha256: input.sourceSha256,
    sourceVersion: input.sourceVersion,
    inferenceClusterId: input.inferenceClusterId,
    segmentAssignments,
    clusterUnitVersion: 'independent_decision_synthetic_v1' as const,
    realDatasetEligible: false as const,
    servable: false as const,
  };
  const evidence = recursivelyFreeze({
    ...preimage,
    syntheticContextSha256: digest(preimage),
  });
  verified.add(evidence);
  verifiedDigests.set(evidence, evidence.syntheticContextSha256);
  return recursivelyFreeze({ status: 'verified' as const, evidence });
}

function reject(blocker: string): VerifySyntheticContextResultV1 {
  return { status: 'not_evaluable', blocker };
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
