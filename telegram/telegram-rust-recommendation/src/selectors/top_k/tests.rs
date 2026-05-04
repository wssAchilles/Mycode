use std::collections::HashMap;

use chrono::{TimeZone, Utc};

use crate::contracts::query::RankingPolicyPayload;
use crate::contracts::{
    CandidateNewsMetadataPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
    UserStateContextPayload,
};

use super::{select_candidates, select_candidates_with_report};

fn query(state: &str, limit: usize) -> RecommendationQueryPayload {
    RecommendationQueryPayload {
        request_id: "selector-query".to_string(),
        user_id: "viewer-1".to_string(),
        limit,
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
        user_state_context: Some(UserStateContextPayload {
            state: state.to_string(),
            reason: "test".to_string(),
            followed_count: 10,
            recent_action_count: 20,
            recent_positive_action_count: 8,
            usable_embedding: true,
            account_age_days: Some(30),
        }),
        user_action_sequence: None,
        news_history_external_ids: None,
        model_user_action_sequence: None,
        experiment_context: None,
        ranking_policy: None,
    }
}

fn candidate(
    post_id: &str,
    author_id: &str,
    lane: &str,
    in_network: bool,
    score: f64,
) -> RecommendationCandidatePayload {
    RecommendationCandidatePayload {
        post_id: post_id.to_string(),
        model_post_id: Some(post_id.to_string()),
        author_id: author_id.to_string(),
        content: "candidate".to_string(),
        created_at: Utc.with_ymd_and_hms(2026, 4, 23, 0, 0, 0).unwrap(),
        conversation_id: None,
        is_reply: false,
        reply_to_post_id: None,
        is_repost: false,
        original_post_id: None,
        in_network: Some(in_network),
        recall_source: Some(
            match lane {
                "in_network" => "FollowingSource",
                "social_expansion" => "GraphSource",
                "interest" => "TwoTowerSource",
                _ => "PopularSource",
            }
            .to_string(),
        ),
        retrieval_lane: Some(lane.to_string()),
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
        weighted_score: Some(score),
        score: Some(score),
        is_liked_by_user: None,
        is_reposted_by_user: None,
        is_nsfw: None,
        vf_result: None,
        is_news: None,
        news_metadata: None,
        is_pinned: None,
        score_breakdown: None,
        pipeline_score: Some(score),
        graph_score: None,
        graph_path: None,
        graph_recall_type: None,
    }
}

fn candidate_with_cluster(
    post_id: &str,
    author_id: &str,
    lane: &str,
    in_network: bool,
    score: f64,
    cluster_id: i64,
) -> RecommendationCandidatePayload {
    let mut candidate = candidate(post_id, author_id, lane, in_network, score);
    candidate.news_metadata = Some(CandidateNewsMetadataPayload {
        cluster_id: Some(cluster_id),
        ..CandidateNewsMetadataPayload::default()
    });
    candidate
}

#[test]
fn selector_orders_by_final_score_not_weighted_fallback() {
    let mut missing_final_score =
        candidate("post-weighted-only", "author-a", "interest", false, 0.0);
    missing_final_score.score = None;
    missing_final_score.weighted_score = Some(99.0);
    missing_final_score.pipeline_score = Some(99.0);
    let final_scored = candidate("post-final", "author-b", "interest", false, 0.1);

    let selected = select_candidates(
        &query("warm", 1),
        &[missing_final_score, final_scored],
        1,
        10,
        2,
    );

    assert_eq!(selected[0].post_id, "post-final");
}

fn trend_candidate(
    post_id: &str,
    author_id: &str,
    lane: &str,
    score: f64,
) -> RecommendationCandidatePayload {
    let mut candidate = candidate(post_id, author_id, lane, false, score);
    candidate.score_breakdown = Some(HashMap::from([("trendAffinityStrength".to_string(), 0.32)]));
    candidate
}

fn query_with_trend_policy(state: &str, limit: usize) -> RecommendationQueryPayload {
    let mut query = query(state, limit);
    query.ranking_policy = Some(RankingPolicyPayload {
        trend_keywords: Some(vec!["rust".to_string(), "recsys".to_string()]),
        ..RankingPolicyPayload::default()
    });
    query
}

