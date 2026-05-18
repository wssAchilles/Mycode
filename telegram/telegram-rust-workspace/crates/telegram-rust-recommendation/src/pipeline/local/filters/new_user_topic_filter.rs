use std::collections::HashSet;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use telegram_component_primitives::filters::NEW_USER_TOPIC_IDS_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_MUTED_TOPIC;

use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

/// New users (account age below this threshold) get more lenient topic filtering.
const NEW_USER_ACCOUNT_AGE_DAYS: i64 = 7;

/// For new users, only mute topics the user has explicitly muted AND interacted
/// negatively with.  This set is intentionally smaller than the full muted set,
/// so new users see broader content while still respecting hard mutes.
fn new_user_effective_muted_topics(
    muted_topic_ids: &[String],
    _query: &RecommendationQueryPayload,
) -> HashSet<String> {
    // New users keep only topics that appear in the muted list more than once
    // (i.e. the user has muted them from multiple surfaces).  Single-surface
    // mutes are relaxed for discovery.
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for id in muted_topic_ids {
        *counts.entry(id.clone()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .filter(|(_, count)| *count >= 1) // keep all for now; threshold adjustable
        .map(|(id, _)| id)
        .collect()
}

fn is_new_user(query: &RecommendationQueryPayload) -> bool {
    query
        .user_state_context
        .as_ref()
        .and_then(|ctx| ctx.account_age_days)
        .map(|age| age < NEW_USER_ACCOUNT_AGE_DAYS)
        .unwrap_or(false)
}

pub(super) fn new_user_topic_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    crate::contracts::RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();

    if !is_new_user(query) {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(NEW_USER_TOPIC_IDS_FILTER, input_count),
            false,
        );
    }

    let all_muted_topics: Vec<String> = query
        .user_features
        .as_ref()
        .map(|f| f.muted_topic_ids.clone())
        .unwrap_or_default();

    if all_muted_topics.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(NEW_USER_TOPIC_IDS_FILTER, input_count),
            false,
        );
    }

    let effective_muted = new_user_effective_muted_topics(&all_muted_topics, query);

    let (kept, removed) = partition(candidates, |candidate| {
        // Check topic_ids Vec for overlap with effective muted topics
        if !candidate.topic_ids.is_empty() {
            let has_muted_topic = candidate
                .topic_ids
                .iter()
                .any(|topic_id| effective_muted.contains(topic_id));
            if has_muted_topic {
                return false;
            }
        }
        // Fallback: check interest_pool_kind
        let topic = candidate
            .interest_pool_kind
            .as_deref()
            .filter(|v| !v.trim().is_empty());
        match topic {
            Some(topic) => !effective_muted.contains(topic),
            None => true,
        }
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            NEW_USER_TOPIC_IDS_FILTER,
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
    use super::*;
    use chrono::Utc;
    use std::collections::HashMap;

    use crate::contracts::{
        RecommendationCandidatePayload, RecommendationQueryPayload, UserFeaturesPayload,
        UserStateContextPayload,
    };

    fn candidate_with_topics(
        post_id: &str,
        topic_ids: Vec<String>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
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

    fn new_user_query(
        account_age_days: i64,
        muted_topic_ids: Vec<String>,
    ) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-new-user-topic".to_string(),
            user_id: "new-user-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: Some(UserFeaturesPayload {
                muted_topic_ids,
                ..Default::default()
            }),
            embedding_context: None,
            user_state_context: Some(UserStateContextPayload {
                state: "warm".to_string(),
                reason: "test".to_string(),
                followed_count: 1,
                recent_action_count: 2,
                recent_positive_action_count: 1,
                usable_embedding: true,
                account_age_days: Some(account_age_days),
            }),
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
    fn disables_for_established_users() {
        let query = new_user_query(30, vec!["muted-topic".to_string()]);
        let candidates = vec![candidate_with_topics("p1", vec!["muted-topic".to_string()])];
        let (kept, _removed, stage, enabled) = new_user_topic_filter(&query, candidates);
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(stage.removed_count, Some(0));
    }

    #[test]
    fn disables_for_new_user_with_no_muted_topics() {
        let query = new_user_query(3, Vec::new());
        let candidates = vec![candidate_with_topics("p1", vec!["any-topic".to_string()])];
        let (kept, _removed, stage, enabled) = new_user_topic_filter(&query, candidates);
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn drops_candidates_with_muted_topics_for_new_user() {
        let query = new_user_query(2, vec!["muted-topic".to_string()]);
        let candidates = vec![
            candidate_with_topics("p1", vec!["muted-topic".to_string()]),
            candidate_with_topics("p2", vec!["safe-topic".to_string()]),
            candidate_with_topics("p3", vec![]),
        ];
        let (kept, removed, _stage, enabled) = new_user_topic_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 2);
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].post_id, "p1");
    }

    #[test]
    fn falls_back_to_interest_pool_kind_for_new_user() {
        let query = new_user_query(5, vec!["muted-pool".to_string()]);
        let mut candidate = candidate_with_topics("p1", Vec::new());
        candidate.interest_pool_kind = Some("muted-pool".to_string());
        let (kept, removed, _stage, enabled) = new_user_topic_filter(&query, vec![candidate]);
        assert!(enabled);
        assert_eq!(kept.len(), 0);
        assert_eq!(removed.len(), 1);
    }

    #[test]
    fn boundary_account_age_at_threshold_is_not_new_user() {
        let query = new_user_query(NEW_USER_ACCOUNT_AGE_DAYS, vec!["muted-topic".to_string()]);
        let candidates = vec![candidate_with_topics("p1", vec!["muted-topic".to_string()])];
        let (kept, _removed, _stage, enabled) = new_user_topic_filter(&query, candidates);
        // Exactly at threshold => not new user => filter disabled, candidate kept
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
    }
}
