import RecommendationTrace from '../../../models/RecommendationTrace';
import {
  loadRecommendationRolloutPolicy,
  loadRecommendationRolloutPolicyFile,
  type RecommendationRolloutPolicy,
} from '../contracts/rolloutPolicy';

const PRIMARY_FALLBACK_REASONS = [
  'rust_primary_empty_fallback_node',
  'rust_primary_error_fallback_node',
] as const;
const PRIMARY_FALLBACK_REASON_SET = new Set<string>(PRIMARY_FALLBACK_REASONS);

export interface RecommendationRolloutTrace {
  runtimeMode?: string;
  servingOwner?: string;
  fallbackReason?: string;
  createdAt: Date | string;
}

export interface RecommendationRolloutEvidence {
  policyVersion?: string;
  windowHours?: number;
  minimumPrimarySamples?: number;
  maximumFallbackRatio?: number;
  primarySamples: number;
  validPrimarySamples: number;
  fallbackSamples: number;
  invalidTraceCount: number;
  fallbackRatio: number | null;
  status: 'ready' | 'blocked';
  blockers: string[];
}

export function buildRecommendationRolloutEvidence(
  traces: RecommendationRolloutTrace[],
  policy: RecommendationRolloutPolicy,
  now: Date = new Date(),
): RecommendationRolloutEvidence {
  const sinceMs = now.getTime() - (policy.windowHours * 60 * 60 * 1000);
  const primaryTraces = traces.filter((trace) => {
    const createdAt = new Date(trace.createdAt).getTime();
    return Number.isFinite(createdAt)
      && createdAt >= sinceMs
      && createdAt <= now.getTime()
      && trace.runtimeMode === 'primary';
  });
  const validPrimaryTraces = primaryTraces.filter(hasValidPrimaryTraceContract);
  const fallbackSamples = validPrimaryTraces.filter((trace) =>
    trace.servingOwner === 'node'
    && PRIMARY_FALLBACK_REASON_SET.has(String(trace.fallbackReason || '')),
  ).length;

  return buildEvidenceFromCounts(policy, {
    primarySamples: primaryTraces.length,
    validPrimarySamples: validPrimaryTraces.length,
    fallbackSamples,
    invalidTraceCount: primaryTraces.length - validPrimaryTraces.length,
  });
}

function hasValidPrimaryTraceContract(trace: RecommendationRolloutTrace): boolean {
  return trace.servingOwner === 'rust'
    ? trace.fallbackReason == null
    : trace.servingOwner === 'node'
      && PRIMARY_FALLBACK_REASON_SET.has(String(trace.fallbackReason || ''));
}

function buildEvidenceFromCounts(
  policy: RecommendationRolloutPolicy,
  counts: {
    primarySamples: number;
    validPrimarySamples: number;
    fallbackSamples: number;
    invalidTraceCount: number;
  },
): RecommendationRolloutEvidence {
  const fallbackRatio = counts.validPrimarySamples > 0
    ? counts.fallbackSamples / counts.validPrimarySamples
    : 0;
  const blockers: string[] = [];
  if (counts.validPrimarySamples < policy.minimumPrimarySamples) {
    blockers.push('recommendation_rollout_primary_samples_insufficient');
  }
  if (counts.invalidTraceCount > 0) {
    blockers.push('recommendation_rollout_trace_contract_invalid');
  }
  if (fallbackRatio > policy.maximumFallbackRatio) {
    blockers.push('recommendation_rollout_fallback_ratio_high');
  }

  return {
    policyVersion: policy.version,
    windowHours: policy.windowHours,
    minimumPrimarySamples: policy.minimumPrimarySamples,
    maximumFallbackRatio: policy.maximumFallbackRatio,
    primarySamples: counts.primarySamples,
    validPrimarySamples: counts.validPrimarySamples,
    fallbackSamples: counts.fallbackSamples,
    invalidTraceCount: counts.invalidTraceCount,
    fallbackRatio,
    status: blockers.length === 0 ? 'ready' : 'blocked',
    blockers,
  };
}

export async function readRecommendationRolloutEvidence(
  config?: unknown,
  now: Date = new Date(),
): Promise<RecommendationRolloutEvidence> {
  const loaded = config === undefined
    ? await loadRecommendationRolloutPolicyFile()
    : loadRecommendationRolloutPolicy(config);
  if (!loaded.ok) {
    return {
      primarySamples: 0,
      validPrimarySamples: 0,
      fallbackSamples: 0,
      invalidTraceCount: 0,
      fallbackRatio: null,
      status: 'blocked',
      blockers: [loaded.blocker],
    };
  }

  const since = new Date(now.getTime() - (loaded.policy.windowHours * 60 * 60 * 1000));
  const [counts] = await RecommendationTrace.aggregate<{
    primarySamples?: number;
    validPrimarySamples?: number;
    fallbackSamples?: number;
    invalidTraceCount?: number;
  }>([
    {
      $match: {
        createdAt: { $gte: since, $lte: now },
        runtimeMode: 'primary',
      },
    },
    {
      $group: {
        _id: null,
        primarySamples: { $sum: 1 },
        validPrimarySamples: {
          $sum: {
            $cond: [
              {
                $or: [
                  {
                    $and: [
                      { $eq: ['$servingOwner', 'rust'] },
                      { $eq: [{ $ifNull: ['$fallbackReason', null] }, null] },
                    ],
                  },
                  {
                    $and: [
                      { $eq: ['$servingOwner', 'node'] },
                      { $in: ['$fallbackReason', [...PRIMARY_FALLBACK_REASONS]] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        fallbackSamples: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$servingOwner', 'node'] },
                  { $in: ['$fallbackReason', [...PRIMARY_FALLBACK_REASONS]] },
                ],
              },
              1,
              0,
            ],
          },
        },
        invalidTraceCount: {
          $sum: {
            $cond: [
              {
                $not: [{
                  $or: [
                    {
                      $and: [
                        { $eq: ['$servingOwner', 'rust'] },
                        { $eq: [{ $ifNull: ['$fallbackReason', null] }, null] },
                      ],
                    },
                    {
                      $and: [
                        { $eq: ['$servingOwner', 'node'] },
                        { $in: ['$fallbackReason', [...PRIMARY_FALLBACK_REASONS]] },
                      ],
                    },
                  ],
                }],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return buildEvidenceFromCounts(loaded.policy, {
    primarySamples: readCount(counts?.primarySamples),
    validPrimarySamples: readCount(counts?.validPrimarySamples),
    fallbackSamples: readCount(counts?.fallbackSamples),
    invalidTraceCount: readCount(counts?.invalidTraceCount),
  });
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}
