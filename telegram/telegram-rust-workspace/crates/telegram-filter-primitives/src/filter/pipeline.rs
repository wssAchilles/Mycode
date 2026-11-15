//! 兼容旧函数签名的 `FnFilter` 适配器与串联执行器 `run_filter_pipeline`。

use std::collections::HashMap;
use std::time::Instant;

use super::traits::{
    FilterCandidate, FilterExecutionRecord, FilterOutcome, FilterQuery, PipelineFilter,
    PipelineFilterResult,
};

/// `FnFilter` — 将旧 bare fn 指针渐进桥接为 `PipelineFilter` trait 实现。
pub struct FnFilter {
    filter_name: String,
    drop_reason: String,
    filter_fn: fn(&FilterQuery<'_>, Vec<FilterCandidate>) -> FilterOutcome,
    enabled_fn: Option<fn(&FilterQuery<'_>) -> bool>,
}

impl FnFilter {
    /// 从过滤函数创建 `FnFilter` 实例。
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

    /// 附加启用判定钩子。
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

/// 顺序执行一组 `PipelineFilter`，统一记录输入/输出/丢弃数与耗时明细。
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
