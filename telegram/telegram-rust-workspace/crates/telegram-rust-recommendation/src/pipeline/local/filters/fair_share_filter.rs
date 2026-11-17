//! 公平配额精排前过滤器（对标 `x-algorithm/home-mixer/filters/fair_share_ranking_filter.rs`）。
//! 当召回与前置过滤后的候选总数超出精排预算上限时，基于 `u128` 最大余数法（Hamilton 方法）
//! 按候选所属召回源等比分配精排配额，防止单路大召回源挤占全部精排预算。

use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::super::context::{space_feed_experiment_flag, space_feed_experiment_number};
use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

/// 公平配额过滤阶段名称。
pub const FAIR_SHARE_RANKING_FILTER: &str = "FairShareRankingFilter";

/// 默认精排候选预算上限（对标 `x-algorithm` 中 `PhoenixScoresResultSize` 默认值 1000）。
pub const DEFAULT_FAIR_SHARE_RANKING_BUDGET: usize = 1000;

/// 触发公平配额裁剪时的丢弃原因标识。
pub const FILTER_DROP_REASON_FAIR_SHARE_BUDGET: &str = "fair_share_budget_exceeded";

/// 判断公平配额过滤器是否启用（默认开启，可由特性开关或实验配置控制）。
pub fn is_fair_share_enabled(query: &RecommendationQueryPayload) -> bool {
    if let Some(&enabled) = query.feature_switches.get("enable_fair_share_ranking") {
        if !enabled {
            return false;
        }
    } else if let Some(&enabled) = query
        .feature_switches
        .get("rust_home_mixer_enable_fair_share_ranking")
    {
        if !enabled {
            return false;
        }
    } else if !space_feed_experiment_flag(query, "enable_fair_share_ranking", true) {
        return false;
    }

    // 与 x-algorithm 一致，支持通过开关在缓存命中场景短路跳过
    if space_feed_experiment_flag(query, "fair_share_respect_cached_posts", false)
        && query.has_cached_posts == Some(true)
    {
        return false;
    }

    true
}

/// 读取当前请求的精排候选预算上限。
pub fn fair_share_budget(query: &RecommendationQueryPayload) -> usize {
    let explicit = space_feed_experiment_number(query, "fair_share_ranking_budget", f64::NAN);
    if explicit.is_finite() && explicit >= 0.0 {
        return explicit.round() as usize;
    }

    let phoenix_size = space_feed_experiment_number(
        query,
        "phoenix_scores_result_size",
        DEFAULT_FAIR_SHARE_RANKING_BUDGET as f64,
    );
    if phoenix_size.is_finite() && phoenix_size >= 0.0 {
        phoenix_size.round() as usize
    } else {
        DEFAULT_FAIR_SHARE_RANKING_BUDGET
    }
}

/// 提取候选用于公平配额分组的召回源键：优先取 `recall_source`，缺失时回退至 `retrieval_sources[0].source_type`。
pub fn candidate_recall_source_group(candidate: &RecommendationCandidatePayload) -> Option<String> {
    candidate
        .recall_source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            candidate
                .retrieval_sources
                .first()
                .map(|source| source.source_type.trim())
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
}

/// 按候选召回源首次出现顺序聚合各组对应的候选索引列表。
fn group_by_recall_source(
    candidates: &[RecommendationCandidatePayload],
) -> (Vec<Option<String>>, Vec<Vec<usize>>) {
    let mut keys: Vec<Option<String>> = Vec::new();
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut key_to_group_idx: HashMap<Option<String>, usize> = HashMap::new();

    for (index, candidate) in candidates.iter().enumerate() {
        let key = candidate_recall_source_group(candidate);
        if let Some(&group_idx) = key_to_group_idx.get(&key) {
            groups[group_idx].push(index);
        } else {
            let group_idx = groups.len();
            key_to_group_idx.insert(key.clone(), group_idx);
            keys.push(key);
            groups.push(vec![index]);
        }
    }

    (keys, groups)
}

/// 使用 `u128` 最大余数法（Hamilton 方法）按各组需求等比分配总预算 `budget`。
/// 当总需求未超过 `budget` 或 `total == 0` 时原样返回各组需求。
pub fn fair_share_counts(counts: &[usize], budget: usize) -> Vec<usize> {
    let total: usize = counts.iter().copied().sum();
    if total == 0 || total <= budget {
        return counts.to_vec();
    }
    if budget == 0 {
        return vec![0; counts.len()];
    }

    let total_u = total as u128;
    let budget_u = budget as u128;
    let mut alloc = Vec::with_capacity(counts.len());
    let mut remainders = Vec::with_capacity(counts.len());
    let mut assigned = 0usize;

    for (index, &count) in counts.iter().enumerate() {
        let product = (count as u128) * budget_u;
        let keep = (product / total_u) as usize;
        alloc.push(keep);
        assigned += keep;
        remainders.push((product % total_u, index));
    }

    // 余数从大到小排序；余数相同时按分组首次出现下标升序稳定打破平局
    remainders.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));

    let mut leftover = budget.saturating_sub(assigned);
    for (_, index) in remainders {
        if leftover == 0 {
            break;
        }
        if alloc[index] < counts[index] {
            alloc[index] += 1;
            leftover -= 1;
        }
    }

    alloc
}

