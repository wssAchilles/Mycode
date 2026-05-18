use std::future::Future;
use std::pin::Pin;

use anyhow::Result;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

/// A content source that produces ranked candidates for blending into the feed.
///
/// Each implementation represents a distinct content type (posts, ads, suggestions)
/// with its own retrieval, scoring, and filtering logic.
///
/// Modeled after X's outer pipeline sources (ads, WTF, prompts) that feed into
/// `ForYouCandidatePipeline` alongside the inner `PhoenixCandidatePipeline`.
pub trait ContentPipeline: Send + Sync {
    /// Human-readable name for telemetry and logging.
    fn name(&self) -> &str;

    /// Produce ranked candidates for the given query.
    ///
    /// Implementations should attach `weighted_score` to each candidate
    /// so the merger can compare scores across sources.
    fn retrieve_candidates(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<RecommendationCandidatePayload>>> + Send + '_>>;
}

/// Merges candidates from multiple content pipelines into a single ordered list.
///
/// The merger applies inter-source diversity rules and priority balancing
/// before handing off to the final selector.
pub trait CandidateMerger: Send + Sync {
    fn merge(
        &self,
        groups: Vec<CandidateGroup>,
        max_size: usize,
    ) -> Vec<RecommendationCandidatePayload>;
}

/// A named group of candidates from a single content pipeline.
pub struct CandidateGroup {
    pub source_name: String,
    pub candidates: Vec<RecommendationCandidatePayload>,
}

impl CandidateGroup {
    pub fn new(
        source_name: impl Into<String>,
        candidates: Vec<RecommendationCandidatePayload>,
    ) -> Self {
        Self {
            source_name: source_name.into(),
            candidates,
        }
    }
}
