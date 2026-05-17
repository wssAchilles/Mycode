use chrono::Utc;

use crate::contracts::{
    CandidateNewsMetadataPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
    UserFeaturesPayload, UserStateContextPayload,
};
use serde_json::json;
use telegram_filter_primitives::{
    FILTER_DECISION_MUTATION_FIELD, FILTER_DROP_REASON_BLOCKED_AUTHOR,
    FILTER_DROP_REASON_CONVERSATION_DUPLICATE, FILTER_DROP_REASON_COUNTS_FIELD,
    FILTER_DROP_REASON_DUPLICATE_POST, FILTER_DROP_REASON_MUTED_KEYWORD,
    FILTER_DROP_REASON_PREVIOUSLY_SERVED, FILTER_DROP_REASON_SEEN_POST,
    FILTER_DROP_REASON_VISIBILITY_UNSAFE, FILTER_MUTATES_SCORE_FIELD,
    filter_stage_detail_contract_violations,
};
use telegram_pipeline_primitives::{
    PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD,
    PIPELINE_STAGE_KIND_FILTER, stage_detail_contract_violations,
};
use telegram_source_primitives::GRAPH_KERNEL_SOURCE;

use super::{run_post_selection_filters, run_pre_score_filters};

fn query() -> RecommendationQueryPayload {
    RecommendationQueryPayload {
        request_id: "req-local-filters".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 20,
        cursor: None,
        in_network_only: false,
        seen_ids: vec!["seen-post".to_string()],
        served_ids: vec!["served-post".to_string()],
        is_bottom_request: true,
        client_app_id: None,
        country_code: None,
        language_code: None,
        user_features: Some(UserFeaturesPayload {
            followed_user_ids: vec!["author-a".to_string()],
            blocked_user_ids: vec!["blocked-author".to_string()],
            muted_user_ids: Vec::new(),
            muted_keywords: vec!["spoiler".to_string()],
                muted_topic_ids: Vec::new(),
                video_preference: "allow".to_string(),
                is_subscriber: false,
            seen_post_ids: Vec::new(),
            follower_count: None,
            account_created_at: None,
        }),
        embedding_context: None,
        user_state_context: Some(UserStateContextPayload {
            state: "warm".to_string(),
            reason: "test".to_string(),
            followed_count: 1,
            recent_action_count: 2,
            recent_positive_action_count: 1,
            usable_embedding: true,
            account_age_days: Some(10),
        }),
        user_action_sequence: None,
        news_history_external_ids: None,
        model_user_action_sequence: None,
        experiment_context: None,
        ranking_policy: None,
            user_signal_features: None,
        interested_topics: None,
    }
}

fn candidate(post_id: &str, author_id: &str) -> RecommendationCandidatePayload {
    RecommendationCandidatePayload {
        post_id: post_id.to_string(),
        model_post_id: Some(post_id.to_string()),
        author_id: author_id.to_string(),
        content: "clean content".to_string(),
        created_at: Utc::now(),
        conversation_id: None,
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
        weighted_score: Some(1.0),
        score: Some(1.0),
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
    }
}

fn assert_filter_drop_detail(
    result: &super::LocalFilterExecution,
    stage_name: &str,
    drop_reason: &str,
    expected_count: usize,
) {
    let stage = result
        .stages
        .iter()
        .find(|stage| stage.name == stage_name)
        .unwrap_or_else(|| panic!("{stage_name} stage"));
    let detail = stage.detail.as_ref().expect("filter detail");

    assert_eq!(
        detail.get(PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD),
        Some(&json!(stage_name))
    );
    assert_eq!(
        detail.get(PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD),
        Some(&json!(PIPELINE_STAGE_KIND_FILTER))
    );
    assert!(
        stage_detail_contract_violations(stage_name, PIPELINE_STAGE_KIND_FILTER, Some(detail))
            .is_empty()
    );
    assert_eq!(
        detail.get(FILTER_DECISION_MUTATION_FIELD),
        Some(&json!("drop_only"))
    );
    assert_eq!(detail.get(FILTER_MUTATES_SCORE_FIELD), Some(&json!(false)));
    assert!(filter_stage_detail_contract_violations(expected_count, Some(detail)).is_empty());
    assert_eq!(
        detail.get(FILTER_DROP_REASON_COUNTS_FIELD),
        Some(&json!({ drop_reason: expected_count }))
    );
}

