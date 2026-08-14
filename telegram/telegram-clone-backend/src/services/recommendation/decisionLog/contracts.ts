import { createHash } from 'crypto';

import { z } from 'zod';

import { SERVED_POSITION_CONTRACT_VERSION } from '../events/positionContract';
import { candidateNamespaceSchema } from '../events/actionIdentity';

export const RECOMMENDATION_DECISION_LOG_VERSION = 'recommendation_decision_log_v1' as const;
export { SERVED_POSITION_CONTRACT_VERSION };

const nonEmptyString = z.string().trim().min(1);
const U32_MAX = 0xffff_ffff;
const oneBasedPosition = z.number().int().positive().max(U32_MAX);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export { candidateNamespaceSchema };

export const versionEvidenceSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('bound'), version: nonEmptyString }).strict(),
  z.object({ status: z.literal('unavailable'), reason: nonEmptyString }).strict(),
]);

export const objectiveEvidenceSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    objective: nonEmptyString,
    prediction: z.number().finite(),
    artifactVersion: nonEmptyString,
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    objective: nonEmptyString,
    reason: nonEmptyString,
  }).strict(),
]);

export const propensityEvidenceSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('logged_randomized'),
    selectionProbability: z.number().finite().gt(0).lte(1),
  }).strict(),
  z.object({
    status: z.literal('not_evaluable_deterministic'),
    reason: z.literal('deterministic_top_k_no_logged_probability'),
  }).strict(),
  z.object({
    status: z.literal('unknown_support'),
    reason: nonEmptyString,
  }).strict(),
]);

export const decisionActionKeySchema = z.object({
  candidateNamespace: candidateNamespaceSchema,
  candidateId: nonEmptyString,
  servedPosition: oneBasedPosition,
}).strict();

export const decisionCandidateSchema = z.object({
  candidateNamespace: candidateNamespaceSchema,
  candidateId: nonEmptyString,
  poolRank: oneBasedPosition,
  eligible: z.boolean(),
  score: z.number().finite().nullable(),
  selected: z.boolean(),
  selectionRank: oneBasedPosition.nullable(),
  served: z.boolean(),
  servedPosition: oneBasedPosition.nullable(),
  objectiveEvidence: z.array(objectiveEvidenceSchema),
}).strict().superRefine((candidate, context) => {
  if (candidate.selected !== (candidate.selectionRank !== null)) {
    context.addIssue({
      code: 'custom',
      message: 'selectionRank must be present if and only if candidate is selected',
      path: ['selectionRank'],
    });
  }
  if (candidate.served !== (candidate.servedPosition !== null)) {
    context.addIssue({
      code: 'custom',
      message: 'servedPosition must be present if and only if candidate is served',
      path: ['servedPosition'],
    });
  }
  if (candidate.served && !candidate.selected) {
    context.addIssue({
      code: 'custom',
      message: 'served candidate must be selected',
      path: ['served'],
    });
  }
  if (candidate.selected && !candidate.eligible) {
    context.addIssue({
      code: 'custom',
      message: 'selected candidate must be eligible',
      path: ['eligible'],
    });
  }
});

export const decisionCandidatePoolSchema = z.object({
  supportEvidence: z.discriminatedUnion('status', [
    z.object({ status: z.literal('complete') }).strict(),
    z.object({ status: z.literal('incomplete'), reason: nonEmptyString }).strict(),
  ]),
  totalCount: z.number().int().nonnegative().max(U32_MAX),
  truncated: z.boolean(),
  candidates: z.array(decisionCandidateSchema),
  candidatePoolSha256: sha256Schema,
}).strict().superRefine((pool, context) => {
  if (pool.candidates.length > pool.totalCount) {
    context.addIssue({ code: 'custom', message: 'candidate count exceeds totalCount' });
  }
  if (!pool.truncated && pool.candidates.length !== pool.totalCount) {
    context.addIssue({ code: 'custom', message: 'complete pool count must equal totalCount' });
  }
  if (pool.truncated && pool.supportEvidence.status === 'complete') {
    context.addIssue({ code: 'custom', message: 'truncated pool cannot claim complete support' });
  }
  if (pool.candidatePoolSha256 !== candidatePoolSha256(pool.candidates)) {
    context.addIssue({
      code: 'custom',
      message: 'candidatePoolSha256 does not match canonical candidates',
      path: ['candidatePoolSha256'],
    });
  }

  const identities = new Set<string>();
  const selectionRanks = new Set<number>();
  const servedPositions = new Set<number>();
  for (const [candidateIndex, candidate] of pool.candidates.entries()) {
    const identity = `${candidate.candidateNamespace}\u0000${candidate.candidateId}`;
    if (identities.has(identity)) {
      context.addIssue({
        code: 'custom',
        message: 'candidate pool identities must be unique',
        path: ['candidates', candidateIndex],
      });
    }
    identities.add(identity);

    if (candidate.selectionRank !== null) {
      if (selectionRanks.has(candidate.selectionRank)) {
        context.addIssue({
          code: 'custom',
          message: 'selection ranks must be unique',
          path: ['candidates', candidateIndex, 'selectionRank'],
        });
      }
      selectionRanks.add(candidate.selectionRank);
    }
    if (candidate.servedPosition !== null) {
      if (servedPositions.has(candidate.servedPosition)) {
        context.addIssue({
          code: 'custom',
          message: 'served positions must be unique',
          path: ['candidates', candidateIndex, 'servedPosition'],
        });
      }
      servedPositions.add(candidate.servedPosition);
    }
  }

  for (let expected = 1; expected <= selectionRanks.size; expected += 1) {
    if (!selectionRanks.has(expected)) {
      context.addIssue({ code: 'custom', message: 'selection ranks must be contiguous and 1-based' });
      break;
    }
  }
});

