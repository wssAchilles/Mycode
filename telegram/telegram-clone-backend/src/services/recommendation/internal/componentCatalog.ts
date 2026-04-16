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
  UserFeaturesQueryHydrator,
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
  WeightedScorer,
} from '../scorers';
import {
  ColdStartSource,
  FollowingSource,
  GraphSource,
  NewsAnnSource,
  PopularSource,
  TwoTowerSource,
} from '../sources';

export function buildRecommendationQueryHydrators(): QueryHydrator<FeedQuery>[] {
  return [
    new UserFeaturesQueryHydrator(),
    new UserActionSeqQueryHydrator(),
    new NewsModelContextQueryHydrator(),
    new ExperimentQueryHydrator(),
  ];
}

export function buildRecommendationSourceCatalog(): Record<string, Source<FeedQuery, FeedCandidate>> {
  const sources: Source<FeedQuery, FeedCandidate>[] = [
    new FollowingSource(),
    new GraphSource(),
    new NewsAnnSource(),
    new PopularSource(),
    new TwoTowerSource(),
    new ColdStartSource(),
  ];

  return Object.fromEntries(sources.map((source) => [source.name, source]));
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
    new ContentQualityScorer(),
    new AuthorAffinityScorer(),
    new RecencyScorer(),
    new AuthorDiversityScorer(),
    new OONScorer(),
  ];
}

export function buildRecommendationPostSelectionHydrators(): Hydrator<FeedQuery, FeedCandidate>[] {
  return [new VFCandidateHydrator()];
}

export function buildRecommendationPostSelectionFilters(): Filter<FeedQuery, FeedCandidate>[] {
  return [new VFFilter(), new ConversationDedupFilter()];
}
