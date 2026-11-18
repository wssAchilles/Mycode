use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::Value;
use telegram_pipeline_primitives::EXECUTOR_LATENCY_SERVING;
use telegram_serving_primitives::{ServingPageBuildInput, ServingPageBuildSummary};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::space_feed_experiment_number;
use crate::serving::cursor::build_next_cursor;
use crate::serving::dedup::dedup_for_serving;
use crate::serving::policy::apply_online_epsilon_plackett_luce_slate;
use crate::serving::stable_order::{build_stable_order_key, sort_candidates_stably};
use crate::serving::stage_payload::{ServingStageInput, build_serving_stage};

use super::RecommendationPipeline;
use super::stage_runner::StageTimer;
use super::telemetry::RunTelemetry;

pub(super) struct ServingStageOutput {
    pub(super) final_candidates: Vec<RecommendationCandidatePayload>,
    pub(super) duplicate_suppressed_count: usize,
    pub(super) cross_page_duplicate_count: usize,
    pub(super) has_more: bool,
    pub(super) page_remaining_count: usize,
    pub(super) page_underfilled: bool,
    pub(super) page_underfill_reason: Option<String>,
    pub(super) suppression_reasons: HashMap<String, usize>,
    pub(super) truncated: bool,
    pub(super) next_cursor: Option<DateTime<Utc>>,
    pub(super) stable_order_key: String,
}

