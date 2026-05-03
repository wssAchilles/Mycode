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
