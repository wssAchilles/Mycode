use telegram_component_primitives::selectors::RUST_TOP_K_SELECTOR;

use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};

use super::{SelectorSelectionReport, build_selector_stage_detail};

pub(crate) struct SelectorStageInput<'a> {
    pub(crate) duration_ms: u64,
    pub(crate) input_count: usize,
    pub(crate) selected: &'a [RecommendationCandidatePayload],
    pub(crate) report: &'a SelectorSelectionReport,
    pub(crate) oversample_factor: usize,
    pub(crate) max_selector_size: usize,
    pub(crate) author_soft_cap: usize,
}

pub(crate) fn build_selector_stage(input: SelectorStageInput<'_>) -> RecommendationStagePayload {
    let detail = build_selector_stage_detail(
        input.report,
        input.selected,
        input.oversample_factor,
        input.max_selector_size,
        input.author_soft_cap,
    );

    RecommendationStagePayload {
        name: RUST_TOP_K_SELECTOR.to_string(),
        enabled: true,
        duration_ms: input.duration_ms,
        input_count: input.input_count,
        output_count: input.selected.len(),
        removed_count: Some(input.input_count.saturating_sub(input.selected.len())),
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::Utc;
    use telegram_component_primitives::selectors::RUST_TOP_K_SELECTOR;
    use telegram_selector_primitives::{
        SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD, SELECTOR_SCORE_INPUT_FINAL_SCORE,
        selector_detail_contract_violations,
    };

    use crate::contracts::RecommendationCandidatePayload;

    use super::super::SelectorSelectionReport;
    use super::{SelectorStageInput, build_selector_stage};

    #[test]
    fn builds_selector_stage_with_final_score_contract_detail() {
        let selected = vec![RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "content".to_string(),
            created_at: Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
            retrieval_lane: None,
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
            weighted_score: None,
            score: Some(0.8),
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }];
        let report = SelectorSelectionReport {
            selection_mode: "policy_state_machine".to_string(),
            target_size: 3,
            window_size: 1,
            selected_count: 1,
            required_phase_names: vec!["required_final_score"],
            relaxed_phase_names: vec!["relaxed_backfill"],
            first_blocking_reason: None,
            deferred_reason_counts: HashMap::new(),
            policy_snapshot: None,
        };

        let stage = build_selector_stage(SelectorStageInput {
            duration_ms: 4,
            input_count: 5,
            selected: &selected,
            report: &report,
            oversample_factor: 3,
            max_selector_size: 100,
            author_soft_cap: 2,
        });

        assert_eq!(stage.name, RUST_TOP_K_SELECTOR);
        assert_eq!(stage.output_count, 1);
        assert_eq!(stage.removed_count, Some(4));
        let detail = stage.detail.as_ref().expect("selector detail");
        assert_eq!(
            detail
                .get(SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD)
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert!(selector_detail_contract_violations(Some(detail)).is_empty());
        assert!(
            detail
                .values()
                .any(|value| value.as_str() == Some(SELECTOR_SCORE_INPUT_FINAL_SCORE))
        );
    }
}
