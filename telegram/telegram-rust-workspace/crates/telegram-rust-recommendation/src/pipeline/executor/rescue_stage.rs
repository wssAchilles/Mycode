use std::collections::HashSet;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::related_post_ids;
use crate::serving::stage_payload::build_self_post_rescue_stage;
use telegram_serving_primitives::{
    SELF_POST_RESCUE_APPLIED_DEGRADED_REASON, SELF_POST_RESCUE_FAILED_DEGRADED_REASON,
    SELF_POST_RESCUE_LATENCY_KEY, SELF_POST_RESCUE_PROVIDER_KEY,
};

use super::stage_runner::StageTimer;
use super::telemetry::RunTelemetry;
use super::{RecommendationPipeline, SELF_POST_RESCUE_LOOKBACK_DAYS};

impl RecommendationPipeline {
    pub(super) async fn rescue_empty_selection(
        &self,
        hydrated_query: &RecommendationQueryPayload,
        mut final_candidates: Vec<RecommendationCandidatePayload>,
        telemetry: &mut RunTelemetry,
    ) -> Vec<RecommendationCandidatePayload> {
        if !final_candidates.is_empty() || hydrated_query.in_network_only {
            return final_candidates;
        }

        let rescue_timer = StageTimer::start();
        match self
            .backend_client
            .self_post_rescue_candidates(
                &hydrated_query.user_id,
                hydrated_query.limit,
                SELF_POST_RESCUE_LOOKBACK_DAYS,
                &rescue_exclusion_ids(hydrated_query),
            )
            .await
        {
            Ok(response) => {
                telemetry.record_provider_call(SELF_POST_RESCUE_PROVIDER_KEY);
                telemetry
                    .record_provider_latency(SELF_POST_RESCUE_PROVIDER_KEY, response.latency_ms);
                let safe_candidates = filter_rescue_candidates_for_query(
                    hydrated_query,
                    filter_safe_rescue_candidates(response.payload.candidates),
                );
                let output_count = safe_candidates.len();
                telemetry.add_stage(build_self_post_rescue_stage(
                    rescue_timer.elapsed_ms(),
                    output_count,
                    None,
                    hydrated_query.limit,
                    SELF_POST_RESCUE_LOOKBACK_DAYS,
                ));
                telemetry.record_latency(SELF_POST_RESCUE_LATENCY_KEY, rescue_timer.elapsed_ms());
                if output_count > 0 {
                    final_candidates = safe_candidates;
                    telemetry
                        .degraded_reasons
                        .push(SELF_POST_RESCUE_APPLIED_DEGRADED_REASON.to_string());
                }
            }
            Err(error) => {
                telemetry.add_stage(build_self_post_rescue_stage(
                    rescue_timer.elapsed_ms(),
                    0,
                    Some(&error.to_string()),
                    hydrated_query.limit,
                    SELF_POST_RESCUE_LOOKBACK_DAYS,
                ));
                telemetry.record_latency(SELF_POST_RESCUE_LATENCY_KEY, rescue_timer.elapsed_ms());
                telemetry
                    .degraded_reasons
                    .push(SELF_POST_RESCUE_FAILED_DEGRADED_REASON.to_string());
            }
        }
        final_candidates
    }
}

fn filter_safe_rescue_candidates(
    candidates: Vec<RecommendationCandidatePayload>,
) -> Vec<RecommendationCandidatePayload> {
    candidates
        .into_iter()
        .filter(|candidate| candidate.is_nsfw != Some(true))
        .collect()
}

fn rescue_exclusion_ids(query: &RecommendationQueryPayload) -> Vec<String> {
    let mut ids = query.effective_seen_ids();
    if query.is_bottom_request {
        ids.extend(query.served_ids.iter().cloned());
    }

    let mut seen = HashSet::new();
    ids.into_iter()
        .filter(|id| !id.trim().is_empty())
        .filter(|id| seen.insert(id.clone()))
        .take(400)
        .collect()
}

fn filter_rescue_candidates_for_query(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> Vec<RecommendationCandidatePayload> {
    let seen_ids = query
        .effective_seen_ids()
        .into_iter()
        .collect::<HashSet<_>>();
    let served_ids = if query.is_bottom_request {
        query.served_ids.iter().cloned().collect::<HashSet<_>>()
    } else {
        HashSet::new()
    };

    candidates
        .into_iter()
        .filter(|candidate| {
            !related_post_ids(candidate)
                .into_iter()
                .any(|id| seen_ids.contains(&id) || served_ids.contains(&id))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        filter_rescue_candidates_for_query, filter_safe_rescue_candidates, rescue_exclusion_ids,
    };
    use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
    use serde_json::json;

    fn candidate(post_id: &str, is_nsfw: bool) -> RecommendationCandidatePayload {
        serde_json::from_value(json!({
            "postId": post_id,
            "authorId": "author-1",
            "content": "candidate",
            "createdAt": "2026-08-22T00:00:00Z",
            "isReply": false,
            "isRepost": false,
            "isNsfw": is_nsfw,
        }))
        .expect("candidate fixture should satisfy the payload contract")
    }

    #[test]
    fn rescue_filter_rejects_nsfw_candidates() {
        let kept = filter_safe_rescue_candidates(vec![
            candidate("safe", false),
            candidate("unsafe", true),
        ]);

        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].post_id, "safe");
    }

    #[test]
    fn rescue_exclusions_follow_seen_and_bottom_served_context() {
        let mut query = RecommendationQueryPayload {
            seen_ids: vec!["seen-1".to_string(), "duplicate".to_string()],
            served_ids: vec!["served-1".to_string(), "duplicate".to_string()],
            is_bottom_request: true,
            ..RecommendationQueryPayload::default()
        };

        assert_eq!(
            rescue_exclusion_ids(&query),
            vec![
                "seen-1".to_string(),
                "duplicate".to_string(),
                "served-1".to_string()
            ]
        );

        query.is_bottom_request = false;
        assert_eq!(
            rescue_exclusion_ids(&query),
            vec!["seen-1".to_string(), "duplicate".to_string()]
        );
    }

    #[test]
    fn rescue_filter_rejects_seen_related_post_ids() {
        let query = RecommendationQueryPayload {
            seen_ids: vec!["original".to_string()],
            ..RecommendationQueryPayload::default()
        };
        let candidate: RecommendationCandidatePayload = serde_json::from_value(json!({
            "postId": "repost",
            "authorId": "author-1",
            "content": "candidate",
            "createdAt": "2026-08-22T00:00:00Z",
            "isReply": false,
            "isRepost": true,
            "originalPostId": "original",
        }))
        .expect("candidate fixture should satisfy the payload contract");

        assert!(filter_rescue_candidates_for_query(&query, vec![candidate]).is_empty());
    }
}
