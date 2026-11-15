//! 管线契约子模块聚合（按阶段摘要、追踪评估与分阶段 RPC 响应拆分）。

pub mod responses;
pub mod stage;
pub mod trace;

pub use responses::{
    CandidateFilterStageResponse, CandidateStageRequest, CandidateStageResponse,
    QueryHydrateResponse, QueryHydratorBatchRequest, QueryHydratorBatchResponse,
    QueryHydratorPatchResponse, RankingResponse, RetrievalResponse, SourceBatchRequest,
    SourceBatchResponse, SourceCandidatesResponse,
};
pub use stage::{
    RecommendationGraphRetrievalPayload, RecommendationRankingSummaryPayload,
    RecommendationRetrievalSummaryPayload, RecommendationSelectorPayload,
    RecommendationServingSummaryPayload, RecommendationStagePayload,
};
pub use trace::{
    RecommendationOnlineEvaluationPayload, RecommendationResultPayload,
    RecommendationSummaryPayload, RecommendationTraceCandidatePayload,
    RecommendationTraceFreshnessPayload, RecommendationTracePayload,
    RecommendationTraceReplayPoolPayload, RecommendationTraceSourceCountPayload,
};
