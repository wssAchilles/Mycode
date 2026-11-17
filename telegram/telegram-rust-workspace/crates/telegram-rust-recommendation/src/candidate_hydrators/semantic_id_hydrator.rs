//! Semantic ID 候选水合器（对标 x-algorithm `candidate_hydrators/semantic_id_hydrator.rs`）。
//!
//! 依托本地 `SidPrefixIndex` 为非 SID 召回源产出的候选补齐缺失的 6x256 `semantic_ids`，
//! 并同步填充 `SlateContextPayload` 中的 `sid_known`、L1~L3 前缀码词与前序共前缀间隔统计。

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

use serde_json::Value;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
    SlateContextPayload,
};
use crate::state::sid_index::{
    SID_LEVELS, SidPrefixIndex, codes_from_key, is_valid_sid_code, pack_full_key,
};

#[cfg(test)]
mod tests;

/// `SemanticIdHydrator` 标准组件名称。
pub const SEMANTIC_ID_HYDRATOR_NAME: &str = "SemanticIdCandidateHydrator";

/// 单次批量水合产出的 Semantic ID 覆盖率与前缀分布统计。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SemanticIdHydrationStats {
    pub total_candidates: usize,
    pub already_had_sid: usize,
    pub hydrated_from_index: usize,
    pub missing_sid: usize,
    pub sid_known_count: usize,
    pub unique_l1_prefixes: usize,
    pub unique_l2_prefixes: usize,
    pub unique_l3_prefixes: usize,
    pub l1_prefix_counts: HashMap<u32, usize>,
}

/// 利用进程内 `SidPrefixIndex` 补齐候选 `semantic_ids` 与 `SlateContextPayload` 统计的水合器。
#[derive(Clone, Debug)]
pub struct SemanticIdHydrator {
    index: Arc<RwLock<Arc<SidPrefixIndex>>>,
}

impl SemanticIdHydrator {
    /// 共享读写锁指针构造水合器。
    pub fn new(index: Arc<RwLock<Arc<SidPrefixIndex>>>) -> Self {
        Self { index }
    }

    /// 直接从单个 `SidPrefixIndex` 构造水合器。
    pub fn from_index(index: SidPrefixIndex) -> Self {
        Self::new(Arc::new(RwLock::new(Arc::new(index))))
    }

