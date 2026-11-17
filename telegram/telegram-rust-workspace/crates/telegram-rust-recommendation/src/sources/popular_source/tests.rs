use super::*;

fn raw_post(post_id: &str, author_id: &str, age_hours: f64, views: u64) -> PopularPostInput {
    PopularPostInput {
        post_id: post_id.to_string(),
        author_id: author_id.to_string(),
        created_at_ms: 1_763_180_000_000,
        age_hours,
        engagement_views: views,
        semantic_ids: Some([1, 2, 3, 4, 5, 6]),
    }
}

#[test]
fn empty_snapshot_fails_open_with_empty_candidates() {
    let source = PopularSource::new();
    let query = RecommendationQueryPayload {
        user_id: "viewer-1".to_string(),
        ..Default::default()
    };
    assert!(source.enable(&query));
    assert!(source.retrieve(&query).is_empty());
}

#[test]
fn half_life_8h_selection_caps_per_author_5_and_budget_500() {
    let mut inputs = Vec::new();
    for idx in 0..8 {
        inputs.push(raw_post(
            &format!("a1-p{idx}"),
            "a1",
            (idx as f64 + 1.0) * 2.0,
            100 + idx * 10,
        ));
    }
    for idx in 0..600 {
        inputs.push(raw_post(
            &format!("other-{idx}"),
            &format!("author-{}", idx / 2),
            1.0,
            200,
        ));
    }

    let source = PopularSource::new();
    source.refresh_from_inputs(&inputs, 1_763_180_000_000);

    let snap = source.snapshot();
    assert_eq!(snap.posts.len(), 500);
    let a1_count = snap.posts.iter().filter(|p| p.author_id == "a1").count();
    assert!(a1_count <= 5);

    // 验证 8 小时半衰期公式对齐 x-algorithm: 0.25h/100views 应优于 24h/1000views
    let fast = compute_popular_quality(100, 0.25, &PopularSelectionConfig::default());
    let stale = compute_popular_quality(1_000, 24.0, &PopularSelectionConfig::default());
    assert!(fast > stale);
}

#[test]
fn retrieve_filters_seen_ids_and_respects_per_author_cap() {
    let source = PopularSource::new();
    let inputs: Vec<PopularPostInput> = (0..7)
        .map(|idx| raw_post(&format!("p{idx}"), "author-hot", 1.0, 500 - idx * 10))
        .collect();
    source.refresh_from_inputs(&inputs, 1_763_180_000_000);

    let query = RecommendationQueryPayload {
        user_id: "viewer-2".to_string(),
        seen_ids: vec!["p0".to_string()],
        ..Default::default()
    };
    let (candidates, stage) = source.retrieve_with_stage(&query);
    assert!(stage.enabled);
    assert_eq!(stage.output_count, 4);

    let ids: Vec<&str> = candidates.iter().map(|c| c.post_id.as_str()).collect();
    assert_eq!(ids, vec!["p1", "p2", "p3", "p4"]);
    assert_eq!(candidates[0].recall_source.as_deref(), Some(POPULAR_SOURCE));
    assert_eq!(
        candidates[0].retrieval_sources[0].source_type,
        POPULAR_SOURCE
    );
    assert_eq!(candidates[0].retrieval_sources[0].position, Some(1));
}
