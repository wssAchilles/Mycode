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
  'new_filters',
  'new_selectors',
  'new_scorers',
  'new_ranking_weights',
  'new_multi_source_fusion',
] as const;

export const NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES = [
  'FollowingSource',
  'GraphSource',
  'NewsAnnSource',
  'EmbeddingAuthorSource',
  'PopularSource',
  'TwoTowerSource',
  'ColdStartSource',
] as const;

export const NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS = [
  'DuplicateFilter',
  'NewsExternalIdDedupFilter',
  'SelfPostFilter',
  'RetweetDedupFilter',
  'AgeFilter',
  'BlockedUserFilter',
  'MutedKeywordFilter',
  'SeenPostFilter',
  'PreviouslyServedFilter',
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
  'AuthorAffinityScorer',
  'ContentQualityScorer',
  'RecencyScorer',
  'AuthorDiversityScorer',
  'OONScorer',
] as const;

export const NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS = [
  'VFFilter',
  'ConversationDedupFilter',
] as const;

export const NODE_RECOMMENDATION_LEGACY_SELECTOR = 'TopKSelector' as const;

export const NODE_RECOMMENDATION_LEGACY_NON_PIPELINE_COMPONENT_FILES = [
  'FollowingTimelineCache',
  'SafetyFilter',
] as const;

export type NodeRecommendationProviderScorer =
  (typeof NODE_RECOMMENDATION_PROVIDER_SCORERS)[number];

export function isNodeRecommendationProviderScorer(
  scorerName: string,
): scorerName is NodeRecommendationProviderScorer {
  return (NODE_RECOMMENDATION_PROVIDER_SCORERS as readonly string[]).includes(scorerName);
}
