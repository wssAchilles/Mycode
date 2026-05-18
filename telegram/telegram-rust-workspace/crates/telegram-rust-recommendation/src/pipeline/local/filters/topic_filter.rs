use std::collections::HashSet;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use telegram_component_primitives::filters::TOPIC_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_MUTED_TOPIC;

use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

pub(super) fn topic_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let muted_topics: HashSet<String> = query
        .user_features
        .as_ref()
        .map(|f| f.muted_topic_ids.iter().cloned().collect())
        .unwrap_or_default();

    if muted_topics.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(TOPIC_FILTER, input_count),
            false,
        );
    }

    let (kept, removed) = partition(candidates, |candidate| {
        // Check topic_ids Vec for overlap with muted topics
        if !candidate.topic_ids.is_empty() {
            let has_muted_topic = candidate
                .topic_ids
                .iter()
                .any(|topic_id| muted_topics.contains(topic_id));
            if has_muted_topic {
                return false;
            }
        }
        // Fallback: check interest_pool_kind (legacy single-topic field)
        let topic = candidate
            .interest_pool_kind
            .as_deref()
            .filter(|v| !v.trim().is_empty());
        match topic {
            Some(topic) => !muted_topics.contains(topic),
            None => true,
        }
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            TOPIC_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_MUTED_TOPIC),
        ),
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use chrono::Utc;

    fn candidate_with_topics(topic_ids: Vec<String>) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "test content".to_string(),
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
            topic_ids,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: crate::contracts::MediaType::None,
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

    fn query_with_muted_topics(muted_topic_ids: Vec<String>) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-topic-filter".to_string(),
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
            user_features: Some(crate::contracts::UserFeaturesPayload {
                muted_topic_ids,
                ..Default::default()
            }),
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
            user_signal_features: None,
            interested_topics: None,
            mutual_follow_ids: None,
            demographics: None,
            feature_switches: HashMap::new(),
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
        }
    }

    #[test]
    fn topic_filter_disables_when_no_muted_topics() {
        let query = query_with_muted_topics(Vec::new());
        let candidates = vec![candidate_with_topics(vec!["topic-1".to_string()])];
        let (kept, _removed, stage, enabled) = topic_filter(&query, candidates);
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(stage.removed_count, Some(0));
    }

    #[test]
    fn topic_filter_drops_candidates_with_muted_topics() {
        let query = query_with_muted_topics(vec!["muted-topic".to_string()]);
        let candidates = vec![
            candidate_with_topics(vec!["muted-topic".to_string()]),
            candidate_with_topics(vec!["safe-topic".to_string()]),
            candidate_with_topics(vec![]),
        ];
        let (kept, removed, _stage, enabled) = topic_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 2);
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].topic_ids, vec!["muted-topic".to_string()]);
    }

    #[test]
    fn topic_filter_drops_when_any_topic_matches() {
        let query = query_with_muted_topics(vec!["muted-a".to_string()]);
        let candidates = vec![candidate_with_topics(vec![
            "safe-topic".to_string(),
            "muted-a".to_string(),
        ])];
        let (kept, removed, _stage, enabled) = topic_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 0);
        assert_eq!(removed.len(), 1);
    }

    #[test]
    fn topic_filter_falls_back_to_interest_pool_kind() {
        let query = query_with_muted_topics(vec!["muted-pool".to_string()]);
        let mut candidate = candidate_with_topics(Vec::new());
        candidate.interest_pool_kind = Some("muted-pool".to_string());
        let (kept, removed, _stage, enabled) = topic_filter(&query, vec![candidate]);
        assert!(enabled);
        assert_eq!(kept.len(), 0);
        assert_eq!(removed.len(), 1);
    }
}