/// 生成保序选留掩码，并返回分组明细供阶段可观测统计。
fn selection_mask_with_allocations(
    candidates: &[RecommendationCandidatePayload],
    budget: usize,
) -> (Vec<bool>, Value) {
    let (keys, groups) = group_by_recall_source(candidates);
    let demands: Vec<usize> = groups.iter().map(Vec::len).collect();
    let keep = fair_share_counts(&demands, budget);

    let mut selected = vec![false; candidates.len()];
    let mut allocations = Map::new();

    for ((key, group), (&demand_count, &keep_count)) in
        keys.iter().zip(&groups).zip(demands.iter().zip(&keep))
    {
        for &index in group.iter().take(keep_count) {
            selected[index] = true;
        }
        let label = key.as_deref().unwrap_or("unknown");
        let mut entry = Map::new();
        entry.insert("input".to_string(), Value::from(demand_count as u64));
        entry.insert("kept".to_string(), Value::from(keep_count as u64));
        allocations.insert(label.to_string(), Value::Object(entry));
    }

    (selected, Value::Object(allocations))
}

/// 按指定预算执行公平配额过滤并返回分区结果与 stage 元数据（便于单测与精确预算控制）。
pub fn fair_share_filter_with_budget(
    candidates: Vec<RecommendationCandidatePayload>,
    budget: usize,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
) {
    let input_count = candidates.len();
    let (selected, allocations) = selection_mask_with_allocations(&candidates, budget);
    let mut mask_iter = selected.into_iter();
    let (kept, removed) = partition(candidates, |_| mask_iter.next().unwrap_or(false));
    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert("budget".to_string(), Value::from(budget as u64));
    detail.insert("keptCount".to_string(), Value::from(kept.len() as u64));
    detail.insert("groupAllocations".to_string(), allocations);

    let stage = build_stage(
        FAIR_SHARE_RANKING_FILTER,
        input_count,
        removed_count,
        Some(detail),
        Some(FILTER_DROP_REASON_FAIR_SHARE_BUDGET),
    );

    (kept, removed, stage)
}

