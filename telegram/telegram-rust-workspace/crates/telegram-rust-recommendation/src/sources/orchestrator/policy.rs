use std::collections::HashMap;

use serde_json::Value;
use telegram_ranking_primitives::new_score_breakdown_map;
use telegram_source_primitives::{
    SOURCE_DETAIL_COST_CLASS_FIELD, SOURCE_DETAIL_MIXING_MULTIPLIER_FIELD,
    SOURCE_DETAIL_ML_COST_GUARD_FIELD, SOURCE_DETAIL_ONLINE_ALLOWED_FIELD,
    SOURCE_DETAIL_POLICY_STATE_FIELD, SOURCE_DETAIL_POLICY_TRUNCATED_COUNT_FIELD,
    SOURCE_DETAIL_PRE_POLICY_COUNT_FIELD, SOURCE_DETAIL_READINESS_IMPACT_FIELD,
    SOURCE_DETAIL_RETRIEVAL_LANE_FIELD, SOURCE_DETAIL_SOURCE_BUDGET_FIELD,
    SOURCE_DETAIL_SOURCE_ID_FIELD, SOURCE_DETAIL_SOURCE_LANE_BUDGET_FIELD,
    SOURCE_DETAIL_TREND_BOOST_RATIO_FIELD, SOURCE_SIGNAL_BUDGET_PRESSURE_FIELD,
    SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD, SOURCE_SIGNAL_POLICY_SURVIVAL_RATE_FIELD,
    SOURCE_SIGNAL_RANK_FIELD, SOURCE_SIGNAL_RANK_SCORE_FIELD, SOURCE_SIGNAL_SCORE_FIELD,
    normalized_source_score, source_budget_pressure, source_policy_survival_rate,
    source_recall_confidence,
};

use crate::contracts::{
    RecallEvidencePayload, RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationStagePayload,
};
use crate::pipeline::local::context::source_plan;

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
    let plan = source_plan(query, source_name, pre_policy_count);
    let budget = plan.budget;
    candidates.truncate(budget);
    let retrieval_lane = plan.lane.to_string();
    let candidate_count = candidates.len();
    let denominator = candidate_count.saturating_sub(1).max(1) as f64;
    let budget_pressure = source_budget_pressure(pre_policy_count, budget);
    let survival_rate = source_policy_survival_rate(pre_policy_count, candidate_count);
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
        let source_score = candidate.primary_score();
        let normalized_source_score = normalized_source_score(source_score);
        candidate.recall_evidence = Some(RecallEvidencePayload {
            primary_source: candidate.recall_source.clone(),
            primary_lane: candidate.retrieval_lane.clone(),
            source_rank: Some(rank as f64),
            source_rank_score: Some(source_rank_score),
            source_score: Some(source_score),
            source_count: 1.0,
            same_lane_source_count: 0.0,
            cross_lane_source_count: 0.0,
            confidence: source_recall_confidence(
                source_rank_score,
                normalized_source_score,
                budget_pressure,
                survival_rate,
            ),
        });
        let breakdown = candidate
            .score_breakdown
            .get_or_insert_with(new_score_breakdown_map);
        breakdown.insert(SOURCE_SIGNAL_RANK_FIELD.to_string(), rank as f64);
        breakdown.insert(
            SOURCE_SIGNAL_RANK_SCORE_FIELD.to_string(),
            source_rank_score,
        );
        breakdown.insert(SOURCE_SIGNAL_SCORE_FIELD.to_string(), source_score);
        breakdown.insert(
            SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD.to_string(),
            normalized_source_score,
        );
        breakdown.insert(
            SOURCE_SIGNAL_BUDGET_PRESSURE_FIELD.to_string(),
            budget_pressure,
        );
        breakdown.insert(
            SOURCE_SIGNAL_POLICY_SURVIVAL_RATE_FIELD.to_string(),
            survival_rate,
        );
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
        detail.insert(
            SOURCE_DETAIL_POLICY_STATE_FIELD.to_string(),
            Value::String(user_state),
        );
    }
    detail.insert(
        SOURCE_DETAIL_SOURCE_ID_FIELD.to_string(),
        Value::String(plan.source_id),
    );
    detail.insert(
        SOURCE_DETAIL_RETRIEVAL_LANE_FIELD.to_string(),
        Value::String(retrieval_lane),
    );
    detail.insert(
        SOURCE_DETAIL_SOURCE_BUDGET_FIELD.to_string(),
        Value::from(budget as u64),
    );
    detail.insert(
        SOURCE_DETAIL_SOURCE_LANE_BUDGET_FIELD.to_string(),
        Value::from(plan.lane_budget as u64),
    );
    detail.insert(
        SOURCE_DETAIL_PRE_POLICY_COUNT_FIELD.to_string(),
        Value::from(pre_policy_count as u64),
    );
    detail.insert(
        SOURCE_DETAIL_MIXING_MULTIPLIER_FIELD.to_string(),
        Value::from(plan.mixing_multiplier),
    );
    detail.insert(
        SOURCE_DETAIL_TREND_BOOST_RATIO_FIELD.to_string(),
        Value::from(plan.trend_boost_ratio),
    );
    detail.insert(
        SOURCE_DETAIL_ML_COST_GUARD_FIELD.to_string(),
        Value::String(plan.ml_cost_guard.to_string()),
    );
    if let Some(descriptor) = plan.descriptor {
        detail.insert(
            SOURCE_DETAIL_COST_CLASS_FIELD.to_string(),
            Value::String(descriptor.cost_class.as_str().to_string()),
        );
        detail.insert(
            SOURCE_DETAIL_READINESS_IMPACT_FIELD.to_string(),
            Value::String(descriptor.readiness_impact.as_str().to_string()),
        );
        detail.insert(
            SOURCE_DETAIL_ONLINE_ALLOWED_FIELD.to_string(),
            Value::Bool(descriptor.online_allowed),
        );
    }
    if truncated_count > 0 {
        detail.insert(
            SOURCE_DETAIL_POLICY_TRUNCATED_COUNT_FIELD.to_string(),
            Value::from(truncated_count as u64),
        );
    }
}
