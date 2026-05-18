use std::collections::HashSet;

use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SOURCE, annotate_stage_contract_detail};
use telegram_source_primitives::{TWO_TOWER_SOURCE, annotate_source_stage_detail};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload,
    RecommendationStagePayload,
};

const TWO_TOWER_SOURCE_NAME: &str = TWO_TOWER_SOURCE;

/// Filters TwoTowerSource candidates by the user's interested topics.
///
/// When `interested_topics` is present on the query, only candidates whose
/// `topic_ids` intersect with the interested set are retained. Candidates
/// without any `topic_ids` are kept (they are unclassified, not disqualified).
pub fn filter_candidates_by_topics(
    candidates: Vec<RecommendationCandidatePayload>,
    query: &RecommendationQueryPayload,
) -> Vec<RecommendationCandidatePayload> {
    let Some(interested_topics) = query.interested_topics.as_ref() else {
        return candidates;
    };
    if interested_topics.is_empty() {
        return candidates;
    }

    let topic_set: HashSet<&str> = interested_topics.iter().map(String::as_str).collect();

    candidates
        .into_iter()
        .filter(|candidate| {
            if candidate.topic_ids.is_empty() {
                return true;
            }
            candidate
                .topic_ids
                .iter()
                .any(|topic| topic_set.contains(topic.as_str()))
        })
        .collect()
}

pub fn build_two_tower_stage(
    duration_ms: u64,
    input_count: usize,
    output_count: usize,
) -> RecommendationStagePayload {
    let mut detail = std::collections::HashMap::new();
    annotate_stage_contract_detail(
        &mut detail,
        TWO_TOWER_SOURCE_NAME,
        PIPELINE_STAGE_KIND_SOURCE,
    );
    annotate_source_stage_detail(&mut detail, TWO_TOWER_SOURCE_NAME, true, output_count);

    RecommendationStagePayload {
        name: TWO_TOWER_SOURCE_NAME.to_string(),
        enabled: true,
        duration_ms,
        input_count,
        output_count,
        removed_count: Some(input_count.saturating_sub(output_count)),
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use chrono::DateTime;

    use crate::contracts::MediaType;

    use super::*;
    use crate::contracts::RecommendationCandidatePayload;

    fn candidate(post_id: &str, topic_ids: Vec<&str>) -> RecommendationCandidatePayload {
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
            topic_ids: topic_ids.into_iter().map(ToOwned::to_owned).collect(),
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
            score: None,
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

    fn query_with_topics(topics: Option<Vec<&str>>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-two-tower".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
            user_signal_features: None,
            interested_topics: topics.map(|v| v.into_iter().map(ToOwned::to_owned).collect()),
            mutual_follow_ids: None,
            demographics: None,
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
            feature_switches: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn returns_all_candidates_when_no_interested_topics() {
        let candidates = vec![
            candidate("p1", vec!["tech"]),
            candidate("p2", vec!["sports"]),
        ];
        let query = query_with_topics(None);
        let filtered = filter_candidates_by_topics(candidates, &query);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn returns_all_candidates_when_interested_topics_is_empty() {
        let candidates = vec![
            candidate("p1", vec!["tech"]),
            candidate("p2", vec!["sports"]),
        ];
        let query = query_with_topics(Some(vec![]));
        let filtered = filter_candidates_by_topics(candidates, &query);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn filters_candidates_by_matching_topics() {
        let candidates = vec![
            candidate("p1", vec!["tech", "ai"]),
            candidate("p2", vec!["sports"]),
            candidate("p3", vec!["tech"]),
        ];
        let query = query_with_topics(Some(vec!["tech"]));
        let filtered = filter_candidates_by_topics(candidates, &query);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].post_id, "p1");
        assert_eq!(filtered[1].post_id, "p3");
    }

    #[test]
    fn keeps_candidates_without_topic_ids() {
        let candidates = vec![
            candidate("p1", vec!["tech"]),
            candidate("p2", vec![]),
            candidate("p3", vec!["sports"]),
        ];
        let query = query_with_topics(Some(vec!["tech"]));
        let filtered = filter_candidates_by_topics(candidates, &query);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].post_id, "p1");
        assert_eq!(filtered[1].post_id, "p2");
    }

    #[test]
    fn matches_multiple_interested_topics() {
        let candidates = vec![
            candidate("p1", vec!["tech"]),
            candidate("p2", vec!["sports"]),
            candidate("p3", vec!["music"]),
        ];
        let query = query_with_topics(Some(vec!["tech", "music"]));
        let filtered = filter_candidates_by_topics(candidates, &query);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].post_id, "p1");
        assert_eq!(filtered[1].post_id, "p3");
    }

    #[test]
    fn builds_two_tower_stage_with_contract_detail() {
        let stage = build_two_tower_stage(12, 10, 7);
        assert_eq!(stage.name, TWO_TOWER_SOURCE_NAME);
        assert_eq!(stage.input_count, 10);
        assert_eq!(stage.output_count, 7);
        assert_eq!(stage.removed_count, Some(3));
        assert!(stage.enabled);
    }
}