fn assert_score_fields_match(
    actual: &RecommendationCandidatePayload,
    expected: &RecommendationCandidatePayload,
) {
    assert_eq!(actual.score, expected.score);
    assert_eq!(actual.weighted_score, expected.weighted_score);
    assert_eq!(actual.pipeline_score, expected.pipeline_score);
    assert_eq!(
        serde_json::to_value(actual.phoenix_scores.as_ref())
            .expect("serialize actual phoenix scores"),
        serde_json::to_value(expected.phoenix_scores.as_ref())
            .expect("serialize expected phoenix scores")
    );
    assert_eq!(
        serde_json::to_value(actual.action_scores.as_ref())
            .expect("serialize actual action scores"),
        serde_json::to_value(expected.action_scores.as_ref())
            .expect("serialize expected action scores")
    );
    assert_eq!(
        serde_json::to_value(actual.ranking_signals.as_ref())
            .expect("serialize actual ranking signals"),
        serde_json::to_value(expected.ranking_signals.as_ref())
            .expect("serialize expected ranking signals")
    );
    assert_eq!(
        actual.score_contract_version,
        expected.score_contract_version
    );
    assert_eq!(
        actual.score_breakdown_version,
        expected.score_breakdown_version
    );
}

#[test]
fn local_pre_score_filters_drop_seen_muted_blocked_and_served_candidates() {
    let mut blocked = candidate("blocked", "blocked-author");
    blocked.content = "clean".to_string();
    let mut muted = candidate("muted", "author-b");
    muted.content = "contains spoiler".to_string();
    let mut seen = candidate("seen-post", "author-c");
    seen.recall_source = Some("UnknownSource".to_string());
    let served = candidate("served-post", "author-d");

    let result = run_pre_score_filters(&query(), vec![blocked, muted, seen, served]);
    assert!(result.candidates.is_empty());
    assert_eq!(result.drop_counts.get("AuthorSocialgraphFilter"), Some(&1));
    assert_eq!(result.drop_counts.get("MutedKeywordFilter"), Some(&1));
    assert_eq!(result.drop_counts.get("SeenPostFilter"), Some(&1));
    assert_eq!(result.drop_counts.get("PreviouslyServedFilter"), Some(&1));

    assert_filter_drop_detail(
        &result,
        "AuthorSocialgraphFilter",
        FILTER_DROP_REASON_BLOCKED_AUTHOR,
        1,
    );
    assert_filter_drop_detail(
        &result,
        "MutedKeywordFilter",
        FILTER_DROP_REASON_MUTED_KEYWORD,
        1,
    );
    assert_filter_drop_detail(&result, "SeenPostFilter", FILTER_DROP_REASON_SEEN_POST, 1);
    assert_filter_drop_detail(
        &result,
        "PreviouslyServedFilter",
        FILTER_DROP_REASON_PREVIOUSLY_SERVED,
        1,
    );
}

#[test]
fn duplicate_filter_reports_drop_reason_without_score_mutation() {
    let result = run_pre_score_filters(
        &query(),
        vec![
            candidate("duplicate-post", "author-a"),
            candidate("duplicate-post", "author-b"),
        ],
    );

    assert_eq!(result.candidates.len(), 1);
    assert_filter_drop_detail(
        &result,
        "DuplicateFilter",
        FILTER_DROP_REASON_DUPLICATE_POST,
        1,
    );
}

