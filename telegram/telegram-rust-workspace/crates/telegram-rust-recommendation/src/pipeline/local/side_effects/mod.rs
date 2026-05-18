pub mod diversity_stats;
pub mod feature_caching;
pub mod request_caching;

use std::collections::HashMap;
use std::fmt;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

/// Errors that can occur during side effect execution.
#[derive(Debug)]
pub enum SideEffectError {
    /// Cache operation failed.
    Cache(String),
    /// Serialization failed.
    Serialization(serde_json::Error),
    /// Redis operation failed.
    Redis(redis::RedisError),
    /// Side effect timed out.
    Timeout(String),
}

impl fmt::Display for SideEffectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cache(msg) => write!(f, "cache operation failed: {msg}"),
            Self::Serialization(err) => write!(f, "serialization failed: {err}"),
            Self::Redis(err) => write!(f, "redis operation failed: {err}"),
            Self::Timeout(msg) => write!(f, "side effect timed out: {msg}"),
        }
    }
}

impl From<serde_json::Error> for SideEffectError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serialization(err)
    }
}

impl From<redis::RedisError> for SideEffectError {
    fn from(err: redis::RedisError) -> Self {
        Self::Redis(err)
    }
}

/// Context passed to side effects after recommendation pipeline completes.
#[derive(Debug, Clone)]
pub struct SideEffectContext {
    /// The user who requested recommendations.
    pub user_id: String,
    /// The final scored candidates from the pipeline.
    pub candidates: Vec<RecommendationCandidatePayload>,
    /// The original recommendation query.
    pub query: RecommendationQueryPayload,
    /// Deterministic hash of the request parameters for caching.
    pub request_hash: String,
}

/// Trait for post-recommendation side effects.
///
/// Side effects run asynchronously after the recommendation pipeline completes.
/// They handle tasks like caching, metrics recording, and diversity analysis.
#[async_trait]
pub trait SideEffect: Send + Sync {
    /// Execute the side effect with the given context.
    ///
    /// Implementations should handle errors gracefully and not propagate
    /// failures that would affect the recommendation response.
    async fn execute(&self, context: &SideEffectContext) -> Result<(), SideEffectError>;
}

/// Diversity statistics computed from recommendation results.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiversityStats {
    /// Number of unique sources in the result set.
    pub unique_source_count: usize,
    /// Total number of candidates.
    pub total_candidates: usize,
    /// Ratio of unique sources to total candidates.
    pub unique_source_ratio: f64,
    /// Number of unique authors in the result set.
    pub unique_author_count: usize,
    /// Ratio of unique authors to total candidates.
    pub unique_author_ratio: f64,
    /// Number of unique topics in the result set.
    pub unique_topic_count: usize,
    /// Ratio of unique topics to total candidates.
    pub unique_topic_ratio: f64,
    /// Distribution of candidates by source.
    pub source_distribution: HashMap<String, usize>,
    /// Distribution of candidates by author.
    pub author_distribution: HashMap<String, usize>,
    /// Distribution of candidates by topic.
    pub topic_distribution: HashMap<String, usize>,
}
