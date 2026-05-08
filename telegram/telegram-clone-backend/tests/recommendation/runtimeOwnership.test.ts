import { describe, expect, it } from 'vitest';

import { SpaceFeedMixer } from '../../src/services/recommendation/SpaceFeedMixer';
import {
  isNodeRecommendationProviderScorer,
  NODE_RECOMMENDATION_ALLOWED_RESPONSIBILITIES,
  NODE_RECOMMENDATION_BASELINE_ROLE,
  NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS,
  NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS,
  NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS,
  NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES,
  NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS,
  NODE_RECOMMENDATION_LEGACY_SELECTOR,
  NODE_RECOMMENDATION_PROVIDER_SCORERS,
  RECOMMENDATION_CANONICAL_ALGORITHM_OWNER,
} from '../../src/services/recommendation/contracts/runtimeOwnership';
import {
  buildRecommendationFilters,
  buildRecommendationPostSelectionFilters,
  buildRecommendationScorers,
  RECOMMENDATION_SOURCE_ORDER,
} from '../../src/services/recommendation/internal/componentCatalog';

describe('recommendation runtime ownership', () => {
  it('keeps Node recommendation as the legacy baseline while Rust owns new algorithms', () => {
    expect(RECOMMENDATION_CANONICAL_ALGORITHM_OWNER).toBe('rust');
    expect(NODE_RECOMMENDATION_BASELINE_ROLE).toBe('legacy_baseline_fallback');
    expect(SpaceFeedMixer.runtimeRole).toBe(NODE_RECOMMENDATION_BASELINE_ROLE);
    expect(SpaceFeedMixer.canonicalAlgorithmOwner).toBe(RECOMMENDATION_CANONICAL_ALGORITHM_OWNER);
    expect(NODE_RECOMMENDATION_ALLOWED_RESPONSIBILITIES).toContain('rust_recommendation_call');
    expect(NODE_RECOMMENDATION_ALLOWED_RESPONSIBILITIES).toContain('legacy_baseline_fallback');
    expect(NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS).toContain('new_sources');
    expect(NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS).toContain('new_filters');
    expect(NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS).toContain('new_selectors');
    expect(NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS).toContain('new_scorers');
    expect(NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS).toContain('new_multi_source_fusion');
    expect(NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES).toEqual([
      'FollowingSource',
      'GraphSource',
      'NewsAnnSource',
      'EmbeddingAuthorSource',
      'PopularSource',
      'TwoTowerSource',
      'ColdStartSource',
    ]);
    expect(NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS).toEqual([
      'DuplicateFilter',
      'NewsExternalIdDedupFilter',
      'SelfPostFilter',
      'RetweetDedupFilter',
      'AgeFilter',
      'BlockedUserFilter',
      'MutedKeywordFilter',
      'SeenPostFilter',
      'PreviouslyServedFilter',
    ]);
    expect(NODE_RECOMMENDATION_PROVIDER_SCORERS).toEqual([
      'PhoenixScorer',
      'EngagementScorer',
    ]);
    expect(isNodeRecommendationProviderScorer('PhoenixScorer')).toBe(true);
    expect(isNodeRecommendationProviderScorer('WeightedScorer')).toBe(false);
    expect(NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS).toEqual([
      'PhoenixScorer',
      'EngagementScorer',
      'WeightedScorer',
      'ScoreCalibrationScorer',
      'ContentQualityScorer',
      'AuthorAffinityScorer',
      'RecencyScorer',
      'AuthorDiversityScorer',
      'OONScorer',
    ]);
    expect(NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS).toEqual([
      'VFFilter',
      'ConversationDedupFilter',
    ]);
    expect(NODE_RECOMMENDATION_LEGACY_SELECTOR).toBe('TopKSelector');
  });

  it('keeps the Node component catalog pinned to the legacy baseline contract', () => {
    expect(RECOMMENDATION_SOURCE_ORDER).toEqual(NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES);
    expect(buildRecommendationFilters().map((filter) => filter.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS,
    );
    expect(buildRecommendationScorers().map((scorer) => scorer.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS,
    );
    expect(buildRecommendationPostSelectionFilters().map((filter) => filter.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS,
    );
  });
});
