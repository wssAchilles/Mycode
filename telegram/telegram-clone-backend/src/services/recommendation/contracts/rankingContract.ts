import type { FeedCandidate } from '../types/FeedCandidate';
import {
  NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS,
  NODE_RECOMMENDATION_PROVIDER_SCORERS,
  type NodeRecommendationProviderScorer,
} from './runtimeOwnership';

export type { NodeRecommendationProviderScorer } from './runtimeOwnership';

export const RUST_RECOMMENDATION_LOCAL_SCORER_ORDER = [
  'LightweightPhoenixScorer',
  'WeightedScorer',
  'ScoreCalibrationScorer',
  'ContentQualityScorer',
  'AuthorAffinityScorer',
  'RecencyScorer',
  'ColdStartInterestScorer',
  'TrendAffinityScorer',
  'TrendPersonalizationScorer',
  'NewsTrendLinkScorer',
  'InterestDecayScorer',
  'ExplorationScorer',
  'BanditExplorationScorer',
  'FatigueScorer',
  'SessionSuppressionScorer',
  'OutOfNetworkScorer',
  'IntraRequestDiversityScorer',
  'AuthorDecayFactor',
  'ImpressionDecayFactor',
  'SourceDiversityFactor',
  'InNetworkBoostFactor',
  'NewAuthorFactor',
  'LongFormFactor',
  'MediaRichFactor',
  'VerifiedAuthorFactor',
  'FeedbackFatigueFactor',
  'MediaClusterDiversityFactor',
  'EmbeddingDiversityFactor',
  'MtlNormalizationFactor',
  'ListwiseAuthorDecay',
  'ListwiseSourceDecay',
  'AuthorDiversityScorer',
  'ScoreContractScorer',
] as const;

export const RUST_RECOMMENDATION_SCORER_ORDER = [
  ...NODE_RECOMMENDATION_PROVIDER_SCORERS,
  ...RUST_RECOMMENDATION_LOCAL_SCORER_ORDER,
] as const;

export type NodeRecommendationLegacyBaselineScorer =
  (typeof NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS)[number];

export type RecommendationCandidateScoreField =
  | 'phoenixScores'
  | 'actionScores'
  | 'rankingSignals'
  | 'weightedScore'
  | 'score'
  | 'authorAffinityScore'
  | 'scoreContractVersion'
  | 'scoreBreakdownVersion'
  | '_scoreBreakdown'
  | '_pipelineScore';

export const NODE_LEGACY_SCORER_CANDIDATE_FIELD_WRITES = {
  PhoenixScorer: ['phoenixScores'],
  EngagementScorer: ['phoenixScores'],
  WeightedScorer: ['weightedScore'],
  ScoreCalibrationScorer: ['weightedScore', 'scoreContractVersion', 'scoreBreakdownVersion'],
  AuthorAffinityScorer: ['authorAffinityScore', 'weightedScore'],
  ContentQualityScorer: ['weightedScore'],
  RecencyScorer: ['weightedScore'],
  AuthorDiversityScorer: ['score'],
  OONScorer: ['score'],
} as const satisfies Record<
  NodeRecommendationLegacyBaselineScorer,
  readonly RecommendationCandidateScoreField[]
>;

export const NODE_PROVIDER_SCORER_CANDIDATE_FIELD_WRITES = {
  PhoenixScorer: NODE_LEGACY_SCORER_CANDIDATE_FIELD_WRITES.PhoenixScorer,
  EngagementScorer: NODE_LEGACY_SCORER_CANDIDATE_FIELD_WRITES.EngagementScorer,
} as const satisfies Record<
  NodeRecommendationProviderScorer,
  readonly RecommendationCandidateScoreField[]
>;

export const NODE_LEGACY_SCORER_RUST_STAGE_ALIGNMENT = {
  PhoenixScorer: ['PhoenixScorer'],
  EngagementScorer: ['EngagementScorer', 'LightweightPhoenixScorer'],
  WeightedScorer: ['WeightedScorer'],
  ScoreCalibrationScorer: ['ScoreCalibrationScorer'],
  AuthorAffinityScorer: ['AuthorAffinityScorer'],
  ContentQualityScorer: ['ContentQualityScorer'],
  RecencyScorer: ['RecencyScorer'],
  AuthorDiversityScorer: ['AuthorDiversityScorer'],
  OONScorer: ['OutOfNetworkScorer'],
} as const satisfies Record<NodeRecommendationLegacyBaselineScorer, readonly string[]>;

export function assertNodeProviderScorerCandidateWrites(
  scorerName: NodeRecommendationProviderScorer,
  before: FeedCandidate,
  after: FeedCandidate,
): void {
  const allowedFields = new Set<string>(NODE_PROVIDER_SCORER_CANDIDATE_FIELD_WRITES[scorerName]);
  const changedFields = readChangedCandidateFields(before, after);
  const unauthorizedFields = changedFields.filter((field) => !allowedFields.has(field));
  if (unauthorizedFields.length > 0) {
    throw new Error(
      `provider_scorer_field_ownership_violation:${scorerName}:${unauthorizedFields.join(',')}`,
    );
  }
}

export function nodeLegacyScorerWritesFinalScore(
  scorerName: NodeRecommendationLegacyBaselineScorer,
): boolean {
  const writes = NODE_LEGACY_SCORER_CANDIDATE_FIELD_WRITES[
    scorerName
  ] as readonly RecommendationCandidateScoreField[];
  return writes.includes('score');
}

function readChangedCandidateFields(before: FeedCandidate, after: FeedCandidate): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => {
    const beforeValue = (before as unknown as Record<string, unknown>)[key];
    const afterValue = (after as unknown as Record<string, unknown>)[key];
    return !sameSerializedValue(beforeValue, afterValue);
  });
}

function sameSerializedValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
