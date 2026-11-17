//! 查询契约子模块聚合（按特征、策略、V3 序列与请求补丁领域拆分）。

pub mod features;
pub mod policy;
pub mod request;
pub mod sequences;

pub use features::{
    Demographics, EmbeddingContextPayload, EmbeddingContractPayload, SparseEmbeddingEntryPayload,
    UserFeaturesPayload, UserSignalFeaturesPayload, UserStateContextPayload,
    deserialize_flexible_age_range,
};
pub use policy::{ExperimentAssignmentPayload, ExperimentContextPayload, RankingPolicyPayload};
pub use request::{RecommendationQueryPatchPayload, RecommendationQueryPayload};
pub use sequences::{CachedPostEntryPayload, ColumnarActionStepPayload, ServedHistoryEntryPayload};
