use std::collections::HashMap;

use serde_json::Value;
use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SOURCE, annotate_stage_contract_detail};
use telegram_source_primitives::{
    MOE_DETAIL_FIELD, MOE_RETRIEVAL_SOURCE, annotate_source_stage_detail,
};

use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};

const INTEREST_EMBEDDING_KIND: &str = "interest";
const SOCIAL_EMBEDDING_KIND: &str = "social";
const TEMPORAL_EMBEDDING_KIND: &str = "temporal";

/// Merges candidates from multiple embedding perspectives, deduplicating by
/// `post_id` and keeping the entry with the highest score per post.
pub fn merge_moe_candidates(
    interest: Vec<RecommendationCandidatePayload>,
    social: Vec<RecommendationCandidatePayload>,
    temporal: Vec<RecommendationCandidatePayload>,
) -> Vec<RecommendationCandidatePayload> {
    let mut best_by_post: HashMap<String, RecommendationCandidatePayload> = HashMap::new();

    for candidate in interest
        .into_iter()
        .chain(social.into_iter())
        .chain(temporal.into_iter())
    {
        let score = candidate.primary_score();
        match best_by_post.entry(candidate.post_id.clone()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(candidate);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                if score > entry.get().primary_score() {
                    entry.insert(candidate);
                }
            }
        }
    }

    let mut merged: Vec<RecommendationCandidatePayload> = best_by_post.into_values().collect();
    merged.sort_by(|a, b| {
        b.primary_score()
            .partial_cmp(&a.primary_score())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    merged
}

pub(crate) fn build_moe_retrieval_stage(
    duration_ms: u64,
    output_count: usize,
) -> RecommendationStagePayload {
    let mut detail = HashMap::from([(
        MOE_DETAIL_FIELD.to_string(),
        Value::Bool(output_count > 0),
    )]);
    annotate_stage_contract_detail(
        &mut detail,
        MOE_RETRIEVAL_SOURCE,
        PIPELINE_STAGE_KIND_SOURCE,
    );
    annotate_source_stage_detail(&mut detail, MOE_RETRIEVAL_SOURCE, true, output_count);

    RecommendationStagePayload {
        name: MOE_RETRIEVAL_SOURCE.to_string(),
        enabled: true,
        duration_ms,
        input_count: 1,
        output_count,
        removed_count: None,
        detail: Some(detail),
    }
}

/// Classifies a candidate by its `interest_pool_kind` field to determine
/// which embedding perspective it originated from.
pub fn classify_embedding_kind(candidate: &RecommendationCandidatePayload) -> &'static str {
    match candidate.interest_pool_kind.as_deref() {
        Some(kind) if kind == SOCIAL_EMBEDDING_KIND => SOCIAL_EMBEDDING_KIND,
        Some(kind) if kind == TEMPORAL_EMBEDDING_KIND => TEMPORAL_EMBEDDING_KIND,
        _ => INTEREST_EMBEDDING_KIND,
    }
}

#[cfg(test)]
mod tests {
    use chrono::DateTime;

    use telegram_pipeline_primitives::{
        PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_KIND_SOURCE,
    };
    use telegram_source_primitives::{
        MOE_DETAIL_FIELD, MOE_RETRIEVAL_SOURCE, SOURCE_STAGE_CANDIDATE_COUNT_FIELD,
        SOURCE_STAGE_CONTRACT_VERSION_FIELD, SOURCE_STAGE_SOURCE_NAME_FIELD,
    };

    use super::*;
    use crate::contracts::{MediaType, RecommendationCandidatePayload};

    fn candidate(post_id: &str, score: f64) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: DateTime::parse_from_rfc3339("2026-04-17T00:00:00.000Z")
                .expect("valid fixture timestamp")
                .to_utc(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
            retrieval_lane: None,
            interest_pool_kind: None,
            topic_ids: Vec::new(),
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: MediaType::None,
            video_duration_ms: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            author_blocks_viewer: None,
            language_code: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
            weighted_score: None,
            score: Some(score),
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            is_subscription_only: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
        }
    }

    fn candidate_with_kind(
        post_id: &str,
        score: f64,
        kind: Option<&str>,
    ) -> RecommendationCandidatePayload {
        let mut c = candidate(post_id, score);
        c.interest_pool_kind = kind.map(ToOwned::to_owned);
        c
    }

    #[test]
    fn merge_moe_candidates_deduplicates_by_post_id() {
        let interest = vec![candidate("p1", 0.8), candidate("p2", 0.6)];
        let social = vec![candidate("p2", 0.9), candidate("p3", 0.5)];
        let temporal = vec![candidate("p3", 0.7)];

        let merged = merge_moe_candidates(interest, social, temporal);

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].post_id, "p2");
        assert_eq!(merged[0].score, Some(0.9));
        assert_eq!(merged[1].post_id, "p1");
        assert_eq!(merged[1].score, Some(0.8));
        assert_eq!(merged[2].post_id, "p3");
        assert_eq!(merged[2].score, Some(0.7));
    }

    #[test]
    fn merge_moe_candidates_keeps_highest_score_on_duplicate() {
        let interest = vec![candidate("p1", 0.3)];
        let social = vec![candidate("p1", 0.9)];
        let temporal = vec![candidate("p1", 0.6)];

        let merged = merge_moe_candidates(interest, social, temporal);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].post_id, "p1");
        assert_eq!(merged[0].score, Some(0.9));
    }

    #[test]
    fn merge_moe_candidates_handles_empty_perspectives() {
        let interest = vec![candidate("p1", 0.8)];
        let merged = merge_moe_candidates(interest, Vec::new(), Vec::new());
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].post_id, "p1");
    }

    #[test]
    fn merge_moe_candidates_returns_empty_on_all_empty() {
        let merged = merge_moe_candidates(Vec::new(), Vec::new(), Vec::new());
        assert!(merged.is_empty());
    }

    #[test]
    fn classify_embedding_kind_maps_pool_kind() {
        assert_eq!(
            classify_embedding_kind(&candidate_with_kind("p1", 0.5, Some("interest"))),
            INTEREST_EMBEDDING_KIND
        );
        assert_eq!(
            classify_embedding_kind(&candidate_with_kind("p1", 0.5, Some("social"))),
            SOCIAL_EMBEDDING_KIND
        );
        assert_eq!(
            classify_embedding_kind(&candidate_with_kind("p1", 0.5, Some("temporal"))),
            TEMPORAL_EMBEDDING_KIND
        );
        assert_eq!(
            classify_embedding_kind(&candidate_with_kind("p1", 0.5, None)),
            INTEREST_EMBEDDING_KIND
        );
    }

    #[test]
    fn builds_moe_retrieval_stage_with_source_contract_detail() {
        let stage = build_moe_retrieval_stage(8, 5);
        let detail = stage.detail.as_ref().expect("moe retrieval detail");

        assert_eq!(stage.name, MOE_RETRIEVAL_SOURCE);
        assert_eq!(stage.output_count, 5);
        assert_eq!(
            detail
                .get(MOE_DETAIL_FIELD)
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            detail
                .get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(PIPELINE_STAGE_KIND_SOURCE)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_SOURCE_NAME_FIELD)
                .and_then(serde_json::Value::as_str),
            Some(MOE_RETRIEVAL_SOURCE)
        );
        assert_eq!(
            detail
                .get(SOURCE_STAGE_CANDIDATE_COUNT_FIELD)
                .and_then(serde_json::Value::as_u64),
            Some(5)
        );
        assert!(detail.contains_key(SOURCE_STAGE_CONTRACT_VERSION_FIELD));
    }
}
