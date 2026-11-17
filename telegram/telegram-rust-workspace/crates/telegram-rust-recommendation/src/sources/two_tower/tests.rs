use chrono::DateTime;

use super::*;
use crate::contracts::{MediaType, RecommendationCandidatePayload};

fn candidate(post_id: &str, topic_ids: Vec<&str>) -> RecommendationCandidatePayload {
    RecommendationCandidatePayload {
        post_id: post_id.to_string(),
        author_id: "author-1".to_string(),
        created_at: DateTime::parse_from_rfc3339("2026-04-17T00:00:00.000Z")
            .expect("valid fixture timestamp")
            .to_utc(),
        topic_ids: topic_ids.into_iter().map(ToOwned::to_owned).collect(),
        media_type: MediaType::None,
        ..Default::default()
    }
}

fn query_with_topics(topics: Option<Vec<&str>>) -> RecommendationQueryPayload {
    RecommendationQueryPayload {
        request_id: "req-two-tower".to_string(),
        decision_id: "00000000-0000-4000-8000-0000000000ff".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 20,
        interested_topics: topics.map(|v| v.into_iter().map(ToOwned::to_owned).collect()),
        ..Default::default()
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

#[test]
fn v3_filter_removes_is_news_bias_applies_seen_served_bloom_and_keeps_semantics() {
    let mut keep_social = candidate("post-social", vec!["tech"]);
    keep_social.is_news = Some(false);
    keep_social.semantic_ids = Some([1, 2, 3, 4, 5, 6]);
    keep_social.semantic_embedding_256d = Some(vec![0.25, -0.5]);

    let mut keep_news = candidate("post-news", vec![]);
    keep_news.is_news = Some(true);
    keep_news.semantic_ids = Some([7, 8, 9, 10, 11, 12]);

    let mut orig_bloom = candidate("post-orig-bloom", vec![]);
    orig_bloom.original_post_id = Some("orig-99".to_string());

    let mut query = query_with_topics(Some(vec!["tech"]));
    query.seen_ids = vec!["post-seen".to_string()];
    query.served_ids = vec!["post-served".to_string()];
    query.bloom_filter_entries = vec![
        v3_bloom_entry_hash("post-bloom"),
        v3_bloom_entry_hash("orig-99"),
    ];

    let kept = filter_v3_two_tower_candidates(
        vec![
            keep_social,
            keep_news,
            candidate("post-seen", vec![]),
            candidate("post-served", vec![]),
            candidate("post-bloom", vec![]),
            orig_bloom,
        ],
        &query,
    );
    let ids: Vec<&str> = kept.iter().map(|c| c.post_id.as_str()).collect();
    assert_eq!(ids, vec!["post-social", "post-news"]);
    assert_eq!(kept[0].semantic_ids, Some([1, 2, 3, 4, 5, 6]));
    assert_eq!(
        kept[0].semantic_embedding_256d.as_deref(),
        Some([0.25_f32, -0.5].as_slice())
    );
}