export const recommendationDecisionLogSchema = z.object({
  contractVersion: z.literal(RECOMMENDATION_DECISION_LOG_VERSION),
  positionContractVersion: z.literal(SERVED_POSITION_CONTRACT_VERSION),
  requestId: z.string().uuid(),
  clientRequestId: nonEmptyString.optional(),
  decisionId: z.string().uuid(),
  decisionAt: z.string().datetime({ offset: true }),
  servingOwner: z.enum(['node', 'rust']),
  fallbackReason: nonEmptyString.nullable(),
  behaviorPolicyKind: z.enum(['deterministic_top_k', 'logged_randomized']),
  behaviorPolicy: z.object({
    policyId: nonEmptyString,
    policyVersion: versionEvidenceSchema,
  }).strict(),
  versions: z.object({
    pipeline: versionEvidenceSchema,
    strategy: versionEvidenceSchema,
    policy: versionEvidenceSchema,
    graph: versionEvidenceSchema,
    model: versionEvidenceSchema,
    artifact: versionEvidenceSchema,
    index: versionEvidenceSchema,
  }).strict(),
  candidatePool: decisionCandidatePoolSchema,
  actions: z.array(z.object({
    actionKey: decisionActionKeySchema,
    selectionRank: oneBasedPosition,
    behaviorPropensity: propensityEvidenceSchema,
  }).strict()),
}).strict().superRefine((decision, context) => {
  const candidates = decision.candidatePool.candidates;
  const seenActionKeys = new Set<string>();

  for (const [actionIndex, action] of decision.actions.entries()) {
    const propensityStatus = action.behaviorPropensity.status;
    if (
      (decision.behaviorPolicyKind === 'deterministic_top_k'
        && propensityStatus !== 'not_evaluable_deterministic')
      || (decision.behaviorPolicyKind === 'logged_randomized'
        && propensityStatus === 'not_evaluable_deterministic')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'behaviorPolicyKind does not match propensity evidence',
        path: ['actions', actionIndex, 'behaviorPropensity'],
      });
    }
    const { candidateNamespace, candidateId, servedPosition } = action.actionKey;
    const key = `${candidateNamespace}:${candidateId}:${servedPosition}`;
    if (seenActionKeys.has(key)) {
      context.addIssue({ code: 'custom', message: 'action keys must be unique', path: ['actions', actionIndex] });
    }
    seenActionKeys.add(key);

    const matches = candidates.filter((candidate) => (
      candidate.candidateNamespace === candidateNamespace
      && candidate.candidateId === candidateId
      && candidate.servedPosition === servedPosition
    ));
    if (matches.length !== 1 || !matches[0].selected || !matches[0].served) {
      context.addIssue({
        code: 'custom',
        message: 'action must reference exactly one selected and served candidate',
        path: ['actions', actionIndex],
      });
    } else if (matches[0].selectionRank !== action.selectionRank) {
      context.addIssue({
        code: 'custom',
        message: 'action selectionRank must match candidate selectionRank',
        path: ['actions', actionIndex, 'selectionRank'],
      });
    }
  }

  for (const [candidateIndex, candidate] of candidates.entries()) {
    if (!candidate.served) continue;
    const actionCount = decision.actions.filter((action) => (
      action.actionKey.candidateNamespace === candidate.candidateNamespace
      && action.actionKey.candidateId === candidate.candidateId
      && action.actionKey.servedPosition === candidate.servedPosition
    )).length;
    if (actionCount !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'served candidate must have exactly one action',
        path: ['candidatePool', 'candidates', candidateIndex],
      });
    }
  }
});

export type RecommendationDecisionLogV1 = z.infer<typeof recommendationDecisionLogSchema>;
export type DecisionCandidate = z.infer<typeof decisionCandidateSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON requires finite numbers');
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(Object.is(value, -0) ? 0 : value);
    return { $f64: bytes.toString('hex') };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalize((value as Record<string, unknown>)[key]),
    ]));
  }
  return value;
}

export function canonicalDecisionJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function candidatePoolSha256(candidates: unknown[]): string {
  const parsed = z.array(decisionCandidateSchema).parse(candidates);
  const ndjson = parsed.length === 0
    ? ''
    : `${parsed.map(canonicalDecisionJson).join('\n')}\n`;
  return sha256(ndjson);
}

export function decisionLogSha256(value: unknown): string {
  const decision = recommendationDecisionLogSchema.parse(value);
  return sha256(canonicalDecisionJson(decision));
}
