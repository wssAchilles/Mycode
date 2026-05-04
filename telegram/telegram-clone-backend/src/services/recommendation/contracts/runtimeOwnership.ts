export const RECOMMENDATION_CANONICAL_ALGORITHM_OWNER = 'rust' as const;
export const NODE_RECOMMENDATION_BASELINE_ROLE = 'legacy_baseline_fallback' as const;

export const NODE_RECOMMENDATION_ALLOWED_RESPONSIBILITIES = [
  'feed_api_adapter',
  'rust_recommendation_call',
  'legacy_baseline_fallback',
  'response_hydration',
  'legacy_response_shape',
] as const;

export const NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS = [
  'new_sources',
  'new_scorers',
  'new_ranking_weights',
  'new_multi_source_fusion',
] as const;

export const NODE_RECOMMENDATION_PROVIDER_SCORERS = [
  'PhoenixScorer',
  'EngagementScorer',
] as const;

export const NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS = [
  'PhoenixScorer',
  'EngagementScorer',
  'WeightedScorer',
  'ScoreCalibrationScorer',
  'ContentQualityScorer',
  'AuthorAffinityScorer',
  'RecencyScorer',
  'AuthorDiversityScorer',
  'OONScorer',
] as const;

export type NodeRecommendationProviderScorer =
  (typeof NODE_RECOMMENDATION_PROVIDER_SCORERS)[number];

export function isNodeRecommendationProviderScorer(
  scorerName: string,
): scorerName is NodeRecommendationProviderScorer {
  return (NODE_RECOMMENDATION_PROVIDER_SCORERS as readonly string[]).includes(scorerName);
}
