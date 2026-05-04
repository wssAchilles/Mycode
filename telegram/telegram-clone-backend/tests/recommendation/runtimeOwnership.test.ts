import { describe, expect, it } from 'vitest';

import { SpaceFeedMixer } from '../../src/services/recommendation/SpaceFeedMixer';
import {
  isNodeRecommendationProviderScorer,
  NODE_RECOMMENDATION_ALLOWED_RESPONSIBILITIES,
  NODE_RECOMMENDATION_BASELINE_ROLE,
  NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS,
  NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS,
  NODE_RECOMMENDATION_PROVIDER_SCORERS,
  RECOMMENDATION_CANONICAL_ALGORITHM_OWNER,
} from '../../src/services/recommendation/contracts/runtimeOwnership';

describe('recommendation runtime ownership', () => {
  it('keeps Node recommendation as the legacy baseline while Rust owns new algorithms', () => {
    expect(RECOMMENDATION_CANONICAL_ALGORITHM_OWNER).toBe('rust');
    expect(NODE_RECOMMENDATION_BASELINE_ROLE).toBe('legacy_baseline_fallback');
    expect(SpaceFeedMixer.runtimeRole).toBe(NODE_RECOMMENDATION_BASELINE_ROLE);
    expect(SpaceFeedMixer.canonicalAlgorithmOwner).toBe(RECOMMENDATION_CANONICAL_ALGORITHM_OWNER);
    expect(NODE_RECOMMENDATION_ALLOWED_RESPONSIBILITIES).toContain('rust_recommendation_call');
    expect(NODE_RECOMMENDATION_ALLOWED_RESPONSIBILITIES).toContain('legacy_baseline_fallback');
    expect(NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS).toContain('new_scorers');
    expect(NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS).toContain('new_multi_source_fusion');
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
  });
});
