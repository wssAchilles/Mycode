use chrono::TimeZone;
use chrono::Utc;

use crate::contracts::RecommendationCandidatePayload;
use crate::contracts::query::RankingPolicyPayload;

use super::dedup_for_serving;

fn candidate(
    post_id: &str,
    author_id: &str,
    conversation_id: Option<&str>,
) -> RecommendationCandidatePayload {
    RecommendationCandidatePayload {
        post_id: post_id.to_string(),
        model_post_id: None,
        author_id: author_id.to_string(),
        content: "content".to_string(),
        created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
        conversation_id: conversation_id.map(ToOwned::to_owned),
        is_reply: false,
        reply_to_post_id: None,
        is_repost: false,
        original_post_id: None,
        in_network: Some(false),
        recall_source: Some("GraphSource".to_string()),
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
        weighted_score: Some(1.0),
        score: Some(1.0),
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
    }
}

fn candidate_with_content(
    post_id: &str,
    author_id: &str,
    content: &str,
) -> RecommendationCandidatePayload {
    let mut candidate = candidate(post_id, author_id, None);
    candidate.content = content.to_string();
    candidate
}

fn candidate_with_score(
    post_id: &str,
    author_id: &str,
    score: f64,
) -> RecommendationCandidatePayload {
    let mut candidate = candidate(post_id, author_id, None);
    candidate.score = Some(score);
    candidate.weighted_score = Some(score);
    candidate.pipeline_score = Some(score);
    candidate
}

#[test]
fn suppresses_cross_page_duplicates_from_served_state() {
    let query = crate::contracts::RecommendationQueryPayload {
        request_id: "req-1".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 10,
        cursor: None,
        in_network_only: false,
        seen_ids: Vec::new(),
        served_ids: vec!["post-1".to_string()],
        is_bottom_request: true,
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
    };

    let result = dedup_for_serving(
        &query,
        &[
            candidate("post-1", "author-1", None),
            candidate("post-2", "author-2", None),
        ],
        10,
        2,
    );

    assert_eq!(result.candidates.len(), 1);
    assert_eq!(result.cross_page_duplicate_count, 1);
    assert_eq!(
        result
            .suppression_reasons
            .get("served_state_duplicate")
            .copied(),
        Some(1)
    );
    assert_eq!(
        result.page_underfill_reason.as_deref(),
        Some("cross_page_suppressed")
    );
}

#[test]
fn backfills_author_soft_cap_when_page_would_underfill() {
    let query = crate::contracts::RecommendationQueryPayload {
        request_id: "req-2".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 3,
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
    };
    let candidates = vec![
        candidate("post-1", "author-1", None),
        candidate("post-2", "author-1", None),
        candidate("post-3", "author-1", None),
    ];

    let result = dedup_for_serving(&query, &candidates, 3, 2);

    assert_eq!(result.candidates.len(), 3);
    assert_eq!(
        result
            .suppression_reasons
            .get("author_soft_cap")
            .copied()
            .unwrap_or_default(),
        0
    );
    assert!(!result.page_underfilled);
}

#[test]
fn backfills_deferred_candidates_by_priority_and_score() {
    let query = crate::contracts::RecommendationQueryPayload {
        request_id: "req-score-backfill".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 3,
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
    };
    let candidates = vec![
        candidate_with_score("post-1", "author-1", 1.0),
        candidate_with_score("post-2", "author-1", 0.2),
        candidate_with_score("post-3", "author-1", 0.9),
    ];

    let result = dedup_for_serving(&query, &candidates, 3, 1);
    let ids = result
        .candidates
        .iter()
        .map(|candidate| candidate.post_id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(ids, vec!["post-1", "post-3", "post-2"]);
    assert!(!result.page_underfilled);
}

#[test]
fn reports_remaining_candidates_when_page_has_more_after_truncation() {
    let query = crate::contracts::RecommendationQueryPayload {
        request_id: "req-3".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 2,
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
    };
    let candidates = vec![
        candidate("post-1", "author-1", None),
        candidate("post-2", "author-2", None),
        candidate("post-3", "author-3", None),
    ];

    let result = dedup_for_serving(&query, &candidates, 2, 0);

    assert!(result.has_more);
    assert_eq!(result.page_remaining_count, 1);
    assert!(!result.page_underfilled);
    assert_eq!(result.candidates.len(), 2);
}

#[test]
fn soft_suppresses_cross_page_author_context_without_hard_dedup() {
    let query = crate::contracts::RecommendationQueryPayload {
        request_id: "req-4".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 1,
        cursor: None,
        in_network_only: false,
        seen_ids: Vec::new(),
        served_ids: vec!["author:author-1".to_string()],
        is_bottom_request: true,
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
        ranking_policy: Some(RankingPolicyPayload {
            cross_request_author_soft_cap: Some(1),
            ..RankingPolicyPayload::default()
        }),
    };
    let candidates = vec![
        candidate("post-1", "author-1", None),
        candidate("post-2", "author-2", None),
    ];

    let result = dedup_for_serving(&query, &candidates, 1, 2);

    assert_eq!(result.candidates[0].post_id, "post-2");
    assert_eq!(
        result
            .suppression_reasons
            .get("cross_page_author_soft_cap")
            .copied(),
        Some(1)
    );
    assert!(result.has_more);
}

#[test]
fn suppresses_near_duplicate_content_when_alternatives_fill_page() {
    let query = crate::contracts::RecommendationQueryPayload {
        request_id: "req-near-duplicate".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 2,
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
        ranking_policy: Some(RankingPolicyPayload {
            near_duplicate_overlap_threshold: Some(0.8),
            near_duplicate_min_token_count: Some(3),
            ..RankingPolicyPayload::default()
        }),
    };

    let result = dedup_for_serving(
        &query,
        &[
            candidate_with_content(
                "post-1",
                "author-1",
                "rust ranking delivery worker fanout latency",
            ),
            candidate_with_content(
                "post-2",
                "author-2",
                "rust ranking delivery worker fanout latency update",
            ),
            candidate_with_content("post-3", "author-3", "frontend react growth product notes"),
        ],
        2,
        2,
    );

    let ids = result
        .candidates
        .iter()
        .map(|candidate| candidate.post_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["post-1", "post-3"]);
    assert_eq!(
        result
            .suppression_reasons
            .get("near_duplicate_content")
            .copied(),
        Some(1)
    );
    assert!(result.has_more);
}

#[test]
fn backfills_near_duplicate_content_when_page_would_underfill() {
    let query = crate::contracts::RecommendationQueryPayload {
        request_id: "req-near-duplicate-backfill".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 2,
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
        ranking_policy: Some(RankingPolicyPayload {
            near_duplicate_overlap_threshold: Some(0.8),
            near_duplicate_min_token_count: Some(3),
            ..RankingPolicyPayload::default()
        }),
    };

    let result = dedup_for_serving(
        &query,
        &[
            candidate_with_content(
                "post-1",
                "author-1",
                "rust ranking delivery worker fanout latency",
            ),
            candidate_with_content(
                "post-2",
                "author-2",
                "rust ranking delivery worker fanout latency update",
            ),
        ],
        2,
        2,
    );

    assert_eq!(result.candidates.len(), 2);
    assert_eq!(
        result
            .suppression_reasons
            .get("near_duplicate_content")
            .copied()
            .unwrap_or_default(),
        0
    );
    assert!(!result.page_underfilled);
}
