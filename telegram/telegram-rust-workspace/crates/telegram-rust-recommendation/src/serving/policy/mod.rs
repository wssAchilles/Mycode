mod cache;
mod cursor;
mod fingerprint;
mod guard;
mod randomized_slate;

pub use cache::{CACHE_KEY_MODE, CACHE_POLICY_MODE, evaluate_store_policy};
pub use fingerprint::build_query_fingerprint;
pub use randomized_slate::apply_online_epsilon_plackett_luce_slate;

#[derive(Debug, Clone)]
pub struct ServeCacheStorePolicy {
    pub cacheable: bool,
    pub reason: String,
}

#[cfg(test)]
mod tests;