#[test]
fn post_selection_filters_keep_best_conversation_and_safe_candidates() {
    let mut first = candidate("post-1", "author-a");
    first.conversation_id = Some("conv-1".to_string());
    first.score = Some(1.0);
    first.weighted_score = Some(0.8);
    first.pipeline_score = Some(1.0);
    first.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
        safe: true,
        ..Default::default()
    });

    let mut second = candidate("post-2", "author-b");
    second.conversation_id = Some("conv-1".to_string());
    second.score = Some(2.0);
    second.weighted_score = Some(1.8);
    second.pipeline_score = Some(2.0);
    second.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
        safe: true,
        ..Default::default()
    });

    let mut unsafe_candidate = candidate("post-3", "author-c");
    unsafe_candidate.score = Some(3.0);
    unsafe_candidate.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
        safe: false,
        ..Default::default()
    });

    let mut news = candidate("post-4", "author-d");
    news.score = Some(0.7);
    news.weighted_score = Some(0.6);
    news.pipeline_score = Some(0.7);
    news.is_news = Some(true);
    news.news_metadata = Some(CandidateNewsMetadataPayload {
        external_id: Some("news-1".to_string()),
        ..CandidateNewsMetadataPayload::default()
    });
    news.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
        safe: true,
        ..Default::default()
    });

    let expected_second = second.clone();
    let expected_news = news.clone();
    let result = run_post_selection_filters(&query(), vec![first, second, unsafe_candidate, news]);
    assert_eq!(result.candidates.len(), 2);
    assert!(
        result
            .candidates
            .iter()
            .any(|candidate| candidate.post_id == "post-2")
    );
    assert!(
        result
            .candidates
            .iter()
            .any(|candidate| candidate.post_id == "post-4")
    );
    assert_score_fields_match(
        result
            .candidates
            .iter()
            .find(|candidate| candidate.post_id == "post-2")
            .expect("best conversation candidate"),
        &expected_second,
    );
    assert_score_fields_match(
        result
            .candidates
            .iter()
            .find(|candidate| candidate.post_id == "post-4")
            .expect("news candidate"),
        &expected_news,
    );
    assert_filter_drop_detail(&result, "VFFilter", FILTER_DROP_REASON_VISIBILITY_UNSAFE, 1);
    assert_filter_drop_detail(
        &result,
        "ConversationDedupFilter",
        FILTER_DROP_REASON_CONVERSATION_DUPLICATE,
        1,
    );
}

