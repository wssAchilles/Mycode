//! Two-level composite pipeline for blending multiple content sources.
//!
//! This module implements the composite pipeline pattern from X's architecture,
//! where an inner pipeline (posts) is wrapped by an outer pipeline that can
//! inject additional content types (ads, suggestions, prompts) before final selection.
//!
//! # Architecture
//!
//! ```text
//! CompositeRecommendationPipeline
//! ├── Inner: RecommendationPipeline (posts)
//! │   ├── Query Hydration
//! │   ├── Source Retrieval
//! │   ├── Scoring
//! │   └── TopK Selection
//! ├── Outer: ContentPipeline (ads, suggestions, etc.)
//! └── Merger: CandidateMerger → Re-selection
//! ```
//!
//! # Merger Strategies
//!
//! - [`InterleaveMerger`]: Round-robin balance across sources (default)
//! - [`WeightedScoreMerger`]: Global score ranking with per-source caps

mod interleave_merger;
mod pipeline;
#[cfg(test)]
mod test_helpers;
mod traits;
mod weighted_merger;

pub use interleave_merger::InterleaveMerger;
pub use pipeline::CompositeRecommendationPipeline;
pub use traits::{CandidateGroup, CandidateMerger, ContentPipeline};
pub use weighted_merger::WeightedScoreMerger;
