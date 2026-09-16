/**
 * Space domain module barrel.
 * Public surface remains `services/spaceService` for callers during the incremental split.
 */
export * from './types';
export * from './internal/pureHelpers';
export * from './news/newsQueries';
export * from './search/searchQueries';
export * from './posts/postMutations';
export * from './internal/postFeatureSnapshots';
