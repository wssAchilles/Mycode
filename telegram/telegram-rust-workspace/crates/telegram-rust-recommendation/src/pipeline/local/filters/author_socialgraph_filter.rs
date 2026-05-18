use std::collections::HashSet;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use telegram_component_primitives::filters::AUTHOR_SOCIALGRAPH_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_BLOCKED_AUTHOR;

use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

pub(super) fn author_socialgraph_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let features = query.user_features.as_ref();

    let blocked: HashSet<String> = features
        .map(|f| f.blocked_user_ids.iter().cloned().collect())
        .unwrap_or_default();
    let muted: HashSet<String> = features
        .map(|f| f.muted_user_ids.iter().cloned().collect())
        .unwrap_or_default();

    let has_author_blocks_viewer = candidates
        .iter()
        .any(|c| c.author_blocks_viewer.unwrap_or(false));

    if blocked.is_empty() && muted.is_empty() && !has_author_blocks_viewer {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(AUTHOR_SOCIALGRAPH_FILTER, input_count),
            false,
        );
    }

    let (kept, removed) = partition(candidates, |candidate| {
        // Condition 1: Viewer muted the author
        if muted.contains(&candidate.author_id) {
            return false;
        }
        // Condition 2: Viewer blocked the author
        if blocked.contains(&candidate.author_id) {
            return false;
        }
        // Condition 3: Author blocks the viewer (bidirectional block)
        if candidate.author_blocks_viewer.unwrap_or(false) {
            return false;
        }
        true
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            AUTHOR_SOCIALGRAPH_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_BLOCKED_AUTHOR),
        ),
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use chrono::Utc;

    fn candidate(
        author_id: &str,
        author_blocks_viewer: Option<bool>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
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
            topic_ids: Vec::new(),
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
            author_blocks_viewer,
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

    fn query(
        blocked_user_ids: Vec<String>,
        muted_user_ids: Vec<String>,
    ) -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-socialgraph-filter".to_string(),
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
                blocked_user_ids,
                muted_user_ids,
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
    fn socialgraph_filter_disables_when_no_blocked_or_muted() {
        let query = query(Vec::new(), Vec::new());
        let candidates = vec![candidate("author-1", None)];
        let (kept, _removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(!enabled);
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn socialgraph_filter_drops_blocked_authors() {
        let query = query(vec!["blocked-author".to_string()], Vec::new());
        let candidates = vec![
            candidate("blocked-author", None),
            candidate("safe-author", None),
        ];
        let (kept, removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].author_id, "blocked-author");
    }

    #[test]
    fn socialgraph_filter_drops_muted_authors() {
        let query = query(Vec::new(), vec!["muted-author".to_string()]);
        let candidates = vec![
            candidate("muted-author", None),
            candidate("safe-author", None),
        ];
        let (kept, removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].author_id, "muted-author");
    }

    #[test]
    fn socialgraph_filter_drops_when_author_blocks_viewer() {
        let query = query(Vec::new(), Vec::new());
        let candidates = vec![
            candidate("blocking-author", Some(true)),
            candidate("safe-author", None),
        ];
        let (kept, removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 1);
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].author_id, "blocking-author");
    }

    #[test]
    fn socialgraph_filter_bidirectional_block() {
        let query = query(vec!["mutual-block".to_string()], Vec::new());
        let candidates = vec![candidate("mutual-block", Some(true))];
        let (kept, removed, _stage, enabled) = author_socialgraph_filter(&query, candidates);
        assert!(enabled);
        assert_eq!(kept.len(), 0);
        assert_eq!(removed.len(), 1);
    }
}
