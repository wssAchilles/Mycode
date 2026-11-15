//! 候选水合器异步缓存与两阶段原语模块（对标 x-algorithm `hydrator.rs`）。

pub mod cache_store;
pub mod cached_fetch;
pub mod cached_hydrator;
pub mod helpers;
pub mod traits;
pub mod two_phase;

#[cfg(test)]
mod tests;

pub use cache_store::{CacheStore, MokaCacheStore};
pub use cached_fetch::CachedFetch;
pub use cached_hydrator::{CachedHydrator, CachedHydratorExecutor};
pub use helpers::{
    cache_stage_detail, candidate_hydrator_cache_key, query_hydrator_cache_key,
};
pub use traits::{Hydrator, HydratorOutput, checked_len};
pub use two_phase::TwoPhaseHydrator;
