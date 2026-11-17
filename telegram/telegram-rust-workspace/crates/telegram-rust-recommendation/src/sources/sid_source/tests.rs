use std::collections::HashMap;

use serde_json::Value;

use super::*;
use crate::contracts::ColumnarActionStepPayload;
use crate::state::sid_index::{IndexedSidPost, SidPrefixIndex};

fn sid_post(post_id: &str, author_id: &str, codes: [i32; 6], ts: i64) -> IndexedSidPost {
    IndexedSidPost::from_codes(post_id, author_id, &codes, ts).unwrap()
}

#[test]
fn sid_source_retrieves_from_columnar_positive_seeds_and_fails_closed_on_empty_author() {
    let index = SidPrefixIndex::build(vec![
        sid_post("p-good-1", "author-1", [12, 87, 203, 5, 199, 64], 500),
        sid_post("p-good-2", "author-2", [12, 87, 203, 1, 2, 3], 400),
        sid_post("p-bad-author", "", [12, 87, 203, 9, 9, 9], 999),
        sid_post("p-neg-seed-match", "author-3", [55, 66, 77, 1, 1, 1], 800),
    ]);
    let source = SidSource::from_index(index);

    let query = RecommendationQueryPayload {
        request_id: "req-sid".to_string(),
        decision_id: "00000000-0000-4000-8000-0000000000aa".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 20,
        columnar_retrieval_sequence: vec![
            ColumnarActionStepPayload {
                post_id_hash: 1001,
                semantic_ids: Some([12, 87, 203, 5, 199, 64]),
                author_hash: 10,
                action_type: 2, // like
                action_mask: vec![1; 13],
                time_delta_sec: 10.0,
            },
            ColumnarActionStepPayload {
                post_id_hash: 1002,
                semantic_ids: Some([55, 66, 77, 1, 1, 1]),
                author_hash: 11,
                action_type: 12, // not_interested 负反馈不得作为正种子
                action_mask: vec![1; 13],
                time_delta_sec: 1.0,
            },
        ],
        ..Default::default()
    };

    assert!(source.enable(&query));
    let (candidates, stage) = source.retrieve_with_stage(&query);
    assert!(stage.enabled);
    assert_eq!(stage.output_count, 2);

    let ids: Vec<&str> = candidates.iter().map(|c| c.post_id.as_str()).collect();
    assert_eq!(ids, vec!["p-good-1", "p-good-2"]);
    assert_eq!(candidates[0].semantic_ids, Some([12, 87, 203, 5, 199, 64]));
    assert_eq!(candidates[0].retrieval_sources[0].source_type, "SidSource");
    assert_eq!(candidates[0].retrieval_sources[0].score, Some(6.0));
    assert_eq!(candidates[0].retrieval_sources[0].position, Some(1));
    assert_eq!(candidates[1].retrieval_sources[0].score, Some(3.0));
    assert_eq!(candidates[1].retrieval_sources[0].position, Some(2));
}

#[test]
fn sid_source_respects_legacy_user_action_sequence_and_short_circuit_flags() {
    let index = SidPrefixIndex::build(vec![
        sid_post("seed-post", "a0", [30, 40, 50, 60, 70, 80], 100),
        sid_post("neighbor-post", "a1", [30, 40, 50, 60, 70, 99], 200),
        sid_post("reported-post", "a2", [30, 40, 50, 1, 2, 3], 300),
    ]);
    let source = SidSource::from_index(index);

    let mut query = RecommendationQueryPayload {
        user_id: "viewer-2".to_string(),
        user_action_sequence: Some(vec![
            HashMap::from([
                ("action".to_string(), Value::String("like".to_string())),
                (
                    "targetPostId".to_string(),
                    Value::String("seed-post".to_string()),
                ),
            ]),
            HashMap::from([
                ("action".to_string(), Value::String("report".to_string())),
                (
                    "targetPostId".to_string(),
                    Value::String("reported-post".to_string()),
                ),
            ]),
        ]),
        ..Default::default()
    };

    let candidates = source.retrieve(&query);
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].post_id, "neighbor-post");

    // 命中缓存短路或仅关注流时禁用 SidSource
    query.has_cached_posts = Some(true);
    assert!(!source.enable(&query));
    assert!(source.retrieve(&query).is_empty());

    query.has_cached_posts = Some(false);
    query.in_network_only = true;
    assert!(!source.enable(&query));
}

#[test]
fn sid_source_supports_seed_candidate_post_ids_fallback() {
    let index = SidPrefixIndex::build(vec![
        sid_post("ctx-seed", "a0", [88, 99, 100, 1, 2, 3], 100),
        sid_post("ctx-hit", "a1", [88, 99, 100, 9, 8, 7], 200),
    ]);
    let source = SidSource::from_index(index);
    let query = RecommendationQueryPayload {
        user_id: "viewer-3".to_string(),
        seed_candidate_post_ids: vec!["ctx-seed".to_string()],
        ..Default::default()
    };
    let candidates = source.retrieve(&query);
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].post_id, "ctx-hit");
}