#[test]
fn selector_enforces_author_soft_cap_and_lane_mix() {
    let selected = select_candidates(
        &query("warm", 6),
        &[
            candidate("f1", "author-a", "in_network", true, 10.0),
            candidate("f2", "author-a", "in_network", true, 9.8),
            candidate("f3", "author-a", "in_network", true, 9.6),
            candidate("f4", "author-f", "in_network", true, 9.5),
            candidate("g1", "author-b", "social_expansion", false, 9.4),
            candidate("i1", "author-c", "interest", false, 9.2),
            candidate("i2", "author-d", "interest", false, 9.0),
            candidate("p1", "author-e", "fallback", false, 8.8),
        ],
        1,
        20,
        2,
    );

    let author_a_count = selected
        .iter()
        .filter(|candidate| candidate.author_id == "author-a")
        .count();
    let social_count = selected
        .iter()
        .filter(|candidate| candidate.retrieval_lane.as_deref() == Some("social_expansion"))
        .count();
    assert_eq!(author_a_count, 2);
    assert!(social_count >= 1);
}

#[test]
fn selector_report_records_first_blocking_reason() {
    let output = select_candidates_with_report(
        &query("warm", 2),
        &[
            candidate("f1", "author-a", "in_network", true, 10.0),
            candidate("f2", "author-a", "in_network", true, 9.8),
            candidate("f3", "author-a", "in_network", true, 9.6),
        ],
        1,
        20,
        1,
    );

    assert_eq!(output.candidates.len(), 2);
    assert_eq!(
        output.report.first_blocking_reason.as_deref(),
        Some("author_soft_cap")
    );
    assert_eq!(
        output
            .report
            .deferred_reason_counts
            .get("author_soft_cap")
            .copied(),
        Some(1)
    );
}

#[test]
fn selector_report_exposes_machine_readable_policy_snapshot() {
    let output = select_candidates_with_report(
        &query("warm", 6),
        &[
            candidate("f1", "author-f1", "in_network", true, 10.0),
            candidate("g1", "author-g1", "social_expansion", false, 9.8),
            candidate("i1", "author-i1", "interest", false, 9.6),
            candidate("p1", "author-p1", "fallback", false, 9.4),
        ],
        1,
        20,
        2,
    );

    let policy = output
        .report
        .policy_snapshot
        .as_ref()
        .expect("selector policy snapshot");
    assert_eq!(policy.target_size, 6);
    assert_eq!(policy.window_factor, 3);
    assert_eq!(policy.author_soft_cap, 2);
    assert_eq!(policy.source_soft_cap, 3);
    assert_eq!(policy.max_oon_count, 3);
    assert_eq!(
        policy.lane_order,
        vec![
            "in_network".to_string(),
            "social_expansion".to_string(),
            "interest".to_string(),
            "fallback".to_string()
        ]
    );
    assert_eq!(policy.lane_floors.get("in_network"), Some(&2));
    assert_eq!(policy.lane_ceilings.get("fallback"), Some(&2));
}

#[test]
fn sparse_selector_limits_fallback_takeover() {
    let selected = select_candidates(
        &query("sparse", 5),
        &[
            candidate("p1", "author-p1", "fallback", false, 9.9),
            candidate("p2", "author-p2", "fallback", false, 9.8),
            candidate("p3", "author-p3", "fallback", false, 9.7),
            candidate("i1", "author-i1", "interest", false, 9.6),
            candidate("i2", "author-i2", "interest", false, 9.5),
            candidate("f1", "author-f1", "in_network", true, 9.4),
        ],
        1,
        20,
        2,
    );

    let fallback_count = selected
        .iter()
        .filter(|candidate| candidate.retrieval_lane.as_deref() == Some("fallback"))
        .count();
    assert!(fallback_count <= 2);
}

