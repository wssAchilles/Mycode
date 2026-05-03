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
  NewsModelContextQueryHydrator,
  UserActionSeqQueryHydrator,
  UserEmbeddingQueryHydrator,
  UserFeaturesQueryHydrator,
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
import { NODE_RECOMMENDATION_PROVIDER_SCORERS } from '../contracts/runtimeOwnership';

export const RECOMMENDATION_SOURCE_ORDER = [
  'FollowingSource',
  'GraphSource',
  'NewsAnnSource',
  'EmbeddingAuthorSource',
  'PopularSource',
  'TwoTowerSource',
  'ColdStartSource',
] as const;

export const RECOMMENDATION_QUERY_HYDRATOR_ORDER = [
  'UserFeaturesQueryHydrator',
  'UserEmbeddingQueryHydrator',
  'UserActionSeqQueryHydrator',
  'UserStateQueryHydrator',
  'NewsModelContextQueryHydrator',
  'ExperimentQueryHydrator',
] as const;

export const ML_RETRIEVAL_SOURCE_NAMES = new Set<string>([
  'NewsAnnSource',
  'EmbeddingAuthorSource',
  'TwoTowerSource',
]);

export const ML_RANKING_SCORER_NAMES = new Set<string>(NODE_RECOMMENDATION_PROVIDER_SCORERS);

export function buildRecommendationQueryHydrators(): QueryHydrator<FeedQuery>[] {
  return [
    new UserFeaturesQueryHydrator(),
    new UserEmbeddingQueryHydrator(),
    new UserActionSeqQueryHydrator(),
    new UserStateQueryHydrator(),
    new NewsModelContextQueryHydrator(),
    new ExperimentQueryHydrator(),
  ];
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
  const sources: Source<FeedQuery, FeedCandidate>[] = [
    new FollowingSource(),
    new GraphSource(),
    new NewsAnnSource(),
    new EmbeddingAuthorSource(),
    new PopularSource(),
    new TwoTowerSource(),
    new ColdStartSource(),
  ];

  return Object.fromEntries(sources.map((source) => [source.name, source]));
}

export function buildRecommendationSourceOrder(): string[] {
  return [...RECOMMENDATION_SOURCE_ORDER];
}

export function isMlRetrievalSourceName(sourceName: string): boolean {
  return ML_RETRIEVAL_SOURCE_NAMES.has(sourceName);
}

export function isMlRankingScorerName(scorerName: string): boolean {
  return ML_RANKING_SCORER_NAMES.has(scorerName);
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
    new ContentQualityScorer(),
    new AuthorAffinityScorer(),
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
