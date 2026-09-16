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
export * from './interactions/interactions';
export * from './internal/userMap';
export * from './profiles/profileQueries';
export * from './profiles/recommendedUsers';
export * from './feed/feedPage';