#[test]
fn selector_preserves_interleaved_lane_output_order() {
    let selected = select_candidates(
        &query("warm", 6),
        &[
            candidate("f1", "author-f1", "in_network", true, 10.0),
            candidate("f2", "author-f2", "in_network", true, 9.9),
            candidate("f3", "author-f3", "in_network", true, 9.8),
            candidate("g1", "author-g1", "social_expansion", false, 9.7),
            candidate("g2", "author-g2", "social_expansion", false, 9.6),
            candidate("i1", "author-i1", "interest", false, 9.5),
            candidate("i2", "author-i2", "interest", false, 9.4),
            candidate("p1", "author-p1", "fallback", false, 9.3),
        ],
        1,
        20,
        2,
    );

    let lanes = selected
        .iter()
        .map(|candidate| candidate.retrieval_lane.clone().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(lanes.first().map(String::as_str), Some("in_network"));
    assert_eq!(lanes.get(1).map(String::as_str), Some("social_expansion"));
    assert_eq!(lanes.get(2).map(String::as_str), Some("interest"));
}

#[test]
fn selector_applies_topic_soft_cap_before_relaxed_underfill() {
    let selected = select_candidates(
        &query("warm", 6),
        &[
            candidate_with_cluster("c1", "author-c1", "interest", false, 10.0, 7),
            candidate_with_cluster("c2", "author-c2", "interest", false, 9.9, 7),
            candidate_with_cluster("c3", "author-c3", "interest", false, 9.8, 7),
            candidate_with_cluster("c4", "author-c4", "interest", false, 9.7, 7),
            candidate_with_cluster("c5", "author-c5", "interest", false, 9.6, 7),
            candidate_with_cluster("g1", "author-g1", "social_expansion", false, 9.5, 9),
            candidate_with_cluster("f1", "author-f1", "in_network", true, 9.4, 10),
            candidate_with_cluster("i1", "author-i1", "interest", false, 9.3, 11),
        ],
        1,
        20,
        3,
    );

    let cluster_7_count = selected
        .iter()
        .filter(|candidate| {
            candidate
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.cluster_id)
                == Some(7)
        })
        .count();
    assert!(cluster_7_count <= 4);
    assert!(selected.iter().any(|candidate| {
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.cluster_id)
            == Some(9)
    }));
}

#[test]
fn selector_prevents_single_source_takeover_when_alternatives_exist() {
    let selected = select_candidates(
        &query("warm", 6),
        &[
            candidate("i1", "author-i1", "interest", false, 10.0),
            candidate("i2", "author-i2", "interest", false, 9.9),
            candidate("i3", "author-i3", "interest", false, 9.8),
            candidate("i4", "author-i4", "interest", false, 9.7),
            candidate("f1", "author-f1", "in_network", true, 9.6),
            candidate("g1", "author-g1", "social_expansion", false, 9.5),
            candidate("p1", "author-p1", "fallback", false, 9.4),
        ],
        1,
        20,
        2,
    );

    let two_tower_count = selected
        .iter()
        .filter(|candidate| candidate.recall_source.as_deref() == Some("TwoTowerSource"))
        .count();
    assert!(two_tower_count <= 3);
    assert!(
        selected
            .iter()
            .any(|candidate| { candidate.recall_source.as_deref() == Some("FollowingSource") })
    );
    assert!(
        selected
            .iter()
            .any(|candidate| { candidate.recall_source.as_deref() == Some("GraphSource") })
    );
}

