//! 过滤器模块单元测试（验证管线顺序组合与 `FilterResult::partition` 原地切分顺序性）。

use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

struct PassthroughFilter;
impl PipelineFilter for PassthroughFilter {
    fn name(&self) -> &str {
        "PassthroughFilter"
    }

    fn primary_drop_reason(&self) -> &str {
        "passthrough"
    }

    fn filter_candidates(
        &self,
        _query: &FilterQuery<'_>,
        candidates: Vec<FilterCandidate>,
    ) -> FilterOutcome {
        FilterOutcome::keep_all(candidates)
    }
}

struct DropAllFilter;
impl PipelineFilter for DropAllFilter {
    fn name(&self) -> &str {
        "DropAllFilter"
    }

    fn primary_drop_reason(&self) -> &str {
        "drop_all"
    }

    fn filter_candidates(
        &self,
        _query: &FilterQuery<'_>,
        candidates: Vec<FilterCandidate>,
    ) -> FilterOutcome {
        FilterOutcome::new(Vec::new(), candidates, None)
    }
}

fn make_query() -> FilterQuery<'static> {
    FilterQuery {
        user_id: "test-user",
        limit: 10,
        in_network_only: false,
        is_bottom_request: false,
        seen_ids: &[],
        served_ids: &[],
        blocked_user_ids: &[],
        muted_user_ids: &[],
        muted_keywords: &[],
        followed_user_ids: &[],
    }
}

fn make_candidate(post_id: &str) -> FilterCandidate {
    FilterCandidate {
        post_id: post_id.to_string(),
        author_id: "author".to_string(),
        content: "content".to_string(),
        recall_source: None,
        original_post_id: None,
        conversation_id: None,
        is_news: None,
        is_nsfw: None,
        in_network: None,
        author_blocks_viewer: None,
        vf_safe: None,
        created_at: chrono::Utc::now(),
    }
}

#[test]
fn filter_pipeline_passes_through() {
    let query = make_query();
    let candidates = vec![make_candidate("p1"), make_candidate("p2")];
    let filters: Vec<&dyn PipelineFilter> = vec![&PassthroughFilter];
    let result = run_filter_pipeline(&filters, &query, candidates);
    assert_eq!(result.candidates.len(), 2);
    assert!(result.drop_counts.is_empty());
}

#[test]
fn filter_pipeline_drops_all() {
    let query = make_query();
    let candidates = vec![make_candidate("p1"), make_candidate("p2")];
    let filters: Vec<&dyn PipelineFilter> = vec![&DropAllFilter];
    let result = run_filter_pipeline(&filters, &query, candidates);
    assert!(result.candidates.is_empty());
    assert_eq!(result.drop_counts.get("DropAllFilter"), Some(&2));
}

#[test]
fn filter_pipeline_sequential_composition() {
    let query = make_query();
    let candidates = vec![
        make_candidate("p1"),
        make_candidate("p2"),
        make_candidate("p3"),
    ];
    let filters: Vec<&dyn PipelineFilter> = vec![&PassthroughFilter, &DropAllFilter];
    let result = run_filter_pipeline(&filters, &query, candidates);
    assert!(result.candidates.is_empty());
    assert_eq!(result.drop_counts.get("DropAllFilter"), Some(&3));
    assert_eq!(result.records.len(), 2);
    assert!(result.records[0].enabled);
    assert!(result.records[1].enabled);
}

#[test]
fn partition_preserves_input_order_and_calls_predicate_once_per_item() {
    let input: Vec<_> = (0..17).map(|id| (id, format!("payload-{id}"))).collect();
    let expected_kept: Vec<_> = input
        .iter()
        .filter(|(id, _)| id % 2 == 0)
        .cloned()
        .collect();
    let expected_removed: Vec<_> = input
        .iter()
        .filter(|(id, _)| id % 2 != 0)
        .cloned()
        .collect();

    let calls = AtomicUsize::new(0);
    let result = FilterResult::partition(input, |(id, _)| {
        calls.fetch_add(1, Ordering::Relaxed);
        id % 2 == 0
    });

    assert_eq!(calls.load(Ordering::Relaxed), 17);
    assert_eq!(result.kept, expected_kept);
    assert_eq!(result.removed, expected_removed);
}
