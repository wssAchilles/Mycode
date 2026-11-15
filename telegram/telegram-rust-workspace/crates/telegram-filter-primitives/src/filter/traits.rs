//! PipelineFilter trait 与结构化输入输出契约定义。

use std::collections::HashMap;

use serde_json::Value;

/// PipelineFilter trait — 对标 X 的 `Filter<Q, C>` 模式。
pub trait PipelineFilter: Send + Sync {
    /// Filter 的唯一名称（如 "DuplicateFilter"），用于遥测与阶段记录。
    fn name(&self) -> &str;

    /// 主要过滤丢弃原因（如 "duplicate_post"），用于聚合过滤统计。
    fn primary_drop_reason(&self) -> &str;

    /// 判断此 filter 在当前请求上下文是否应启用，默认始终启用。
    fn is_enabled(&self, query: &FilterQuery<'_>) -> bool {
        let _ = query;
        true
    }

    /// 执行核心过滤逻辑并返回保留集合与移除集合。
    fn filter_candidates(
        &self,
        query: &FilterQuery<'_>,
        candidates: Vec<FilterCandidate>,
    ) -> FilterOutcome;
}

/// Filter 查询上下文（精简版，避免依赖完整上层合约类型）。
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

/// Filter 候选输入精简结构。
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

/// 单个 Filter 的执行结果。
pub struct FilterOutcome {
    pub kept: Vec<FilterCandidate>,
    pub removed: Vec<FilterCandidate>,
    pub detail: Option<HashMap<String, Value>>,
}

impl FilterOutcome {
    /// 构造标准保留与丢弃集合。
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

    /// 全部保留快捷构造（适用于 disabled 跳过的 filter）。
    pub fn keep_all(candidates: Vec<FilterCandidate>) -> Self {
        Self {
            kept: candidates,
            removed: Vec::new(),
            detail: None,
        }
    }

    /// 返回被剔除候选数量。
    pub fn removed_count(&self) -> usize {
        self.removed.len()
    }
}

/// 单个 Filter 的阶段执行明细记录。
pub struct FilterExecutionRecord {
    pub name: String,
    pub enabled: bool,
    pub input_count: usize,
    pub output_count: usize,
    pub removed_count: usize,
    pub duration_ms: u64,
    pub detail: Option<HashMap<String, Value>>,
}

/// 整条 Filter 管线的串联执行结果。
pub struct PipelineFilterResult {
    pub candidates: Vec<FilterCandidate>,
    pub drop_counts: HashMap<String, usize>,
    pub records: Vec<FilterExecutionRecord>,
}
