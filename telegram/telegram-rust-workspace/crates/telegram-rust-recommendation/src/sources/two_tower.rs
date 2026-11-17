use std::collections::HashSet;

use telegram_pipeline_primitives::{PIPELINE_STAGE_KIND_SOURCE, annotate_stage_contract_detail};
use telegram_source_primitives::{TWO_TOWER_SOURCE, annotate_source_stage_detail};
use twox_hash::XxHash64;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

#[cfg(test)]
mod tests;

const TWO_TOWER_SOURCE_NAME: &str = TWO_TOWER_SOURCE;

/// 计算帖子 ID 对应的 V3 布隆槽位 64-bit 确定性指纹（与 `bloom_filter_entries` 对齐）。
pub fn v3_bloom_entry_hash(post_id: &str) -> u64 {
    XxHash64::oneshot(0, post_id.as_bytes())
}

/// V3 双塔召回后置下推过滤函数：
/// - 彻底取消对 `isNews`（新闻/非新闻帖）的歧视过滤；
/// - 下推执行 `seen_ids`、`served_ids` 与 `bloom_filter_entries` 曝光去重；
/// - 可选按 `interested_topics` 匹配（保留无 topic 标签候选）；
/// - 完整保留随路 `semantic_ids` 与 `semantic_embedding_256d` 供下游精排与 DPP 核矩阵复用。
pub fn filter_v3_two_tower_candidates(
    candidates: Vec<RecommendationCandidatePayload>,
    query: &RecommendationQueryPayload,
) -> Vec<RecommendationCandidatePayload> {
    if candidates.is_empty() {
        return candidates;
    }

    let mut excluded_ids: HashSet<String> = query.effective_seen_ids().into_iter().collect();
    for id in &query.served_ids {
        if !id.is_empty() {
            excluded_ids.insert(id.clone());
        }
    }

    let bloom_entries: HashSet<u64> = query.bloom_filter_entries.iter().copied().collect();
    let topic_set: Option<HashSet<&str>> = query
        .interested_topics
        .as_ref()
        .filter(|topics| !topics.is_empty())
        .map(|topics| topics.iter().map(String::as_str).collect());

    candidates
        .into_iter()
        .filter(|candidate| {
            // 校验 post_id、model_post_id 与 original_post_id 是否命中 seen/served 或 bloom 槽位
            let ids = [
                Some(candidate.post_id.as_str()),
                candidate.model_post_id.as_deref(),
                candidate.original_post_id.as_deref(),
            ];
            for id in ids.into_iter().flatten() {
                if excluded_ids.contains(id) {
                    return false;
                }
                if !bloom_entries.is_empty()
                    && (bloom_entries.contains(&v3_bloom_entry_hash(id))
                        || id
                            .parse::<u64>()
                            .ok()
                            .is_some_and(|raw| bloom_entries.contains(&raw)))
                {
                    return false;
                }
            }

            if let Some(ref topics) = topic_set
                && !candidate.topic_ids.is_empty()
                && !candidate
                    .topic_ids
                    .iter()
                    .any(|topic| topics.contains(topic.as_str()))
            {
                return false;
            }

            true
        })
        .collect()
}

/// 按用户兴趣话题过滤 TwoTowerSource 候选，保留无话题标签的候选。
pub fn filter_candidates_by_topics(
    candidates: Vec<RecommendationCandidatePayload>,
    query: &RecommendationQueryPayload,
) -> Vec<RecommendationCandidatePayload> {
    let Some(interested_topics) = query.interested_topics.as_ref() else {
        return candidates;
    };
    if interested_topics.is_empty() {
        return candidates;
    }

    let topic_set: HashSet<&str> = interested_topics.iter().map(String::as_str).collect();

    candidates
        .into_iter()
        .filter(|candidate| {
            if candidate.topic_ids.is_empty() {
                return true;
            }
            candidate
                .topic_ids
                .iter()
                .any(|topic| topic_set.contains(topic.as_str()))
        })
        .collect()
}

/// 构造 `TwoTowerSource` 管道阶段追踪载荷。
pub fn build_two_tower_stage(
    duration_ms: u64,
    input_count: usize,
    output_count: usize,
) -> RecommendationStagePayload {
    let mut detail = std::collections::HashMap::new();
    annotate_stage_contract_detail(
        &mut detail,
        TWO_TOWER_SOURCE_NAME,
        PIPELINE_STAGE_KIND_SOURCE,
    );
    annotate_source_stage_detail(&mut detail, TWO_TOWER_SOURCE_NAME, true, output_count);

    RecommendationStagePayload {
        name: TWO_TOWER_SOURCE_NAME.to_string(),
        enabled: true,
        duration_ms,
        input_count,
        output_count,
        removed_count: Some(input_count.saturating_sub(output_count)),
        detail: Some(detail),
    }
}
