//! 候选契约子模块聚合（按多媒体、分值、安全与 V3 上下文领域拆分）。

pub mod core;
pub mod media;
pub mod safety;
pub mod sanitize;
pub mod scores;
pub mod v3;

pub use self::core::RecommendationCandidatePayload;
pub use media::{CandidateMediaPayload, CandidateNewsMetadataPayload, MediaType};
pub use safety::{CandidateVisibilityPayload, ContentSafetyLabelsPayload};
pub use scores::{
    ActionScoresPayload, PhoenixScoresPayload, RankingSignalsPayload, RecallEvidencePayload,
};
pub use v3::{RetrievalSourcePayload, SlateContextPayload};
