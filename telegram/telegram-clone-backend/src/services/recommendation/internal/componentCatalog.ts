import type {
  Filter,
  Hydrator,
  QueryHydrator,
  Scorer,
  Source,
} from '../framework';
import type { FeedCandidate } from '../types/FeedCandidate';
import type { FeedQuery } from '../types/FeedQuery';
import {
  AuthorInfoHydrator,
  ExperimentQueryHydrator,
  InterestedTopicsQueryHydrator,
  MutualFollowQueryHydrator,
  NewsModelContextQueryHydrator,
  UserActionSeqQueryHydrator,
  UserEmbeddingQueryHydrator,
  UserFeaturesQueryHydrator,
  UserSignalQueryHydrator,
  UserStateQueryHydrator,
  UserInteractionHydrator,
  VFCandidateHydrator,
  VideoInfoHydrator,
} from '../hydrators';
import {
  AgeFilter,
  BlockedUserFilter,
  ConversationDedupFilter,
  DuplicateFilter,
  MutedKeywordFilter,
  NewsExternalIdDedupFilter,
  PreviouslyServedFilter,
  RetweetDedupFilter,
  SeenPostFilter,
  SelfPostFilter,
  VFFilter,
} from '../filters';
import {
  AuthorAffinityScorer,
  AuthorDiversityScorer,
  ContentQualityScorer,
  EngagementScorer,
  OONScorer,
  PhoenixScorer,
  RecencyScorer,
  ScoreCalibrationScorer,
  WeightedScorer,
} from '../scorers';
import {
  ColdStartSource,
  EmbeddingAuthorSource,
  FollowingSource,
  GraphSource,
  NewsAnnSource,
  PopularSource,
  TwoTowerSource,
} from '../sources';
import { TopKSelector } from '../selectors';
import {
  isNodeRecommendationProviderScorer,
  NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES,
  NODE_RECOMMENDATION_PROVIDER_SCORERS,
} from '../contracts/runtimeOwnership';

export const RECOMMENDATION_SOURCE_ORDER = NODE_RECOMMENDATION_LEGACY_BASELINE_SOURCES;

export const RECOMMENDATION_QUERY_HYDRATOR_ORDER = [
  'UserFeaturesQueryHydrator',
  'UserEmbeddingQueryHydrator',
  'UserActionSeqQueryHydrator',
  'UserStateQueryHydrator',
  'NewsModelContextQueryHydrator',
  'UserSignalQueryHydrator',
  'ExperimentQueryHydrator',
] as const;

export const ML_RETRIEVAL_SOURCE_NAMES = new Set<string>([
  'NewsAnnSource',
  'EmbeddingAuthorSource',
  'TwoTowerSource',
]);

export const ML_RANKING_SCORER_NAMES = new Set<string>(NODE_RECOMMENDATION_PROVIDER_SCORERS);

export interface RecommendationCatalogOptions {
  includeExperimentQueryHydrator?: boolean;
}

export function buildRecommendationQueryHydrators(
  options: RecommendationCatalogOptions = {},
): QueryHydrator<FeedQuery>[] {
  const includeExperimentQueryHydrator = options.includeExperimentQueryHydrator ?? true;
  const hydrators: QueryHydrator<FeedQuery>[] = [
    new UserFeaturesQueryHydrator(),
    new MutualFollowQueryHydrator(),
    new InterestedTopicsQueryHydrator(),
    new UserEmbeddingQueryHydrator(),
    new UserActionSeqQueryHydrator(),
    new UserStateQueryHydrator(),
    new NewsModelContextQueryHydrator(),
    new UserSignalQueryHydrator(),
  ];

  if (includeExperimentQueryHydrator) {
    hydrators.push(new ExperimentQueryHydrator());
  }

  return hydrators;
}

export function buildRecommendationQueryHydratorCatalog(): Record<
  string,
  QueryHydrator<FeedQuery>
> {
  return Object.fromEntries(
    buildRecommendationQueryHydrators().map((hydrator) => [hydrator.name, hydrator]),
  );
}

export function buildRecommendationSourceCatalog(): Record<string, Source<FeedQuery, FeedCandidate>> {
  return Object.fromEntries(buildRecommendationSources().map((source) => [source.name, source]));
}

export function buildRecommendationSources(): Source<FeedQuery, FeedCandidate>[] {
  return [
    new FollowingSource(),
    new GraphSource(),
    new NewsAnnSource(),
    new EmbeddingAuthorSource(),
    new PopularSource(),
    new TwoTowerSource(),
    new ColdStartSource(),
  ];
}

export function buildRecommendationSourceOrder(): string[] {
  return [...RECOMMENDATION_SOURCE_ORDER];
}

export function isMlRetrievalSourceName(sourceName: string): boolean {
  return ML_RETRIEVAL_SOURCE_NAMES.has(sourceName);
}

export function isMlRankingScorerName(scorerName: string): boolean {
  return isNodeRecommendationProviderScorer(scorerName);
}

export function buildRecommendationHydrators(): Hydrator<FeedQuery, FeedCandidate>[] {
  return [
    new AuthorInfoHydrator(),
    new UserInteractionHydrator(),
    new VideoInfoHydrator(),
  ];
}

export function buildRecommendationFilters(): Filter<FeedQuery, FeedCandidate>[] {
  return [
    new DuplicateFilter(),
    new NewsExternalIdDedupFilter(),
    new SelfPostFilter(),
    new RetweetDedupFilter(),
    new AgeFilter(7),
    new BlockedUserFilter(),
    new MutedKeywordFilter(),
    new SeenPostFilter(),
    new PreviouslyServedFilter(),
  ];
}

export function buildRecommendationScorers(): Scorer<FeedQuery, FeedCandidate>[] {
  return [
    new PhoenixScorer(),
    new EngagementScorer(),
    new WeightedScorer(),
    new ScoreCalibrationScorer(),
    new AuthorAffinityScorer(),
    new ContentQualityScorer(),
    new RecencyScorer(),
    new AuthorDiversityScorer(),
    new OONScorer(),
  ];
}

export function buildRecommendationScorerCatalog(): Record<string, Scorer<FeedQuery, FeedCandidate>> {
  return Object.fromEntries(
    buildRecommendationScorers().map((scorer) => [scorer.name, scorer]),
  );
}

export function buildRecommendationPostSelectionHydrators(): Hydrator<FeedQuery, FeedCandidate>[] {
  return [new VFCandidateHydrator()];
}

export function buildRecommendationPostSelectionFilters(): Filter<FeedQuery, FeedCandidate>[] {
  return [new VFFilter(), new ConversationDedupFilter()];
}

export function buildRecommendationSelector(
  defaultResultSize: number,
): TopKSelector {
  return new TopKSelector(defaultResultSize, { oversampleFactor: 5, maxSize: 200 });
}
