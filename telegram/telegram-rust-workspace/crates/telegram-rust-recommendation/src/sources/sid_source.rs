//! 基于 6x256 Semantic ID 前缀索引的多路语义召回源（对标 x-algorithm `home-mixer/sources/sid_source.rs`）。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Utc};
use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SOURCE, annotate_stage_contract_detail};
use telegram_source_primitives::{INTEREST_LANE, annotate_source_stage_detail};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
    RetrievalSourcePayload,
};
use crate::state::sid_index::{SidPrefixIndex, SidRetrieveParams};

mod seeds;
#[cfg(test)]
mod tests;

/// `SidSource` 规范召回源标识（写入 `recall_source` 与 `RetrievalSourcePayload.source_type`）。
pub const SID_SOURCE_NAME: &str = "SidSource";

/// 基于 `SidPrefixIndex` 的纯内存语义前缀召回源。
#[derive(Clone, Debug)]
pub struct SidSource {
    index: Arc<RwLock<Arc<SidPrefixIndex>>>,
    params: SidRetrieveParams,
}

impl SidSource {
    /// 使用外部共享的读写锁快照构造 `SidSource`。
    pub fn new(index: Arc<RwLock<Arc<SidPrefixIndex>>>) -> Self {
        Self {
            index,
            params: SidRetrieveParams::default(),
        }
    }

    /// 直接从单个 `SidPrefixIndex` 实例构造 `SidSource`。
    pub fn from_index(index: SidPrefixIndex) -> Self {
        Self::new(Arc::new(RwLock::new(Arc::new(index))))
    }

    /// 附带自定义召回预算参数的构造函数。
    pub fn with_params(index: Arc<RwLock<Arc<SidPrefixIndex>>>, params: SidRetrieveParams) -> Self {
        Self { index, params }
    }

    /// 原子替换底层前缀索引快照，避免读写长锁阻塞在线检索。
    pub fn replace_index(&self, new_index: SidPrefixIndex) {
        if let Ok(mut guard) = self.index.write() {
            *guard = Arc::new(new_index);
        }
    }

    /// 获取当前只读前缀索引快照指针。
    pub fn index_snapshot(&self) -> Arc<SidPrefixIndex> {
        self.index
            .read()
            .map(|guard| Arc::clone(&guard))
            .unwrap_or_else(|poisoned| Arc::clone(&poisoned.into_inner()))
    }

    /// 判断本次请求是否启用 `SidSource`（对齐 X：`!in_network_only && !has_cached_posts && has_signals`）。
    pub fn enable(&self, query: &RecommendationQueryPayload) -> bool {
        let switch_enabled = if query.feature_switches.contains_key("enable_sid_retrieval") {
            query.feature_switch("enable_sid_retrieval", true)
        } else {
            query.feature_switch("enable_sid_source", true)
        };
        if !switch_enabled || query.in_network_only || query.has_cached_posts == Some(true) {
            return false;
        }
        let snapshot = self.index_snapshot();
        if snapshot.is_empty() {
            return false;
        }
        let (seeds, _) = seeds::extract_positive_seeds(&snapshot, query, self.params.max_seeds);
        !seeds.is_empty()
    }

    /// 提取正反馈种子帖 SID 并执行交错前缀召回，严格执行 `!author_id.is_empty()` Fail-Closed。
    pub fn retrieve(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Vec<RecommendationCandidatePayload> {
        let switch_enabled = if query.feature_switches.contains_key("enable_sid_retrieval") {
            query.feature_switch("enable_sid_retrieval", true)
        } else {
            query.feature_switch("enable_sid_source", true)
        };
        if !switch_enabled || query.in_network_only || query.has_cached_posts == Some(true) {
            return Vec::new();
        }

        let snapshot = self.index_snapshot();
        if snapshot.is_empty() {
            return Vec::new();
        }

        let (extracted_seeds, negative_post_ids) =
            seeds::extract_positive_seeds(&snapshot, query, self.params.max_seeds);
        if extracted_seeds.is_empty() {
            return Vec::new();
        }

        let (raw_candidates, _) =
            snapshot.retrieve_interleaved(&extracted_seeds, &negative_post_ids, &self.params);

        let mut candidates = Vec::with_capacity(raw_candidates.len());
        for hit in raw_candidates {
            // 严格 Fail-Closed：缺失有效 post_id 或 author_id 的脏候选一律拦截丢弃
            if hit.post_id.trim().is_empty() || hit.author_id.trim().is_empty() {
                continue;
            }
            let position = candidates.len() as u32 + 1;
            let depth_score = hit.shared_prefix_depth as f64;
            let created_at =
                DateTime::from_timestamp_millis(hit.created_at_ms).unwrap_or_else(Utc::now);

            candidates.push(RecommendationCandidatePayload {
                post_id: hit.post_id,
                author_id: hit.author_id,
                created_at,
                in_network: Some(false),
                recall_source: Some(SID_SOURCE_NAME.to_string()),
                retrieval_lane: Some(INTEREST_LANE.to_string()),
                semantic_ids: Some(hit.codes),
                retrieval_sources: vec![RetrievalSourcePayload {
                    source_type: SID_SOURCE_NAME.to_string(),
                    cluster: None,
                    score: Some(depth_score),
                    position: Some(position),
                }],
                score: Some(depth_score),
                ..Default::default()
            });
        }

        candidates
    }

    /// 执行召回并返回对应的管道 Stage 可观测载荷。
    pub fn retrieve_with_stage(
        &self,
        query: &RecommendationQueryPayload,
    ) -> (
        Vec<RecommendationCandidatePayload>,
        RecommendationStagePayload,
    ) {
        let started_at = std::time::Instant::now();
        let enabled = self.enable(query);
        let candidates = if enabled {
            self.retrieve(query)
        } else {
            Vec::new()
        };
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let stage = build_sid_source_stage(duration_ms, candidates.len(), enabled);
        (candidates, stage)
    }
}

/// 构造 `SidSource` 的管道阶段追踪信息。
pub fn build_sid_source_stage(
    duration_ms: u64,
    output_count: usize,
    enabled: bool,
) -> RecommendationStagePayload {
    let mut detail = HashMap::new();
    annotate_stage_contract_detail(&mut detail, SID_SOURCE_NAME, PIPELINE_STAGE_KIND_SOURCE);
    annotate_source_stage_detail(&mut detail, SID_SOURCE_NAME, enabled, output_count);

    RecommendationStagePayload {
        name: SID_SOURCE_NAME.to_string(),
        enabled,
        duration_ms,
        input_count: 1,
        output_count,
        removed_count: None,
        detail: Some(detail),
    }
}
