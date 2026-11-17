use super::*;
use crate::state::sid_index::IndexedSidPost;

fn candidate(post_id: &str, semantic_ids: Option<[i32; 6]>) -> RecommendationCandidatePayload {
    RecommendationCandidatePayload {
        post_id: post_id.to_string(),
        author_id: "author-1".to_string(),
        semantic_ids,
        ..Default::default()
    }
}

#[test]
fn hydrates_missing_sids_from_index_and_computes_slate_prefix_stats() {
    let index = SidPrefixIndex::build(vec![
        IndexedSidPost::from_codes("p-graph", "a1", &[12, 87, 203, 5, 1, 2], 100).unwrap(),
        IndexedSidPost::from_codes("p-orig", "a2", &[12, 87, 99, 1, 1, 1], 200).unwrap(),
    ]);
    let hydrator = SemanticIdHydrator::from_index(index);

    let mut repost = candidate("p-repost", None);
    repost.is_repost = true;
    repost.original_post_id = Some("p-orig".to_string());

    let mut candidates = vec![
        candidate("p-sid", Some([12, 87, 203, 5, 199, 64])),
        candidate("p-graph", None),
        repost,
        candidate("p-unknown", None),
    ];

    let stats = hydrator.hydrate(&mut candidates);
    assert_eq!(stats.total_candidates, 4);
    assert_eq!(stats.already_had_sid, 1);
    assert_eq!(stats.hydrated_from_index, 2);
    assert_eq!(stats.missing_sid, 1);
    assert_eq!(stats.sid_known_count, 3);
    assert_eq!(stats.unique_l1_prefixes, 1);
    assert_eq!(stats.unique_l2_prefixes, 1);
    assert_eq!(stats.unique_l3_prefixes, 2);
    assert_eq!(stats.l1_prefix_counts.get(&12), Some(&3));

    // p-sid (idx=0): 首次出现 [12, 87, 203]
    let s0 = candidates[0].slate_context.as_ref().unwrap();
    assert_eq!(s0.sid_known, Some(true));
    assert_eq!(s0.sid_k_l1, Some(12));
    assert_eq!(s0.sid_k_l2, Some(87));
    assert_eq!(s0.sid_k_l3, Some(203));
    assert_eq!(s0.sid_gap_l1, None);

    // p-graph (idx=1): 从索引补齐为 [12, 87, 203, 5, 1, 2]，L1/L2/L3 与 idx=0 相邻间隔均为 1
    assert_eq!(candidates[1].semantic_ids, Some([12, 87, 203, 5, 1, 2]));
    let s1 = candidates[1].slate_context.as_ref().unwrap();
    assert_eq!(s1.sid_known, Some(true));
    assert_eq!(s1.sid_gap_l1, Some(1));
    assert_eq!(s1.sid_gap_l2, Some(1));
    assert_eq!(s1.sid_gap_l3, Some(1));

    // p-repost (idx=2): 通过 original_post_id 命中 [12, 87, 99, 1, 1, 1]
    let s2 = candidates[2].slate_context.as_ref().unwrap();
    assert_eq!(s2.sid_known, Some(true));
    assert_eq!(s2.sid_k_l3, Some(99));
    assert_eq!(s2.sid_gap_l1, Some(1));
    assert_eq!(s2.sid_gap_l2, Some(1));
    assert_eq!(s2.sid_gap_l3, None);

    // p-unknown (idx=3): 索引无记录时 sid_known = Some(false)
    let s3 = candidates[3].slate_context.as_ref().unwrap();
    assert_eq!(s3.sid_known, Some(false));
    assert_eq!(s3.sid_k_l1, None);
}

#[test]
fn hydrate_with_stage_skips_when_cached_posts_and_emits_detail_when_enabled() {
    let index = SidPrefixIndex::build(vec![
        IndexedSidPost::from_codes("p1", "a1", &[3, 4, 5, 6, 7, 8], 100).unwrap(),
    ]);
    let hydrator = SemanticIdHydrator::from_index(index);

    let cached_query = RecommendationQueryPayload {
        has_cached_posts: Some(true),
        ..Default::default()
    };
    let mut skipped_candidates = vec![candidate("p1", None)];
    let skipped_stage = hydrator.hydrate_with_stage(&cached_query, &mut skipped_candidates);
    assert!(!skipped_stage.enabled);
    assert_eq!(skipped_candidates[0].semantic_ids, None);

    let active_query = RecommendationQueryPayload::default();
    let mut active_candidates = vec![candidate("p1", None)];
    let active_stage = hydrator.hydrate_with_stage(&active_query, &mut active_candidates);
    assert!(active_stage.enabled);
    assert_eq!(active_candidates[0].semantic_ids, Some([3, 4, 5, 6, 7, 8]));
    let detail = active_stage.detail.expect("stage detail");
    assert_eq!(
        detail.get("hydratedFromIndexCount").and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(detail.get("sidKnownCount").and_then(Value::as_u64), Some(1));
}