/// 按查询实验开关与精排预算执行公平配额过滤。
pub fn fair_share_ranking_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    if !is_fair_share_enabled(query) {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(FAIR_SHARE_RANKING_FILTER, input_count),
            false,
        );
    }

    let budget = fair_share_budget(query);
    let (kept, removed, stage) = fair_share_filter_with_budget(candidates, budget);
    (kept, removed, stage, true)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::Utc;
    use serde_json::json;
    use telegram_pipeline_primitives::PIPELINE_SPACE_FEED_EXPERIMENT_ID;

    use crate::contracts::{
        ExperimentAssignmentPayload, ExperimentContextPayload, RecommendationCandidatePayload,
        RecommendationQueryPayload, RetrievalSourcePayload,
    };

    use super::{
        FAIR_SHARE_RANKING_FILTER, FILTER_DROP_REASON_FAIR_SHARE_BUDGET, fair_share_counts,
        fair_share_filter_with_budget, fair_share_ranking_filter,
    };

    fn make_candidate(
        post_id: &str,
        recall_source: Option<&str>,
        retrieval_source: Option<&str>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            author_id: format!("author-{post_id}"),
            content: "fair share candidate".to_string(),
            created_at: Utc::now(),
            recall_source: recall_source.map(ToOwned::to_owned),
            retrieval_sources: retrieval_source
                .map(|src| {
                    vec![RetrievalSourcePayload {
                        source_type: src.to_string(),
                        cluster: None,
                        score: Some(0.8),
                        position: Some(0),
                    }]
                })
                .unwrap_or_default(),
            ..Default::default()
        }
    }

    fn base_query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-fair-share".to_string(),
            decision_id: "00000000-0000-4000-8000-0000000000aa".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            ..Default::default()
        }
    }

    #[test]
    fn hamilton_fair_share_matches_x_algorithm_proportional_drop() {
        // 对标 x-algorithm 单测：440 / 220 / 440 在 budget=1000 下精准保留 400 / 200 / 400
        let mut pool = Vec::new();
        for i in 0..440 {
            pool.push(make_candidate(
                &format!("in-{i}"),
                Some("FollowingSource"),
                Some("FollowingSource"),
            ));
        }
        for i in 0..220 {
            pool.push(make_candidate(
                &format!("sim-{i}"),
                None,
                Some("TwoTowerSource"),
            ));
        }
        for i in 0..440 {
            pool.push(make_candidate(
                &format!("phx-{i}"),
                Some("GraphSource"),
                None,
            ));
        }

        let (kept, removed, stage) = fair_share_filter_with_budget(pool, 1000);
        assert_eq!(stage.name, FAIR_SHARE_RANKING_FILTER);
        assert_eq!(kept.len(), 1000);
        assert_eq!(removed.len(), 100);
        assert_eq!(stage.removed_count, Some(100));

        let in_kept = kept.iter().filter(|c| c.post_id.starts_with("in-")).count();
        let sim_kept = kept
            .iter()
            .filter(|c| c.post_id.starts_with("sim-"))
            .count();
        let phx_kept = kept
            .iter()
            .filter(|c| c.post_id.starts_with("phx-"))
            .count();
        assert_eq!((in_kept, sim_kept, phx_kept), (400, 200, 400));
    }

    #[test]
    fn fair_share_counts_uses_hamilton_largest_remainder_and_no_u128_overflow() {
        // 测试不可整除场景的最大余数分配：10 / 10 / 10，budget = 10 -> 4 / 3 / 3
        assert_eq!(fair_share_counts(&[10, 10, 10], 10), vec![4, 3, 3]);
        // 余数明显不同：7 / 3 / 1 (total=11), budget=5 -> exact: 35/11=3(rem 2), 15/11=1(rem 4), 5/11=0(rem 5)
        // 剩余 1 个名额给余数最大的索引 2 -> [3, 1, 1]
        assert_eq!(fair_share_counts(&[7, 3, 1], 5), vec![3, 1, 1]);
        // 总需求小于等于 budget 时全保留
        assert_eq!(fair_share_counts(&[5, 8], 20), vec![5, 8]);
        // 预算为 0 时全清零
        assert_eq!(fair_share_counts(&[5, 8], 0), vec![0, 0]);
        // 大规模计数下 u128 乘法不会发生整数溢出
        let huge = (usize::MAX / 4).min(1_000_000_000_000);
        let alloc = fair_share_counts(&[huge, huge], 1000);
        assert_eq!(alloc, vec![500, 500]);
    }

    #[test]
    fn fair_share_filter_respects_experiment_toggle_and_budget_override() {
        let mut query = base_query();
        query.experiment_context = Some(ExperimentContextPayload {
            user_id: "viewer-1".to_string(),
            assignments: vec![ExperimentAssignmentPayload {
                experiment_id: PIPELINE_SPACE_FEED_EXPERIMENT_ID.to_string(),
                experiment_name: "fair_share_test".to_string(),
                bucket: "treatment".to_string(),
                config: HashMap::from([
                    ("enable_fair_share_ranking".to_string(), json!(true)),
                    ("fair_share_ranking_budget".to_string(), json!(4)),
                ]),
                in_experiment: true,
            }],
        });

        let pool = vec![
            make_candidate("a1", Some("PopularSource"), None),
            make_candidate("a2", Some("PopularSource"), None),
            make_candidate("a3", Some("PopularSource"), None),
            make_candidate("a4", Some("PopularSource"), None),
            make_candidate("b1", Some("GraphSource"), None),
            make_candidate("b2", Some("GraphSource"), None),
        ];

        let (kept, removed, stage, enabled) = fair_share_ranking_filter(&query, pool.clone());
        assert!(enabled);
        assert_eq!(kept.len(), 4);
        assert_eq!(removed.len(), 2);
        assert_eq!(stage.removed_count, Some(2));
        assert_eq!(
            kept.iter()
                .filter(|c| c.recall_source.as_deref() == Some("GraphSource"))
                .count(),
            1
        );
        assert_eq!(
            kept.iter()
                .filter(|c| c.recall_source.as_deref() == Some("PopularSource"))
                .count(),
            3
        );
        let detail = stage.detail.expect("stage detail");
        assert_eq!(
            detail.get("dropReasonCounts"),
            Some(&json!({ FILTER_DROP_REASON_FAIR_SHARE_BUDGET: 2 }))
        );

        // 通过 feature_switches 关闭开关时完全禁用且不移除任何候选
        query
            .feature_switches
            .insert("enable_fair_share_ranking".to_string(), false);
        let (kept_disabled, removed_disabled, stage_disabled, enabled_flag) =
            fair_share_ranking_filter(&query, pool);
        assert!(!enabled_flag);
        assert!(!stage_disabled.enabled);
        assert_eq!(kept_disabled.len(), 6);
        assert!(removed_disabled.is_empty());
    }
}