#[test]
fn selector_prevents_single_news_domain_takeover_when_alternatives_exist() {
    let mut same_domain = (1..=5)
        .map(|index| {
            let mut candidate = candidate_with_cluster(
                &format!("same-domain-{index}"),
                &format!("author-domain-{index}"),
                "interest",
                false,
                10.0 - index as f64 * 0.1,
                100 + index,
            );
            candidate.is_news = Some(true);
            candidate.news_metadata = Some(CandidateNewsMetadataPayload {
                cluster_id: Some(100 + index),
                source_url: Some(format!("https://same.example/news/{index}")),
                source: Some("same.example".to_string()),
                ..CandidateNewsMetadataPayload::default()
            });
            candidate
        })
        .collect::<Vec<_>>();
    same_domain.push(candidate("f1", "author-f1", "in_network", true, 9.4));
    same_domain.push(candidate(
        "g1",
        "author-g1",
        "social_expansion",
        false,
        9.25,
    ));
    same_domain.push(candidate("i-alt", "author-i-alt", "interest", false, 9.2));
    let mut other_news =
        candidate_with_cluster("other-news", "author-other", "interest", false, 9.3, 220);
    other_news.is_news = Some(true);
    other_news.news_metadata = Some(CandidateNewsMetadataPayload {
        cluster_id: Some(220),
        source_url: Some("https://other.example/news/1".to_string()),
        source: Some("other.example".to_string()),
        ..CandidateNewsMetadataPayload::default()
    });
    same_domain.push(other_news);

    let mut query = query("warm", 6);
    query.ranking_policy = Some(RankingPolicyPayload {
        source_soft_cap_ratio: Some(1.0),
        news_ceiling_ratio: Some(1.0),
        ..RankingPolicyPayload::default()
    });
    let selected = select_candidates(&query, &same_domain, 1, 20, 3);
    let same_domain_count = selected
        .iter()
        .filter(|candidate| {
            candidate
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.source_url.as_deref())
                .is_some_and(|url| url.contains("same.example"))
        })
        .count();

    assert!(same_domain_count <= 3);
    assert!(
        selected
            .iter()
            .any(|candidate| candidate.post_id == "other-news")
    );
}

#[test]
fn selector_applies_conversation_diversity_before_relaxed_underfill() {
    let mut repeated = (1..=5)
        .map(|index| {
            let mut candidate = candidate(
                &format!("thread-{index}"),
                &format!("author-thread-{index}"),
                "interest",
                false,
                10.0 - index as f64 * 0.1,
            );
            candidate.conversation_id = Some("conversation-a".to_string());
            candidate
        })
        .collect::<Vec<_>>();
    repeated.push(candidate("g1", "author-g1", "social_expansion", false, 9.3));
    repeated.push(candidate("f1", "author-f1", "in_network", true, 9.2));

    let selected = select_candidates(&query("warm", 6), &repeated, 1, 20, 3);
    let repeated_count = selected
        .iter()
        .filter(|candidate| candidate.conversation_id.as_deref() == Some("conversation-a"))
        .count();

    assert!(repeated_count <= 4);
    assert!(
        selected
            .iter()
            .any(|candidate| candidate.retrieval_lane.as_deref() == Some("social_expansion"))
    );
}

#[test]
fn selector_keeps_media_format_from_monopolizing_when_alternatives_exist() {
    let mut candidates = (1..=5)
        .map(|index| {
            let mut candidate = candidate(
                &format!("video-{index}"),
                &format!("author-video-{index}"),
                "interest",
                false,
                10.0 - index as f64 * 0.1,
            );
            candidate.has_video = Some(true);
            candidate
        })
        .collect::<Vec<_>>();
    candidates.push(candidate(
        "text-1",
        "author-text-1",
        "in_network",
        true,
        9.3,
    ));
    candidates.push(candidate(
        "image-1",
        "author-image-1",
        "social_expansion",
        false,
        9.2,
    ));
    candidates.last_mut().unwrap().has_image = Some(true);

    let selected = select_candidates(&query("warm", 6), &candidates, 1, 20, 3);
    let video_count = selected
        .iter()
        .filter(|candidate| candidate.has_video == Some(true))
        .count();

    assert!(video_count <= 4);
    assert!(
        selected
            .iter()
            .any(|candidate| candidate.has_image == Some(true))
    );
}

#[test]
fn selector_reserves_trend_visibility_when_policy_has_trends() {
    let selected = select_candidates(
        &query_with_trend_policy("warm", 8),
        &[
            candidate("f1", "author-f1", "in_network", true, 10.0),
            candidate("f2", "author-f2", "in_network", true, 9.9),
            candidate("g1", "author-g1", "social_expansion", false, 9.8),
            candidate("g2", "author-g2", "social_expansion", false, 9.7),
            candidate("i1", "author-i1", "interest", false, 9.6),
            candidate("i2", "author-i2", "interest", false, 9.5),
            candidate("p1", "author-p1", "fallback", false, 9.4),
            trend_candidate("t1", "author-t1", "interest", 7.2),
        ],
        1,
        20,
        2,
    );

    assert!(selected.iter().any(|candidate| {
        candidate.selection_pool.as_deref() == Some("trend") || candidate.post_id == "t1"
    }));
}

