//! 全局时间衰减热门帖内存快照召回源（对标 x-algorithm `popular_posts_source.rs` & `util/popular_posts.rs`）。

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Utc};
use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SOURCE, annotate_stage_contract_detail};
use telegram_source_primitives::{FALLBACK_LANE, POPULAR_SOURCE, annotate_source_stage_detail};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
    RetrievalSourcePayload,
};

mod selection;
#[cfg(test)]
mod tests;

pub use selection::{
    POPULAR_DEFAULT_BUDGET, POPULAR_DEFAULT_FLOOR_HOURS, POPULAR_DEFAULT_HALF_LIFE_HOURS,
    POPULAR_DEFAULT_PER_AUTHOR, POPULAR_DEFAULT_WINDOW_HOURS, PopularPostInput,
    PopularPostsSnapshot, PopularSelectionConfig, SelectedPopularPost, compute_popular_quality,
    select_popular_posts,
};

/// 持有 `RwLock<PopularPostsSnapshot>` 的无阻塞热门召回源（空快照 Fail-Open 返回空列表）。
#[derive(Clone, Debug)]
pub struct PopularSource {
    snapshot: Arc<RwLock<PopularPostsSnapshot>>,
    config: PopularSelectionConfig,
}

/// 兼容命名别名，方便与 x-algorithm 的 `PopularPostsSource` 对照引用。
pub type PopularPostsSource = PopularSource;

impl Default for PopularSource {
    fn default() -> Self {
        Self::new()
    }
}

impl PopularSource {
    /// 创建初始化为空快照的 `PopularSource`。
    pub fn new() -> Self {
        Self::with_config(PopularSelectionConfig::default())
    }

    /// 使用指定配置构造 `PopularSource`。
    pub fn with_config(config: PopularSelectionConfig) -> Self {
        Self {
            snapshot: Arc::new(RwLock::new(PopularPostsSnapshot::default())),
            config,
        }
    }

    /// 使用已有快照构造 `PopularSource`。
    pub fn from_snapshot(snapshot: PopularPostsSnapshot) -> Self {
        Self {
            snapshot: Arc::new(RwLock::new(snapshot)),
            config: PopularSelectionConfig::default(),
        }
    }

    /// 返回内部 `Arc<RwLock<PopularPostsSnapshot>>` 句柄以供后台异步刷新任务更新。
    pub fn snapshot_handle(&self) -> Arc<RwLock<PopularPostsSnapshot>> {
        Arc::clone(&self.snapshot)
    }

    /// 基于最新互动输入全量重算并写入 `RwLock<PopularPostsSnapshot>`。
    pub fn refresh_from_inputs(&self, posts: &[PopularPostInput], now_ms: i64) {
        let selected = select_popular_posts(posts, &self.config);
        self.replace_snapshot(PopularPostsSnapshot {
            generated_at_ms: now_ms,
            loaded_at_ms: Some(now_ms),
            posts: selected,
        });
    }

    /// 原子替换当前热门快照。
    pub fn replace_snapshot(&self, snapshot: PopularPostsSnapshot) {
        if let Ok(mut guard) = self.snapshot.write() {
            *guard = snapshot;
        }
    }

    /// 读取当前快照的克隆副本。
    pub fn snapshot(&self) -> PopularPostsSnapshot {
        self.snapshot
            .read()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// 判断本次查询是否启用 `PopularSource`。
    pub fn enable(&self, query: &RecommendationQueryPayload) -> bool {
        query.has_cached_posts != Some(true)
            && !query.in_network_only
            && query.feature_switch("enable_popular_source", true)
    }

    /// 执行热门快照召回（空快照或读锁异常时 Fail-Open 返回空列表）。
    pub fn retrieve(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Vec<RecommendationCandidatePayload> {
        self.retrieve_top(query, self.config.budget)
    }

    /// 按指定上限读取热门快照并过滤已看帖子，输出规范化候选列表。
    pub fn retrieve_top(
        &self,
        query: &RecommendationQueryPayload,
        max_results: usize,
    ) -> Vec<RecommendationCandidatePayload> {
        if !self.enable(query) || max_results == 0 {
            return Vec::new();
        }

        // Fail-Open：锁中毒或快照为空时返回空列表而非报错中断主链路
        let Ok(guard) = self.snapshot.read() else {
            return Vec::new();
        };
        if guard.posts.is_empty() {
            return Vec::new();
        }

        let seen: HashSet<String> = query.effective_seen_ids().into_iter().collect();
        let cap = max_results.min(self.config.budget);
        let mut out = Vec::with_capacity(guard.posts.len().min(cap));

        for entry in guard.posts.iter().take(cap) {
            if entry.post_id.trim().is_empty()
                || entry.author_id.trim().is_empty()
                || seen.contains(&entry.post_id)
            {
                continue;
            }
            let position = out.len() as u32 + 1;
            let created_at =
                DateTime::from_timestamp_millis(entry.created_at_ms).unwrap_or_else(Utc::now);

            out.push(RecommendationCandidatePayload {
                post_id: entry.post_id.clone(),
                author_id: entry.author_id.clone(),
                created_at,
                in_network: Some(false),
                recall_source: Some(POPULAR_SOURCE.to_string()),
                retrieval_lane: Some(FALLBACK_LANE.to_string()),
                semantic_ids: entry.semantic_ids,
                retrieval_sources: vec![RetrievalSourcePayload {
                    source_type: POPULAR_SOURCE.to_string(),
                    cluster: None,
                    score: Some(entry.quality),
                    position: Some(position),
                }],
                score: Some(entry.quality),
                ..Default::default()
            });
        }

        out
    }

    /// 执行热门召回并构建 Stage 可观测载荷。
    pub fn retrieve_with_stage(
        &self,
        query: &RecommendationQueryPayload,
    ) -> (
        Vec<RecommendationCandidatePayload>,
        RecommendationStagePayload,
    ) {
        let started_at = std::time::Instant::now();
        let enabled = self.enable(query);
        let candidates = self.retrieve(query);
        let duration_ms = started_at.elapsed().as_millis() as u64;

        let mut detail = HashMap::new();
        annotate_stage_contract_detail(&mut detail, POPULAR_SOURCE, PIPELINE_STAGE_KIND_SOURCE);
        annotate_source_stage_detail(&mut detail, POPULAR_SOURCE, enabled, candidates.len());

        let stage = RecommendationStagePayload {
            name: POPULAR_SOURCE.to_string(),
            enabled,
            duration_ms,
            input_count: 1,
            output_count: candidates.len(),
            removed_count: None,
            detail: Some(detail),
        };
        (candidates, stage)
    }
}
