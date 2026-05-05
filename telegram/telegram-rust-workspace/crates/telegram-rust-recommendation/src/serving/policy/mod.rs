mod cache;
mod cursor;
mod fingerprint;
mod guard;

pub use cache::{CACHE_KEY_MODE, CACHE_POLICY_MODE, evaluate_store_policy};
pub use fingerprint::build_query_fingerprint;

#[derive(Debug, Clone)]
pub struct ServeCacheStorePolicy {
    pub cacheable: bool,
    pub reason: String,
}

#[cfg(test)]
mod tests;