#[test]
fn selector_caps_trend_takeover_when_policy_has_ceiling() {
    let mut query = query_with_trend_policy("warm", 6);
    query.ranking_policy = Some(RankingPolicyPayload {
        trend_keywords: Some(vec!["rust".to_string()]),
        trend_ceiling_ratio: Some(0.25),
        trend_floor_ratio: Some(0.1),
        ..RankingPolicyPayload::default()
    });
    let mut following = candidate("f1", "author-f1", "in_network", true, 9.6);
    following.conversation_id = Some("conversation-f1".to_string());
    let mut graph = candidate("g1", "author-g1", "social_expansion", false, 9.5);
    graph.conversation_id = Some("conversation-g1".to_string());
    let mut interest = candidate("i1", "author-i1", "interest", false, 9.4);
    interest.conversation_id = Some("conversation-i1".to_string());
    let mut fallback = candidate("p1", "author-p1", "fallback", false, 9.3);
    fallback.conversation_id = Some("conversation-p1".to_string());
    let selected = select_candidates(
        &query,
        &[
            trend_candidate("t1", "author-t1", "interest", 10.0),
            trend_candidate("t2", "author-t2", "interest", 9.9),
            trend_candidate("t3", "author-t3", "interest", 9.8),
            trend_candidate("t4", "author-t4", "interest", 9.7),
            following,
            graph,
            interest,
            fallback,
        ],
        1,
        20,
        2,
    );

    let trend_count = selected
        .iter()
        .filter(|candidate| candidate.post_id.starts_with('t'))
        .count();
    assert!(trend_count <= 2);
    assert!(selected.iter().any(|candidate| candidate.post_id == "f1"));
}

#[test]
fn selector_applies_policy_lane_floors_and_ceilings() {
    let mut query = query("warm", 6);
    query.ranking_policy = Some(RankingPolicyPayload {
        interest_floor_ratio: Some(0.5),
        fallback_ceiling_ratio: Some(0.16),
        in_network_floor_ratio: Some(0.0),
        social_graph_floor_ratio: Some(0.0),
        ..RankingPolicyPayload::default()
    });

    let selected = select_candidates(
        &query,
        &[
            candidate("p1", "author-p1", "fallback", false, 10.0),
            candidate("p2", "author-p2", "fallback", false, 9.9),
            candidate("p3", "author-p3", "fallback", false, 9.8),
            candidate("p4", "author-p4", "fallback", false, 9.7),
            candidate("i1", "author-i1", "interest", false, 8.6),
            candidate("i2", "author-i2", "interest", false, 8.5),
            candidate("i3", "author-i3", "interest", false, 8.4),
            candidate("f1", "author-f1", "in_network", true, 8.3),
            candidate("g1", "author-g1", "social_expansion", false, 8.2),
        ],
        1,
        20,
        2,
    );

    let interest_count = selected
        .iter()
        .filter(|candidate| candidate.retrieval_lane.as_deref() == Some("interest"))
        .count();
    let fallback_count = selected
        .iter()
        .filter(|candidate| candidate.retrieval_lane.as_deref() == Some("fallback"))
        .count();

    assert!(interest_count >= 3);
    assert!(fallback_count <= 1);
}

#[test]
fn selector_reserves_news_visibility_when_news_pool_exists() {
    let mut news = candidate_with_cluster("n1", "author-n1", "interest", false, 7.1, 42);
    news.is_news = Some(true);
    let selected = select_candidates(
        &query("warm", 8),
        &[
            candidate("f1", "author-f1", "in_network", true, 10.0),
            candidate("f2", "author-f2", "in_network", true, 9.9),
            candidate("g1", "author-g1", "social_expansion", false, 9.8),
            candidate("g2", "author-g2", "social_expansion", false, 9.7),
            candidate("i1", "author-i1", "interest", false, 9.6),
            candidate("i2", "author-i2", "interest", false, 9.5),
            candidate("p1", "author-p1", "fallback", false, 9.4),
            news,
        ],
        1,
        20,
        2,
    );

    assert!(selected.iter().any(|candidate| candidate.post_id == "n1"));
}