    /// 返回水合器注册名。
    pub fn name() -> &'static str {
        SEMANTIC_ID_HYDRATOR_NAME
    }

    /// 原子更新内部共享 `SidPrefixIndex` 快照。
    pub fn replace_index(&self, new_index: SidPrefixIndex) {
        if let Ok(mut guard) = self.index.write() {
            *guard = Arc::new(new_index);
        }
    }

    /// 读取只读 `SidPrefixIndex` 快照。
    pub fn index_snapshot(&self) -> Arc<SidPrefixIndex> {
        self.index
            .read()
            .map(|guard| Arc::clone(&guard))
            .unwrap_or_else(|poisoned| Arc::clone(&poisoned.into_inner()))
    }

    /// 判断本次查询是否启用 Semantic ID 水合（对齐 X：缓存短路时跳过）。
    pub fn enable(&self, query: &RecommendationQueryPayload) -> bool {
        query.has_cached_posts != Some(true)
            && query.feature_switch("enable_semantic_id_hydration", true)
    }

    /// 对单条候选执行 `semantic_ids` 补齐与基础 `SlateContextPayload` 填充；若由索引补齐则返回 `true`。
    pub fn hydrate_candidate(&self, candidate: &mut RecommendationCandidatePayload) -> bool {
        let index = self.index_snapshot();
        let hydrated = fill_missing_sid_from_index(&index, candidate);
        let slate = candidate
            .slate_context
            .get_or_insert_with(|| Box::new(SlateContextPayload::default()));
        if let Some((l1, l2, l3)) = extract_prefix_codes(candidate.semantic_ids.as_ref()) {
            slate.sid_known = Some(true);
            slate.sid_k_l1 = Some(l1);
            slate.sid_k_l2 = Some(l2);
            slate.sid_k_l3 = Some(l3);
        } else {
            slate.sid_known = Some(false);
            slate.sid_k_l1 = None;
            slate.sid_k_l2 = None;
            slate.sid_k_l3 = None;
        }
        hydrated
    }

    /// 批量补齐候选切片中的缺失 `semantic_ids`，并按序统计 `sid_known`、L1~L3 前缀码与同前缀间隔。
    pub fn hydrate(
        &self,
        candidates: &mut [RecommendationCandidatePayload],
    ) -> SemanticIdHydrationStats {
        let index = self.index_snapshot();
        let mut stats = SemanticIdHydrationStats {
            total_candidates: candidates.len(),
            ..Default::default()
        };

        let mut last_l1: HashMap<u32, usize> = HashMap::new();
        let mut last_l2: HashMap<(u32, u32), usize> = HashMap::new();
        let mut last_l3: HashMap<(u32, u32, u32), usize> = HashMap::new();
        let mut unique_l2 = HashSet::new();
        let mut unique_l3 = HashSet::new();

        for (idx, candidate) in candidates.iter_mut().enumerate() {
            let had_full_sid = candidate
                .semantic_ids
                .as_ref()
                .is_some_and(|codes| pack_full_key(codes).is_some());
            if had_full_sid {
                stats.already_had_sid += 1;
            } else if fill_missing_sid_from_index(&index, candidate) {
                stats.hydrated_from_index += 1;
            } else if extract_prefix_codes(candidate.semantic_ids.as_ref()).is_none() {
                stats.missing_sid += 1;
            }

            let slate = candidate
                .slate_context
                .get_or_insert_with(|| Box::new(SlateContextPayload::default()));
            if slate.k.is_none() {
                slate.k = Some(idx as u32);
            }

            if let Some((l1, l2, l3)) = extract_prefix_codes(candidate.semantic_ids.as_ref()) {
                stats.sid_known_count += 1;
                *stats.l1_prefix_counts.entry(l1).or_insert(0) += 1;
                unique_l2.insert((l1, l2));
                unique_l3.insert((l1, l2, l3));

                slate.sid_known = Some(true);
                slate.sid_k_l1 = Some(l1);
                slate.sid_k_l2 = Some(l2);
                slate.sid_k_l3 = Some(l3);
                slate.sid_gap_l1 = last_l1.insert(l1, idx).map(|prev| (idx - prev) as i32);
                slate.sid_gap_l2 = last_l2
                    .insert((l1, l2), idx)
                    .map(|prev| (idx - prev) as i32);
                slate.sid_gap_l3 = last_l3
                    .insert((l1, l2, l3), idx)
                    .map(|prev| (idx - prev) as i32);
            } else {
                slate.sid_known = Some(false);
                slate.sid_k_l1 = None;
                slate.sid_k_l2 = None;
                slate.sid_k_l3 = None;
                slate.sid_gap_l1 = None;
                slate.sid_gap_l2 = None;
                slate.sid_gap_l3 = None;
            }
        }

        stats.unique_l1_prefixes = stats.l1_prefix_counts.len();
        stats.unique_l2_prefixes = unique_l2.len();
        stats.unique_l3_prefixes = unique_l3.len();
        stats
    }

    /// 结合查询开关执行批量水合，并返回包含前缀覆盖率明细的 Stage 载荷。
    pub fn hydrate_with_stage(
        &self,
        query: &RecommendationQueryPayload,
        candidates: &mut [RecommendationCandidatePayload],
    ) -> RecommendationStagePayload {
        let started_at = std::time::Instant::now();
        let input_count = candidates.len();
        let enabled = self.enable(query);
        if !enabled {
            return RecommendationStagePayload {
                name: SEMANTIC_ID_HYDRATOR_NAME.to_string(),
                enabled: false,
                duration_ms: 0,
                input_count,
                output_count: input_count,
                removed_count: None,
                detail: None,
            };
        }

        let stats = self.hydrate(candidates);
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let detail = HashMap::from([
            (
                "alreadyHadSidCount".to_string(),
                Value::from(stats.already_had_sid as u64),
            ),
            (
                "hydratedFromIndexCount".to_string(),
                Value::from(stats.hydrated_from_index as u64),
            ),
            (
                "missingSidCount".to_string(),
                Value::from(stats.missing_sid as u64),
            ),
            (
                "sidKnownCount".to_string(),
                Value::from(stats.sid_known_count as u64),
            ),
            (
                "uniqueL1Prefixes".to_string(),
                Value::from(stats.unique_l1_prefixes as u64),
            ),
            (
                "uniqueL2Prefixes".to_string(),
                Value::from(stats.unique_l2_prefixes as u64),
            ),
            (
                "uniqueL3Prefixes".to_string(),
                Value::from(stats.unique_l3_prefixes as u64),
            ),
        ]);

        RecommendationStagePayload {
            name: SEMANTIC_ID_HYDRATOR_NAME.to_string(),
            enabled: true,
            duration_ms,
            input_count,
            output_count: input_count,
            removed_count: None,
            detail: Some(detail),
        }
    }
}

fn fill_missing_sid_from_index(
    index: &SidPrefixIndex,
    candidate: &mut RecommendationCandidatePayload,
) -> bool {
    if candidate
        .semantic_ids
        .as_ref()
        .is_some_and(|codes| pack_full_key(codes).is_some())
    {
        return false;
    }

    let lookup_keys = [
        Some(candidate.post_id.as_str()),
        candidate.original_post_id.as_deref(),
        candidate.model_post_id.as_deref(),
    ];
    for id in lookup_keys.into_iter().flatten() {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((key, _)) = index.lookup(trimmed) {
            candidate.semantic_ids = Some(codes_from_key(key));
            return true;
        }
    }
    false
}

fn extract_prefix_codes(semantic_ids: Option<&[i32; SID_LEVELS]>) -> Option<(u32, u32, u32)> {
    let codes = semantic_ids?;
    if !codes[..3].iter().all(|&c| is_valid_sid_code(c)) {
        return None;
    }
    Some((codes[0] as u32, codes[1] as u32, codes[2] as u32))
}
