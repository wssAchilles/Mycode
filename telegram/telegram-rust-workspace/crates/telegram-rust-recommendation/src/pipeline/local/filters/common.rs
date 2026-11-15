use std::collections::HashSet;

use crate::contracts::RecommendationCandidatePayload;

/// 复用基础过滤原语的保序分区实现，避免在业务层重复维护分区循环。
pub(super) fn partition(
    candidates: Vec<RecommendationCandidatePayload>,
    keep: impl Fn(&RecommendationCandidatePayload) -> bool,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
) {
    let result = telegram_filter_primitives::FilterResult::partition(candidates, keep);
    (result.kept, result.removed)
}

/// 在去重保留主候选时合并重复候选的召回溯源，防止后续特征丢失跨路召回信号。
pub(super) fn merge_duplicate_provenance(
    primary: &mut RecommendationCandidatePayload,
    duplicate: &RecommendationCandidatePayload,
) {
    let primary_source = primary.recall_source.as_deref().unwrap_or("");
    let mut seen = HashSet::new();
    let mut merged = Vec::new();

    if let Some(existing) = &primary.secondary_recall_sources {
        for source in existing {
            let trimmed = source.trim();
            if !trimmed.is_empty() && trimmed != primary_source && seen.insert(trimmed.to_string())
            {
                merged.push(trimmed.to_string());
            }
        }
    }

    let dup_primary = duplicate.recall_source.as_deref().unwrap_or("").trim();
    if !dup_primary.is_empty()
        && dup_primary != primary_source
        && seen.insert(dup_primary.to_string())
    {
        merged.push(dup_primary.to_string());
    }

    if let Some(dup_secondary) = &duplicate.secondary_recall_sources {
        for source in dup_secondary {
            let trimmed = source.trim();
            if !trimmed.is_empty() && trimmed != primary_source && seen.insert(trimmed.to_string())
            {
                merged.push(trimmed.to_string());
            }
        }
    }

    primary.secondary_recall_sources = (!merged.is_empty()).then_some(merged);

    // 合并 V3 结构化多源检索明细（按 source_type + cluster 去重保留最优位次与分数）
    let mut source_seen: HashSet<(String, Option<i64>)> = HashSet::new();
    let mut merged_retrieval_sources = Vec::new();
    for entry in primary
        .retrieval_sources
        .iter()
        .chain(duplicate.retrieval_sources.iter())
    {
        let trimmed_type = entry.source_type.trim();
        if trimmed_type.is_empty() {
            continue;
        }
        if source_seen.insert((trimmed_type.to_string(), entry.cluster)) {
            let mut normalized = entry.clone();
            normalized.source_type = trimmed_type.to_string();
            merged_retrieval_sources.push(normalized);
        }
    }
    primary.retrieval_sources = merged_retrieval_sources;

    if primary.semantic_ids.is_none() {
        primary.semantic_ids = duplicate.semantic_ids;
    }
    if primary.in_network != Some(true) && duplicate.in_network == Some(true) {
        primary.in_network = Some(true);
    }
    if primary.author_affinity_score.is_none() {
        primary.author_affinity_score = duplicate.author_affinity_score;
    }
}
