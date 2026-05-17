use std::collections::HashMap;
use std::time::Instant;

use serde_json::Value;

/// PipelineFilter trait — 对标 X 的 Filter<Q, C> 模式
///
/// 将当前的 bare fn 指针模式迁移为 trait 对象模式，
/// 使新 filter 可以实现 trait 而非遵循固定函数签名。
///
/// 迁移策略：通过 `FnFilter` wrapper 桥接现有 filter 函数，
/// 新 filter 直接实现 `PipelineFilter` trait。
pub trait PipelineFilter: Send + Sync {
    /// Filter 的唯一名称（如 "DuplicateFilter"），用于遥测和 stage 记录。
    fn name(&self) -> &str;

    /// 主要 drop reason（如 "duplicate_post"），用于 drop_counts 聚合。
    fn primary_drop_reason(&self) -> &str;

    /// 判断此 filter 是否应激活（如 age_filter 在 in_network_only 时跳过）。
    /// 默认始终激活。
    fn is_enabled(&self, query: &FilterQuery<'_>) -> bool {
        let _ = query;
        true
    }

    /// 核心过滤逻辑。返回 kept 和 removed 两组候选。
    fn filter_candidates(
        &self,
        query: &FilterQuery<'_>,
        candidates: Vec<FilterCandidate>,
    ) -> FilterOutcome;
}

/// Filter 查询上下文（精简版，避免依赖完整 contract 类型）
pub struct FilterQuery<'a> {
    pub user_id: &'a str,
    pub limit: usize,
    pub in_network_only: bool,
    pub is_bottom_request: bool,
    pub seen_ids: &'a [&'a str],
    pub served_ids: &'a [&'a str],
    pub blocked_user_ids: &'a [&'a str],
    pub muted_user_ids: &'a [&'a str],
    pub muted_keywords: &'a [&'a str],
    pub followed_user_ids: &'a [&'a str],
}

/// Filter 候选（精简版）
#[derive(Clone)]
pub struct FilterCandidate {
    pub post_id: String,
    pub author_id: String,
    pub content: String,
    pub recall_source: Option<String>,
    pub original_post_id: Option<String>,
    pub conversation_id: Option<String>,
    pub is_news: Option<bool>,
    pub is_nsfw: Option<bool>,
    pub in_network: Option<bool>,
    pub author_blocks_viewer: Option<bool>,
    pub vf_safe: Option<bool>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Filter 执行结果
pub struct FilterOutcome {
    pub kept: Vec<FilterCandidate>,
    pub removed: Vec<FilterCandidate>,
    pub detail: Option<HashMap<String, Value>>,
}

impl FilterOutcome {
    pub fn new(
        kept: Vec<FilterCandidate>,
        removed: Vec<FilterCandidate>,
        detail: Option<HashMap<String, Value>>,
    ) -> Self {
        Self {
            kept,
            removed,
            detail,
        }
    }

    /// 全部保留的快捷构造（用于 disabled filter）
    pub fn keep_all(candidates: Vec<FilterCandidate>) -> Self {
        Self {
            kept: candidates,
            removed: Vec::new(),
            detail: None,
        }
    }

