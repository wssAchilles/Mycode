use crate::contracts::RecommendationCandidatePayload;
use crate::selectors::dpp_ranker::DppMetrics;
pub use telegram_selector_primitives::SelectorSelectionReport;

#[derive(Debug, Clone)]
pub struct SelectorSelectionOutput {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub report: SelectorSelectionReport,
    /// 若本次选择器启用了 V3 DPP 多样性重排，记录其统计指标以透传至 Stage Detail。
    pub dpp_metrics: Option<DppMetrics>,
}

pub(super) use telegram_selector_primitives::first_blocking_reason;