impl RecommendationPipeline {
    pub(super) fn execute_serving_stage(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        mut final_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> ServingStageOutput {
        let serving_timer = StageTimer::start();
        final_candidates.retain(|candidate| !self.thunder_store.is_deleted(&candidate.post_id));
        sort_candidates_stably(&mut final_candidates, hydrated_query.in_network_only);
        let serving_result = dedup_for_serving(
            hydrated_query,
            &final_candidates,
            hydrated_query.limit,
            self.config.serving_author_soft_cap,
        );
        let duplicate_suppressed_count = serving_result.duplicate_suppressed_count;
        let cross_page_duplicate_count = serving_result.cross_page_duplicate_count;
        let has_more = serving_result.has_more;
        let page_remaining_count = serving_result.page_remaining_count;
        let page_underfilled = serving_result.page_underfilled;
        let page_underfill_reason = serving_result.page_underfill_reason.clone();
        let suppression_reasons = serving_result.suppression_reasons.clone();
        let pre_serving_count = final_candidates.len();
        final_candidates = serving_result.candidates;
        let exploration_meta = maybe_apply_randomized_slate(hydrated_query, &mut final_candidates);
        let truncated = has_more;
        let next_cursor = build_next_cursor(&final_candidates);
        let stable_order_key =
            build_stable_order_key(&final_candidates, hydrated_query.in_network_only);
        let page_build_summary = ServingPageBuildSummary::from_input(ServingPageBuildInput {
            requested_limit: hydrated_query.limit,
            output_count: final_candidates.len(),
            page_remaining_count,
            duplicate_suppressed_count,
            cross_page_duplicate_count,
            has_more,
            page_underfilled,
            page_underfill_reason: page_underfill_reason.clone(),
            suppression_reasons: suppression_reasons.clone(),
        });
        let mut serving_stage = build_serving_stage(ServingStageInput {
            duration_ms: serving_timer.elapsed_ms(),
            input_count: pre_serving_count,
            summary: &page_build_summary,
            stable_order_key: &stable_order_key,
        });
        if let Some((epsilon, temperature, joint_propensity)) = exploration_meta
            && let Some(detail) = serving_stage.detail.as_mut()
        {
            detail.insert("randomizedSlateApplied".to_string(), Value::Bool(true));
            detail.insert(
                "randomizedSlateJointPropensity".to_string(),
                Value::from(joint_propensity),
            );
            detail.insert("randomizedSlateEpsilon".to_string(), Value::from(epsilon));
            detail.insert(
                "randomizedSlateTemperature".to_string(),
                Value::from(temperature),
            );
        }
        telemetry.add_stage(serving_stage);
        telemetry.record_latency(EXECUTOR_LATENCY_SERVING, serving_timer.elapsed_ms());

        ServingStageOutput {
            final_candidates,
            duplicate_suppressed_count,
            cross_page_duplicate_count,
            has_more,
            page_remaining_count,
            page_underfilled,
            page_underfill_reason,
            suppression_reasons,
            truncated,
            next_cursor,
            stable_order_key,
        }
    }
}

/// 当请求开启在线页级随机探索且上游未执行 Page Decoder 时，应用 ε-Plackett-Luce 采样。
fn maybe_apply_randomized_slate(
    query: &RecommendationQueryPayload,
    candidates: &mut [RecommendationCandidatePayload],
) -> Option<(f64, f64, f64)> {
    if query.in_network_only || candidates.len() < 2 {
        return None;
    }
    let enabled = query.feature_switch("enable_page_rl_exploration", false)
        || query.feature_switch("enable_randomized_slate", false);
    if !enabled {
        return None;
    }
    if candidates.iter().any(|c| c.page_decode_slot.is_some()) {
        return None;
    }

    let default_epsilon = query
        .ranking_policy
        .as_ref()
        .and_then(|p| p.exploration_rate)
        .filter(|v| v.is_finite() && *v > 0.0 && *v <= 1.0)
        .unwrap_or(0.05);
    let epsilon =
        space_feed_experiment_number(query, "page_rl_exploration_epsilon", default_epsilon)
            .clamp(1e-6, 1.0);
    let temperature =
        space_feed_experiment_number(query, "page_rl_exploration_temperature", 1.0).max(1e-6);

    let seed_material = format!(
        "{}:{}:{}",
        query.decision_id, query.request_id, query.user_id
    );
    let joint_propensity =
        apply_online_epsilon_plackett_luce_slate(candidates, epsilon, temperature, &seed_material)?;
    Some((epsilon, temperature, joint_propensity))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::Utc;

    use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

    use super::maybe_apply_randomized_slate;

    fn make_candidate(post_id: &str, score: f64) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            author_id: format!("author-{post_id}"),
            content: "serving stage test".to_string(),
            created_at: Utc::now(),
            score: Some(score),
            weighted_score: Some(score),
            pipeline_score: Some(score),
            ..Default::default()
        }
    }

    #[test]
    fn serving_stage_activates_online_randomized_slate_when_enabled() {
        let query = RecommendationQueryPayload {
            request_id: "req-serving-rl".to_string(),
            decision_id: "00000000-0000-4000-8000-000000000001".to_string(),
            user_id: "viewer-rl".to_string(),
            limit: 4,
            feature_switches: HashMap::from([("enable_page_rl_exploration".to_string(), true)]),
            ..Default::default()
        };
        let mut candidates = vec![
            make_candidate("p1", 3.0),
            make_candidate("p2", 2.0),
            make_candidate("p3", 1.0),
        ];

        let meta = maybe_apply_randomized_slate(&query, &mut candidates);
        let (epsilon, temperature, joint) = meta.expect("在线随机页级探索应当成功激活");
        assert!((epsilon - 0.05).abs() < 1e-9);
        assert!((temperature - 1.0).abs() < 1e-9);
        assert!(joint > 0.0 && joint <= 1.0);
        assert!(candidates.iter().all(|c| {
            c.page_rl_exploration_prob
                .is_some_and(|p| p > 0.0 && p <= 1.0)
        }));
    }

    #[test]
    fn serving_stage_skips_randomized_slate_when_page_decode_slot_present() {
        let query = RecommendationQueryPayload {
            request_id: "req-serving-decode".to_string(),
            decision_id: "00000000-0000-4000-8000-000000000002".to_string(),
            user_id: "viewer-rl".to_string(),
            limit: 4,
            feature_switches: HashMap::from([("enable_page_rl_exploration".to_string(), true)]),
            ..Default::default()
        };
        let mut c1 = make_candidate("p1", 3.0);
        c1.page_decode_slot = Some(0);
        let mut candidates = vec![c1, make_candidate("p2", 2.0)];

        assert!(maybe_apply_randomized_slate(&query, &mut candidates).is_none());
        assert!(candidates[0].page_rl_exploration_prob.is_none());
    }
}