#[test]
fn seen_filter_tops_up_underfilled_selection_with_trusted_recall() {
    let mut query = query();
    query.limit = 4;
    query.seen_ids = vec![
        "post-trusted-1".to_string(),
        "post-trusted-2".to_string(),
        "post-trusted-3".to_string(),
        "post-untrusted".to_string(),
    ];

    let unseen = candidate("post-unseen", "author-a");

    let mut trusted_seen_1 = candidate("post-trusted-1", "author-b");
    trusted_seen_1.recall_source = Some(GRAPH_KERNEL_SOURCE.to_string());

    let mut trusted_seen_2 = candidate("post-trusted-2", "author-c");
    trusted_seen_2.recall_source = Some("GraphSource".to_string());

    let mut trusted_seen_3 = candidate("post-trusted-3", "author-d");
    trusted_seen_3.recall_source = Some("NewsAnnSource".to_string());

    let mut untrusted_seen = candidate("post-untrusted", "author-e");
    untrusted_seen.recall_source = Some("UnknownSource".to_string());

    let result = run_pre_score_filters(
        &query,
        vec![
            unseen,
            trusted_seen_1,
            trusted_seen_2,
            trusted_seen_3,
            untrusted_seen,
        ],
    );

    assert_eq!(result.candidates.len(), 4);
    assert!(
        result
            .candidates
            .iter()
            .any(|candidate| candidate.post_id == "post-unseen")
    );
    assert!(
        result
            .candidates
            .iter()
            .all(|candidate| candidate.post_id != "post-untrusted")
    );

    let seen_stage = result
        .stages
        .iter()
        .find(|stage| stage.name == "SeenPostFilter")
        .expect("SeenPostFilter stage");
    let detail = seen_stage.detail.as_ref().expect("SeenPostFilter detail");
    assert_eq!(
        detail.get("trustedUnderfillFallbackUsed"),
        Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(
        detail.get("trustedUnderfillFallbackCount"),
        Some(&serde_json::Value::from(3_u64))
    );
}

#[test]
fn vf_filter_tops_up_underfilled_selection_with_trusted_recall() {
    let mut query = query();
    query.limit = 4;

    let mut safe = candidate("post-safe", "author-a");
    safe.recall_source = Some(GRAPH_KERNEL_SOURCE.to_string());
    safe.conversation_id = Some("conv-safe".to_string());
    safe.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
        safe: true,
        ..Default::default()
    });

    let mut trusted_missing_vf_1 = candidate("post-trusted-1", "author-b");
    trusted_missing_vf_1.recall_source = Some(GRAPH_KERNEL_SOURCE.to_string());
    trusted_missing_vf_1.conversation_id = Some("conv-trusted-1".to_string());

    let mut trusted_missing_vf_2 = candidate("post-trusted-2", "author-c");
    trusted_missing_vf_2.recall_source = Some("GraphSource".to_string());
    trusted_missing_vf_2.conversation_id = Some("conv-trusted-2".to_string());

    let mut trusted_missing_vf_3 = candidate("post-trusted-3", "author-d");
    trusted_missing_vf_3.recall_source = Some("PopularSource".to_string());
    trusted_missing_vf_3.conversation_id = Some("conv-trusted-3".to_string());

    let mut unsafe_candidate = candidate("post-unsafe", "author-e");
    unsafe_candidate.recall_source = Some(GRAPH_KERNEL_SOURCE.to_string());
    unsafe_candidate.conversation_id = Some("conv-unsafe".to_string());
    unsafe_candidate.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
        safe: false,
        ..Default::default()
    });

    let result = run_post_selection_filters(
        &query,
        vec![
            safe,
            trusted_missing_vf_1,
            trusted_missing_vf_2,
            trusted_missing_vf_3,
            unsafe_candidate,
        ],
    );

    assert_eq!(result.candidates.len(), 4);
    assert!(
        result
            .candidates
            .iter()
            .any(|candidate| candidate.post_id == "post-safe")
    );
    assert!(
        result
            .candidates
            .iter()
            .all(|candidate| candidate.post_id != "post-unsafe")
    );

    let vf_stage = result
        .stages
        .iter()
        .find(|stage| stage.name == "VFFilter")
        .expect("VFFilter stage");
    let detail = vf_stage.detail.as_ref().expect("VFFilter detail");
    assert_eq!(
        detail.get("trustedUnderfillFallbackUsed"),
        Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(
        detail.get("trustedUnderfillFallbackCount"),
        Some(&serde_json::Value::from(3_u64))
    );
}

#[test]
fn quality_guard_drops_empty_non_media_candidates() {
    let mut empty = candidate("empty", "author-empty");
    empty.content = " ".to_string();
    empty.has_image = Some(false);
    empty.has_video = Some(false);

    let mut news = candidate("news", "author-news");
    news.content = " ".to_string();
    news.is_news = Some(true);
    news.news_metadata = Some(CandidateNewsMetadataPayload {
        title: Some("A valid news title".to_string()),
        ..CandidateNewsMetadataPayload::default()
    });

    let result = run_pre_score_filters(&query(), vec![empty, news]);
    assert_eq!(result.candidates.len(), 1);
    assert_eq!(result.candidates[0].post_id, "news");

    let stage = result
        .stages
        .iter()
        .find(|stage| stage.name == "QualityGuardFilter")
        .expect("QualityGuardFilter stage");
    assert_eq!(stage.removed_count, Some(1));
}
