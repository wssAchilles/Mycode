import { readFileSync, readdirSync } from 'fs';
import path from 'path';
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
  NODE_RECOMMENDATION_LEGACY_NON_PIPELINE_COMPONENT_FILES,
  NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS,
  NODE_RECOMMENDATION_LEGACY_SELECTOR,
  NODE_RECOMMENDATION_PROVIDER_SCORERS,
  RECOMMENDATION_CANONICAL_ALGORITHM_OWNER,
} from '../../src/services/recommendation/contracts/runtimeOwnership';
import {
  assertNodeProviderScorerCandidateWrites,
  NODE_LEGACY_SCORER_CANDIDATE_FIELD_WRITES,
  NODE_LEGACY_SCORER_RUST_STAGE_ALIGNMENT,
  NODE_PROVIDER_SCORER_CANDIDATE_FIELD_WRITES,
  nodeLegacyScorerWritesFinalScore,
  RUST_RECOMMENDATION_LOCAL_SCORER_ORDER,
  RUST_RECOMMENDATION_SCORER_ORDER,
} from '../../src/services/recommendation/contracts/rankingContract';
import {
  buildRecommendationFilters,
  buildRecommendationPostSelectionFilters,
  buildRecommendationQueryHydrators,
  buildRecommendationScorers,
  buildRecommendationSelector,
  buildRecommendationSources,
  RECOMMENDATION_QUERY_HYDRATOR_ORDER,
  RECOMMENDATION_SOURCE_ORDER,
} from '../../src/services/recommendation/internal/componentCatalog';

function componentFiles(kind: 'sources' | 'filters' | 'scorers'): string[] {
  return collectTypeScriptFiles(path.resolve(__dirname, '../../src/services/recommendation', kind))
    .filter((fileName) => fileName.endsWith('.ts') && fileName !== 'index.ts')
    .map((fileName) => fileName.replace(/\.ts$/, ''))
    .sort();
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path.join(directory, entry.name));
    }
    return [entry.name];
  });
}