    pub fn removed_count(&self) -> usize {
        self.removed.len()
    }
}

/// Filter 执行记录（用于 pipeline stage payload）
pub struct FilterExecutionRecord {
    pub name: String,
    pub enabled: bool,
    pub input_count: usize,
    pub output_count: usize,
    pub removed_count: usize,
    pub duration_ms: u64,
    pub detail: Option<HashMap<String, Value>>,
}

/// FnFilter — 将现有 bare fn 指针桥接为 PipelineFilter trait 实现
///
/// 迁移路径：
/// 1. 新 filter 直接 impl PipelineFilter
/// 2. 现有 filter 通过 FnFilter 包装（渐进迁移）
/// 3. 最终移除 FilterFn 类型别名
pub struct FnFilter {
    filter_name: String,
    drop_reason: String,
    filter_fn: fn(&FilterQuery<'_>, Vec<FilterCandidate>) -> FilterOutcome,
    enabled_fn: Option<fn(&FilterQuery<'_>) -> bool>,
}

impl FnFilter {
    pub fn new(
        name: impl Into<String>,
        drop_reason: impl Into<String>,
        filter_fn: fn(&FilterQuery<'_>, Vec<FilterCandidate>) -> FilterOutcome,
    ) -> Self {
        Self {
            filter_name: name.into(),
            drop_reason: drop_reason.into(),
            filter_fn,
            enabled_fn: None,
        }
    }

    pub fn with_enabled_check(mut self, enabled_fn: fn(&FilterQuery<'_>) -> bool) -> Self {
        self.enabled_fn = Some(enabled_fn);
        self
    }
}

impl PipelineFilter for FnFilter {
    fn name(&self) -> &str {
        &self.filter_name
    }

    fn primary_drop_reason(&self) -> &str {
        &self.drop_reason
    }

    fn is_enabled(&self, query: &FilterQuery<'_>) -> bool {
        self.enabled_fn.map(|f| f(query)).unwrap_or(true)
    }

    fn filter_candidates(
        &self,
        query: &FilterQuery<'_>,
        candidates: Vec<FilterCandidate>,
    ) -> FilterOutcome {
        (self.filter_fn)(query, candidates)
    }
}

/// run_filter_pipeline — 带自动 tracing 的 filter pipeline 执行器
///
/// 对标 X 的 Filter.run() wrapper，自动记录：
/// - input_count / output_count / removed_count
/// - duration_ms
/// - per-filter drop rate
///
/// 替代当前 `run_pre_score_filters` / `run_post_selection_filters` 中的 for 循环。
pub fn run_filter_pipeline(
    filters: &[&dyn PipelineFilter],
    query: &FilterQuery<'_>,
    candidates: Vec<FilterCandidate>,
) -> PipelineFilterResult {
    let mut current = candidates;
    let mut total_removed = Vec::new();
    let mut drop_counts = HashMap::new();
    let mut records = Vec::new();

    for filter in filters {
        let input_count = current.len();
        let enabled = filter.is_enabled(query);

        if !enabled {
            records.push(FilterExecutionRecord {
                name: filter.name().to_string(),
                enabled: false,
                input_count,
                output_count: input_count,
                removed_count: 0,
                duration_ms: 0,
                detail: None,
            });
            continue;
        }

        let start = Instant::now();
        let outcome = filter.filter_candidates(query, current);
        let duration_ms = start.elapsed().as_millis() as u64;

        let removed_count = outcome.removed_count();
        current = outcome.kept;

        if removed_count > 0 {
            drop_counts.insert(filter.name().to_string(), removed_count);
            total_removed.extend(outcome.removed);
        }

        records.push(FilterExecutionRecord {
            name: filter.name().to_string(),
            enabled: true,
            input_count,
            output_count: current.len(),
            removed_count,
            duration_ms,
            detail: outcome.detail,
        });
    }

    PipelineFilterResult {
        candidates: current,
        drop_counts,
        records,
    }
}

/// Filter pipeline 执行结果
pub struct PipelineFilterResult {
    pub candidates: Vec<FilterCandidate>,
    pub drop_counts: HashMap<String, usize>,
    pub records: Vec<FilterExecutionRecord>,
}

#[cfg(test)]
mod tests {
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
        // Passthrough first, then DropAll — DropAll should see all 3
        let filters: Vec<&dyn PipelineFilter> = vec![&PassthroughFilter, &DropAllFilter];
        let result = run_filter_pipeline(&filters, &query, candidates);
        assert!(result.candidates.is_empty());
        assert_eq!(result.drop_counts.get("DropAllFilter"), Some(&3));
        assert_eq!(result.records.len(), 2);
        assert!(result.records[0].enabled);
        assert!(result.records[1].enabled);
    }
}
