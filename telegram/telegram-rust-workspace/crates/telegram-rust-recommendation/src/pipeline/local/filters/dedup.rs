//! 去重过滤器组：负责主帖去重、新闻外部 ID / 聚类去重以及转发去重，同时合并跨路召回溯源。

use std::collections::{HashMap, HashSet};

use serde_json::Value;
use telegram_component_primitives::filters::{
    DUPLICATE_FILTER, NEWS_EXTERNAL_ID_DEDUP_FILTER, RETWEET_DEDUP_FILTER,
};
use telegram_filter_primitives::{
    FILTER_DROP_REASON_DUPLICATE_NEWS_EXTERNAL_ID, FILTER_DROP_REASON_DUPLICATE_POST,
    FILTER_DROP_REASON_RETWEET_DUPLICATE,
};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::super::context::space_feed_experiment_flag;
use super::common::merge_duplicate_provenance;
use super::detail::build_stage;

/// 基于 `post_id` 去重，并在发现重复候选时把它的召回溯源并入首次保留的主候选。
pub(super) fn duplicate_filter(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let mut kept_index_by_id: HashMap<String, usize> = HashMap::new();
    let mut kept = Vec::new();
    let mut removed = Vec::new();

    for candidate in candidates {
        if let Some(&idx) = kept_index_by_id.get(&candidate.post_id) {
            merge_duplicate_provenance(&mut kept[idx], &candidate);
            removed.push(candidate);
        } else {
            let idx = kept.len();
            kept_index_by_id.insert(candidate.post_id.clone(), idx);
            kept.push(candidate);
        }
    }
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            DUPLICATE_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_DUPLICATE_POST),
        ),
        true,
    )
}

/// 基于新闻外部 ID 与可选热点 Cluster ID 去重，避免同一突发事件多条同质推送占满榜单。
pub(super) fn news_external_id_dedup_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let enable_cluster_dedup =
        space_feed_experiment_flag(query, "enable_news_cluster_dedup", false);
    let mut seen_external = HashMap::new();
    let mut seen_cluster = HashSet::new();
    let mut kept = Vec::new();
    let mut removed = Vec::new();

    for candidate in candidates {
        if candidate.is_news != Some(true) {
            kept.push(candidate);
            continue;
        }

        let external_id = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.external_id.clone())
            .or_else(|| candidate.model_post_id.clone())
            .unwrap_or_default();
        let cluster_key = if enable_cluster_dedup {
            candidate
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.cluster_id)
                .map(|cluster_id| cluster_id.to_string())
                .unwrap_or_default()
        } else {
            String::new()
        };

        if !external_id.is_empty()
            && let Some(&idx) = seen_external.get(&external_id)
        {
            merge_duplicate_provenance(&mut kept[idx], &candidate);
            removed.push(candidate);
            continue;
        }
        if !cluster_key.is_empty() && !seen_cluster.insert(cluster_key) {
            removed.push(candidate);
            continue;
        }

        let idx = kept.len();
        if !external_id.is_empty() {
            seen_external.insert(external_id, idx);
        }
        kept.push(candidate);
    }
    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert(
        "clusterDedupEnabled".to_string(),
        Value::Bool(enable_cluster_dedup),
    );

    (
        kept,
        removed,
        build_stage(
            NEWS_EXTERNAL_ID_DEDUP_FILTER,
            input_count,
            removed_count,
            Some(detail),
            Some(FILTER_DROP_REASON_DUPLICATE_NEWS_EXTERNAL_ID),
        ),
        true,
    )
}

/// 基于原帖 ID (`original_post_id`) 对转发帖去重，并保留多路召回溯源信息。
pub(super) fn retweet_dedup_filter(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let mut kept_index_by_canonical: HashMap<String, usize> = HashMap::new();
    let mut kept = Vec::new();
    let mut removed = Vec::new();

    for candidate in candidates {
        let canonical = candidate
            .original_post_id
            .clone()
            .unwrap_or_else(|| candidate.post_id.clone());
        if let Some(&idx) = kept_index_by_canonical.get(&canonical) {
            merge_duplicate_provenance(&mut kept[idx], &candidate);
            removed.push(candidate);
        } else {
            let idx = kept.len();
            kept_index_by_canonical.insert(canonical, idx);
            kept.push(candidate);
        }
    }
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            RETWEET_DEDUP_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_RETWEET_DUPLICATE),
        ),
        true,
    )
}
