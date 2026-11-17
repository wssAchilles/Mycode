//! 请求级预缓存候选短路召回源（对标 x-algorithm `home-mixer/sources/cached_posts_source.rs`）。
//!
//! 与负责 Redis 单源结果缓存的 `sources::cached_posts`（`SourceCache`）职责隔离：
//! 本模块仅在 `query.has_cached_posts == Some(true)` 且 `query.cached_posts` 非空时
//! 直接物化返回查询自带的预缓存帖子切片，支撑多路重召回的短路提速。

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde_json::Value;
use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SOURCE, annotate_stage_contract_detail};
use telegram_source_primitives::{
    IN_NETWORK_LANE, annotate_source_stage_detail, source_retrieval_lane,
};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
    RetrievalSourcePayload,
};

/// 查询短路缓存召回源标识。
pub const CACHED_POSTS_SHORT_CIRCUIT_SOURCE: &str = "CachedPostsSource";

/// 基于 `RecommendationQueryPayload.cached_posts` 的短路召回源。
#[derive(Clone, Copy, Debug, Default)]
pub struct CachedPostsSource;

/// 语义化别名，显式区分于 `sources::cached_posts::CachedPostsSource`。
pub type QueryCachedPostsSource = CachedPostsSource;

impl CachedPostsSource {
    /// 判断查询是否满足缓存短路召回条件。
    pub fn should_short_circuit(query: &RecommendationQueryPayload) -> bool {
        query.has_cached_posts == Some(true) && !query.cached_posts.is_empty()
    }

    /// 是否启用短路召回源。
    pub fn enable(&self, query: &RecommendationQueryPayload) -> bool {
        Self::should_short_circuit(query)
    }

    /// 当命中查询缓存切片时直接返回标准化的候选列表，否则返回空列表。
    pub fn retrieve(
        &self,
        query: &RecommendationQueryPayload,
    ) -> Vec<RecommendationCandidatePayload> {
        if !self.enable(query) {
            return Vec::new();
        }

        let mut seen_post_ids = HashSet::with_capacity(query.cached_posts.len());
        let mut candidates = Vec::with_capacity(query.cached_posts.len());

        for entry in &query.cached_posts {
            let post_id = entry.post_id.trim();
            let author_id = entry.author_id.trim();
            if post_id.is_empty() || author_id.is_empty() || !seen_post_ids.insert(post_id) {
                continue;
            }

            let recall_source = entry
                .recall_source
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(CACHED_POSTS_SHORT_CIRCUIT_SOURCE);
            let lane = source_retrieval_lane(recall_source);
            let position = candidates.len() as u32 + 1;
            let created_at =
                DateTime::from_timestamp_millis(entry.created_at_ms).unwrap_or_else(Utc::now);

            candidates.push(RecommendationCandidatePayload {
                post_id: post_id.to_string(),
                author_id: author_id.to_string(),
                created_at,
                in_network: Some(lane == IN_NETWORK_LANE),
                recall_source: Some(recall_source.to_string()),
                retrieval_lane: Some(lane.to_string()),
                semantic_ids: entry.semantic_ids,
                retrieval_sources: vec![RetrievalSourcePayload {
                    source_type: CACHED_POSTS_SHORT_CIRCUIT_SOURCE.to_string(),
                    cluster: None,
                    score: None,
                    position: Some(position),
                }],
                ..Default::default()
            });
        }

        candidates
    }

    /// 执行短路召回并产出标准 Stage 明细。
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

        let mut detail = HashMap::from([(
            "shortCircuit".to_string(),
            Value::Bool(enabled && !candidates.is_empty()),
        )]);
        annotate_stage_contract_detail(
            &mut detail,
            CACHED_POSTS_SHORT_CIRCUIT_SOURCE,
            PIPELINE_STAGE_KIND_SOURCE,
        );
        annotate_source_stage_detail(
            &mut detail,
            CACHED_POSTS_SHORT_CIRCUIT_SOURCE,
            enabled,
            candidates.len(),
        );

        let stage = RecommendationStagePayload {
            name: CACHED_POSTS_SHORT_CIRCUIT_SOURCE.to_string(),
            enabled,
            duration_ms,
            input_count: query.cached_posts.len(),
            output_count: candidates.len(),
            removed_count: Some(query.cached_posts.len().saturating_sub(candidates.len())),
            detail: Some(detail),
        };
        (candidates, stage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::CachedPostEntryPayload;

    fn cached_entry(post_id: &str, author_id: &str) -> CachedPostEntryPayload {
        CachedPostEntryPayload {
            post_id: post_id.to_string(),
            author_id: author_id.to_string(),
            created_at_ms: 1_763_179_800_000,
            semantic_ids: Some([12, 87, 203, 5, 199, 64]),
            recall_source: Some("FollowingSource".to_string()),
        }
    }

    #[test]
    fn short_circuits_when_has_cached_posts_true_and_non_empty() {
        let source = CachedPostsSource;
        let query = RecommendationQueryPayload {
            user_id: "viewer-1".to_string(),
            has_cached_posts: Some(true),
            cached_posts: vec![
                cached_entry("p1", "a1"),
                cached_entry("p1", "a1"), // 重复项去重
                cached_entry("p2", "a2"),
            ],
            ..Default::default()
        };

        assert!(source.enable(&query));
        let (candidates, stage) = source.retrieve_with_stage(&query);
        assert!(stage.enabled);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].post_id, "p1");
        assert_eq!(candidates[0].semantic_ids, Some([12, 87, 203, 5, 199, 64]));
        assert_eq!(
            candidates[0].recall_source.as_deref(),
            Some("FollowingSource")
        );
        assert_eq!(
            candidates[0].retrieval_sources[0].source_type,
            CACHED_POSTS_SHORT_CIRCUIT_SOURCE
        );
        assert_eq!(candidates[0].in_network, Some(true));
    }

    #[test]
    fn disables_when_flag_false_none_or_cached_posts_empty() {
        let source = CachedPostsSource;

        let empty_query = RecommendationQueryPayload {
            has_cached_posts: Some(true),
            cached_posts: Vec::new(),
            ..Default::default()
        };
        assert!(!source.enable(&empty_query));
        assert!(source.retrieve(&empty_query).is_empty());

        let flag_false_query = RecommendationQueryPayload {
            has_cached_posts: Some(false),
            cached_posts: vec![cached_entry("p1", "a1")],
            ..Default::default()
        };
        assert!(!source.enable(&flag_false_query));
        assert!(source.retrieve(&flag_false_query).is_empty());

        let flag_none_query = RecommendationQueryPayload {
            has_cached_posts: None,
            cached_posts: vec![cached_entry("p1", "a1")],
            ..Default::default()
        };
        assert!(!source.enable(&flag_none_query));
    }
}
