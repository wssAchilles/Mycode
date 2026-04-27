use std::collections::HashMap;

use serde_json::Value;

use crate::contracts::{
    RecallEvidencePayload, RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationStagePayload,
};
use crate::pipeline::local::context::{
    source_candidate_budget, source_mixing_multiplier, source_retrieval_lane,
};

pub(super) fn apply_source_policy(
    query: &RecommendationQueryPayload,
    source_name: &str,
    stage: &mut RecommendationStagePayload,
    candidates: &mut Vec<RecommendationCandidatePayload>,
) {
    if !stage.enabled {
        return;
    }

    let pre_policy_count = candidates.len();
    let budget = source_candidate_budget(query, source_name, pre_policy_count);
    candidates.truncate(budget);
    let retrieval_lane = source_retrieval_lane(source_name).to_string();
    let candidate_count = candidates.len();
    let denominator = candidate_count.saturating_sub(1).max(1) as f64;
    for (rank, candidate) in candidates.iter_mut().enumerate() {
        if candidate
            .recall_source
            .as_ref()
            .is_none_or(|value| value.trim().is_empty())
        {
            candidate.recall_source = Some(source_name.to_string());
        }
        candidate.retrieval_lane = Some(retrieval_lane.clone());
        let source_rank_score = if candidate_count <= 1 {
            1.0
        } else {
            1.0 - (rank as f64 / denominator)
        };
        let source_score = candidate
            .score
            .or(candidate.pipeline_score)
            .or(candidate.weighted_score)
            .unwrap_or_default();
        candidate.recall_evidence = Some(RecallEvidencePayload {
            primary_source: candidate.recall_source.clone(),
            primary_lane: candidate.retrieval_lane.clone(),
            source_rank: Some(rank as f64),
            source_rank_score: Some(source_rank_score),
            source_score: Some(source_score),
            source_count: 1.0,
            same_lane_source_count: 0.0,
            cross_lane_source_count: 0.0,
            confidence: clamp01(0.42 + source_rank_score * 0.24 + clamp01(source_score) * 0.14),
        });
        let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
        breakdown.insert("sourceRank".to_string(), rank as f64);
        breakdown.insert("sourceRankScore".to_string(), source_rank_score);
        breakdown.insert("sourceScore".to_string(), source_score);
    }
    let truncated_count = pre_policy_count.saturating_sub(candidates.len());

    stage.output_count = candidates.len();
    stage.removed_count = (truncated_count > 0).then_some(truncated_count);

    let detail = stage.detail.get_or_insert_with(HashMap::new);
    if let Some(user_state) = query
        .user_state_context
        .as_ref()
        .map(|context| context.state.clone())
    {
        detail.insert("policyState".to_string(), Value::String(user_state));
    }
    detail.insert("retrievalLane".to_string(), Value::String(retrieval_lane));
    detail.insert("sourceBudget".to_string(), Value::from(budget as u64));
    detail.insert(
        "prePolicyCount".to_string(),
        Value::from(pre_policy_count as u64),
    );
    detail.insert(
        "sourceMixingMultiplier".to_string(),
        Value::from(source_mixing_multiplier(query, source_name)),
    );
    if truncated_count > 0 {
        detail.insert(
            "policyTruncatedCount".to_string(),
            Value::from(truncated_count as u64),
        );
    }
}

pub(super) fn clamp01(value: f64) -> f64 {
    value.max(0.0).min(1.0)
}