function readWorkspaceScorerContract(): any {
  const fixturePath = path.resolve(
    __dirname,
    '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/scorer_contract.json',
  );
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

describe('recommendation runtime ownership', () => {
  it('keeps Node recommendation as the legacy baseline while Rust owns new algorithms', () => {
    expect(RECOMMENDATION_CANONICAL_ALGORITHM_OWNER).toBe('rust');
    expect(NODE_RECOMMENDATION_BASELINE_ROLE).toBe('legacy_baseline_fallback');
    expect(SpaceFeedMixer.runtimeRole).toBe(NODE_RECOMMENDATION_BASELINE_ROLE);
    expect(SpaceFeedMixer.canonicalAlgorithmOwner).toBe(RECOMMENDATION_CANONICAL_ALGORITHM_OWNER);
    expect(NODE_RECOMMENDATION_ALLOWED_RESPONSIBILITIES).toEqual([
      'feed_api_adapter',
      'rust_recommendation_call',
      'legacy_baseline_fallback',
      'response_hydration',
      'legacy_response_shape',
    ]);
    expect(NODE_RECOMMENDATION_FROZEN_GROWTH_AREAS).toEqual([
      'new_sources',
      'new_filters',
      'new_selectors',
      'new_scorers',
      'new_ranking_weights',
      'new_multi_source_fusion',
    ]);
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
      'AuthorAffinityScorer',
      'ContentQualityScorer',
      'RecencyScorer',
      'AuthorDiversityScorer',
      'OONScorer',
    ]);
    expect(NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS).toEqual([
      'VFFilter',
      'ConversationDedupFilter',
    ]);
    expect(NODE_RECOMMENDATION_LEGACY_SELECTOR).toBe('TopKSelector');
    expect(NODE_RECOMMENDATION_LEGACY_NON_PIPELINE_COMPONENT_FILES).toEqual([
      'FollowingTimelineCache',
      'SafetyFilter',
    ]);
  });

  it('keeps the Node component catalog pinned to the legacy baseline contract', () => {
    expect(RECOMMENDATION_SOURCE_ORDER).toEqual(NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES);
    expect(buildRecommendationSources().map((source) => source.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES,
    );
    expect(buildRecommendationQueryHydrators().map((hydrator) => hydrator.name)).toEqual(
      RECOMMENDATION_QUERY_HYDRATOR_ORDER,
    );
    expect(
      buildRecommendationQueryHydrators({ includeExperimentQueryHydrator: false }).map(
        (hydrator) => hydrator.name,
      ),
    ).toEqual(
      RECOMMENDATION_QUERY_HYDRATOR_ORDER.filter((name) => name !== 'ExperimentQueryHydrator'),
    );
    expect(buildRecommendationFilters().map((filter) => filter.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS,
    );
    const scorerNames = buildRecommendationScorers().map((scorer) => scorer.name);
    expect(scorerNames).toEqual(NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS);
    expect(scorerNames.indexOf('AuthorAffinityScorer')).toBeLessThan(
      scorerNames.indexOf('ContentQualityScorer'),
    );
    expect(buildRecommendationPostSelectionFilters().map((filter) => filter.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS,
    );
    expect(buildRecommendationSelector(20).name).toBe(NODE_RECOMMENDATION_LEGACY_SELECTOR);
  });

  it('keeps SpaceFeedMixer as a thin consumer of the frozen component catalog', () => {
    const mixer = new SpaceFeedMixer({ experimentsEnabled: false });
    const pipeline = (mixer as any).pipeline;

    expect(pipeline.queryHydrators.map((hydrator: { name: string }) => hydrator.name)).toEqual(
      RECOMMENDATION_QUERY_HYDRATOR_ORDER.filter((name) => name !== 'ExperimentQueryHydrator'),
    );
    expect(pipeline.sources.map((source: { name: string }) => source.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES,
    );
    expect(pipeline.filters.map((filter: { name: string }) => filter.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS,
    );
    expect(pipeline.scorers.map((scorer: { name: string }) => scorer.name)).toEqual(
      NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS,
    );
    expect(pipeline.selector.name).toBe(NODE_RECOMMENDATION_LEGACY_SELECTOR);
  });

  it('keeps Node scorer ownership aligned with the Rust main ranking ladder', () => {
    expect(RUST_RECOMMENDATION_SCORER_ORDER).toEqual([
      ...NODE_RECOMMENDATION_PROVIDER_SCORERS,
      ...RUST_RECOMMENDATION_LOCAL_SCORER_ORDER,
    ]);
    const workspaceScorerContract = readWorkspaceScorerContract();
    const rustLocalCandidateFieldWrites =
      workspaceScorerContract.rustLocalCandidateFieldWrites as Record<string, string[]>;
    expect(workspaceScorerContract.providerScorers).toEqual(NODE_RECOMMENDATION_PROVIDER_SCORERS);
    expect(workspaceScorerContract.localScorers).toEqual(RUST_RECOMMENDATION_LOCAL_SCORER_ORDER);
    expect(workspaceScorerContract.nodeProviderCandidateFieldWrites).toEqual(
      NODE_PROVIDER_SCORER_CANDIDATE_FIELD_WRITES,
    );
    expect(Object.keys(rustLocalCandidateFieldWrites)).toEqual(
      RUST_RECOMMENDATION_LOCAL_SCORER_ORDER,
    );
    expect(
      Object.entries(rustLocalCandidateFieldWrites)
        .filter(([, fields]) => fields.includes('score'))
        .map(([scorer]) => scorer),
    ).toEqual(['AuthorDiversityScorer']);
    expect(
      Object.entries(rustLocalCandidateFieldWrites)
        .filter(([, fields]) => fields.includes('weighted_score'))
        .map(([scorer]) => scorer),
    ).toEqual(
      RUST_RECOMMENDATION_LOCAL_SCORER_ORDER.filter(
        (scorer) =>
          !['LightweightPhoenixScorer', 'AuthorDiversityScorer', 'ScoreContractScorer'].includes(
            scorer,
          ),
      ),
    );
    expect(Object.keys(NODE_LEGACY_SCORER_CANDIDATE_FIELD_WRITES)).toEqual(
      NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS,
    );
    expect(NODE_PROVIDER_SCORER_CANDIDATE_FIELD_WRITES).toEqual({
      PhoenixScorer: ['phoenixScores'],
      EngagementScorer: ['phoenixScores'],
    });
    expect(NODE_LEGACY_SCORER_CANDIDATE_FIELD_WRITES.WeightedScorer).toEqual(['weightedScore']);
    expect(NODE_LEGACY_SCORER_CANDIDATE_FIELD_WRITES.ScoreCalibrationScorer).toEqual([
      'weightedScore',
      'scoreContractVersion',
      'scoreBreakdownVersion',
    ]);
    expect(NODE_LEGACY_SCORER_RUST_STAGE_ALIGNMENT.OONScorer).toEqual(['OutOfNetworkScorer']);
    expect(nodeLegacyScorerWritesFinalScore('WeightedScorer')).toBe(false);
    expect(nodeLegacyScorerWritesFinalScore('AuthorDiversityScorer')).toBe(true);
    expect(
      NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS.filter((scorer) =>
        nodeLegacyScorerWritesFinalScore(scorer),
      ),
    ).toEqual(['AuthorDiversityScorer', 'OONScorer']);
    expect(
      NODE_RECOMMENDATION_PROVIDER_SCORERS.some((scorer) =>
        nodeLegacyScorerWritesFinalScore(scorer),
      ),
    ).toBe(false);
    expect(() =>
      assertNodeProviderScorerCandidateWrites(
        'PhoenixScorer',
        {} as any,
        { phoenixScores: { likeScore: 0.1 } } as any,
      ),
    ).not.toThrow();
    expect(() =>
      assertNodeProviderScorerCandidateWrites(
        'PhoenixScorer',
        {} as any,
        { weightedScore: 0.7 } as any,
      ),
    ).toThrow('provider_scorer_field_ownership_violation:PhoenixScorer:weightedScore');
  });

  it('fails when Node recommendation component files grow outside the frozen contract', () => {
    expect(componentFiles('sources')).toEqual(
      [...NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES, 'FollowingTimelineCache'].sort(),
    );
    expect(componentFiles('scorers')).toEqual(
      [...NODE_RECOMMENDATION_LEGACY_BASELINE_SCORERS].sort(),
    );
    expect(componentFiles('filters')).toEqual(
      [
        ...NODE_RECOMMENDATION_LEGACY_BASELINE_FILTERS,
        ...NODE_RECOMMENDATION_LEGACY_POST_SELECTION_FILTERS,
        'SafetyFilter',
      ].sort(),
    );
  });
});
