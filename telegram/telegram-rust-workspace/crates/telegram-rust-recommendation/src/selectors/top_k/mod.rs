use std::collections::HashMap;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::signals::user_actions::UserActionProfile;
use crate::selectors::dpp_ranker::kernel::{
    avg_adjacent_cosine, avg_pairwise_cosine, build_dpp_input_from_candidate,
};
use crate::selectors::dpp_ranker::{
    DppConfig, DppMetrics, populate_slate_contexts, rerank_candidates,
};

mod audit;
mod candidates;
mod constraints;
mod detail;
mod fill;
mod output;
mod report;
mod stage_payload;
mod state;
#[cfg(test)]
mod tests;

pub use audit::{SelectorAuditSnapshot, build_selector_audit};
pub use candidates::sort_candidates;
pub use detail::{build_selector_stage_detail, build_selector_stage_detail_with_dpp};
pub use report::{SelectorSelectionOutput, SelectorSelectionReport};
pub(crate) use stage_payload::{
    SelectorStageInput, build_selector_stage, build_selector_stage_with_dpp,
};

use constraints::{SelectorSoftCaps, selector_constraints, window_factor};
use fill::{run_relaxed_selection_phases, run_required_selection_phases};
use output::{
    annotate_in_network_selector_selection_metadata, annotate_selector_rank_provenance,
    build_selector_output,
};
use report::first_blocking_reason;
use state::SelectionState;
pub use telegram_selector_primitives::{
    SELECTOR_AUDIT_VERSION, SELECTOR_CONSTRAINT_VERSION, SELECTOR_POLICY_VERSION,
    SELECTOR_SCORE_SOURCE_VERSION, SELECTOR_SELECTION_MODE_IN_NETWORK_RECENCY,
    SELECTOR_SELECTION_MODE_POLICY_STATE_MACHINE, selector_phase_plan_snapshot,
    selector_selection_report_contract_violations, selector_target_size,
};

pub fn select_candidates(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    oversample_factor: usize,
    max_size: usize,
    author_soft_cap: usize,
) -> Vec<RecommendationCandidatePayload> {
    select_candidates_with_report(
        query,
        candidates,
        oversample_factor,
        max_size,
        author_soft_cap,
    )
    .candidates
}

pub fn select_candidates_with_report(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    oversample_factor: usize,
    max_size: usize,
    author_soft_cap: usize,
) -> SelectorSelectionOutput {
    let target_size = selector_target_size(query.limit, oversample_factor, max_size);
    let mut sorted = candidates.to_vec();
    sort_candidates(&mut sorted, query.in_network_only);
    if query.in_network_only {
        sorted.truncate(target_size);
        let sorted_reference = sorted.clone();
        annotate_selector_rank_provenance(&sorted_reference, &mut sorted);
        annotate_in_network_selector_selection_metadata(&mut sorted);
        let selected_count = sorted.len();
        let output = SelectorSelectionOutput {
            candidates: sorted,
            report: SelectorSelectionReport {
                selection_mode: SELECTOR_SELECTION_MODE_IN_NETWORK_RECENCY.to_string(),
                target_size,
                window_size: selected_count,
                selected_count,
                required_selected_count: selected_count,
                relaxed_selected_count: 0,
                required_phase_names: Vec::new(),
                relaxed_phase_names: Vec::new(),
                first_blocking_reason: None,
                deferred_reason_counts: Default::default(),
                required_deferred_reason_counts: Default::default(),
                relaxed_deferred_reason_counts: Default::default(),
                policy_snapshot: None,
            },
            dpp_metrics: None,
        };
        debug_assert!(
            selector_selection_report_contract_violations(&output.report).is_empty(),
            "legacy selector report must preserve selection count contract"
        );
        return output;
    }

    // 保留重排前的原始精排顺序，供 rankBeforeSelector 溯源与重排前后余弦对比。
    let pre_dpp_sorted = sorted.clone();
    let mut dpp_metrics = if should_apply_dpp(query, &sorted) {
        let mut dpp_cfg = DppConfig::for_query(query, sorted.len());
        dpp_cfg.top_k = sorted.len().min(dpp_cfg.max_selected_rank).max(1);
        let reranked = rerank_candidates(query, &sorted, &dpp_cfg, true, Some(query.limit.max(2)));
        sorted = reranked.candidates;
        Some(reranked.metrics)
    } else {
        None
    };

    let soft_caps = SelectorSoftCaps::for_query(query, target_size, author_soft_cap);
    let window_factor = window_factor(query);
    let window_size = sorted
        .len()
        .min(target_size.saturating_mul(window_factor).max(target_size));
    let window = &sorted[..window_size];
    let constraints = selector_constraints(query, target_size);
    let policy_snapshot = soft_caps.policy_snapshot(target_size, window_factor, &constraints);
    let mut selection = SelectionState::default();
    let action_profile = UserActionProfile::from_query(query);

    run_required_selection_phases(
        query,
        &action_profile,
        window,
        target_size,
        &constraints,
        &mut selection,
        soft_caps,
    );
    let required_selected_count = selection.len();
    let required_deferred_reason_counts =
        selection.blocking_reason_counts(window, &constraints, soft_caps.enforced());
    run_relaxed_selection_phases(window, target_size, &constraints, &mut selection, soft_caps);

    let phase_plan = selector_phase_plan_snapshot();
    let deferred_reason_counts =
        selection.blocking_reason_counts(window, &constraints, soft_caps.relaxed());
    let relaxed_deferred_reason_counts = deferred_reason_counts.clone();
    let mut output = build_selector_output(
        &pre_dpp_sorted,
        window,
        selection.selection_order,
        target_size,
    );
    if let Some(metrics) = dpp_metrics.as_mut() {
        finalize_dpp_output_metrics(&pre_dpp_sorted, &mut output, query.limit, metrics);
    }
    let selected_count = output.len();

    let output = SelectorSelectionOutput {
        candidates: output,
        report: SelectorSelectionReport {
            selection_mode: SELECTOR_SELECTION_MODE_POLICY_STATE_MACHINE.to_string(),
            target_size,
            window_size,
            selected_count,
            required_selected_count,
            relaxed_selected_count: selected_count.saturating_sub(required_selected_count),
            required_phase_names: phase_plan.required_phase_names,
            relaxed_phase_names: phase_plan.relaxed_phase_names,
            first_blocking_reason: first_blocking_reason(&deferred_reason_counts),
            deferred_reason_counts,
            required_deferred_reason_counts,
            relaxed_deferred_reason_counts,
            policy_snapshot: Some(policy_snapshot),
        },
        dpp_metrics,
    };
    debug_assert!(
        selector_selection_report_contract_violations(&output.report).is_empty(),
        "policy selector report must preserve phase and count contract"
    );
    output
}

/// 判定当前请求是否激活 V3 DPP 多样性重排。
fn should_apply_dpp(
    query: &RecommendationQueryPayload,
    sorted: &[RecommendationCandidatePayload],
) -> bool {
    if sorted.len() < 2 {
        return false;
    }
    if let Some(&explicit) = query.feature_switches.get("enable_v3_dpp") {
        return explicit;
    }
    // 未显式关闭时，若候选池携带 2 条及以上有效 256d 语义向量或 Semantic ID，自动启用 DPP。
    sorted
        .iter()
        .filter(|candidate| {
            candidate
                .semantic_embedding_256d
                .as_ref()
                .is_some_and(|v| !v.is_empty())
                || candidate.semantic_ids.is_some_and(|s| s[0] >= 0)
        })
        .take(2)
        .count()
        >= 2
}

/// 在约束状态机完成最终选集后，重算真实 `SlateContextPayload` 间隔并校准余弦前后对比指标。
fn finalize_dpp_output_metrics(
    pre_dpp_sorted: &[RecommendationCandidatePayload],
    output: &mut [RecommendationCandidatePayload],
    query_limit: usize,
    metrics: &mut DppMetrics,
) {
    let pre_rank_map: HashMap<&str, (usize, f64)> = pre_dpp_sorted
        .iter()
        .enumerate()
        .map(|(idx, cand)| (cand.post_id.as_str(), (idx, cand.final_score())))
        .collect();

    let pairs: Vec<(usize, f64)> = output
        .iter()
        .enumerate()
        .map(|(idx, cand)| {
            pre_rank_map
                .get(cand.post_id.as_str())
                .copied()
                .unwrap_or((idx, cand.final_score()))
        })
        .collect();
    populate_slate_contexts(output, &pairs);

    let eval_k = query_limit
        .max(2)
        .min(output.len())
        .min(pre_dpp_sorted.len());
    if eval_k >= 2 {
        let before_inputs: Vec<_> = pre_dpp_sorted[..eval_k]
            .iter()
            .enumerate()
            .map(|(idx, cand)| build_dpp_input_from_candidate(idx, cand))
            .collect();
        let after_inputs: Vec<_> = output[..eval_k]
            .iter()
            .enumerate()
            .map(|(idx, cand)| build_dpp_input_from_candidate(idx, cand))
            .collect();
        let eval_indices: Vec<usize> = (0..eval_k).collect();

        metrics.avg_pairwise_cosine_before = avg_pairwise_cosine(&before_inputs, &eval_indices);
        metrics.avg_pairwise_cosine_after = avg_pairwise_cosine(&after_inputs, &eval_indices);
        metrics.adjacent_cosine_before = avg_adjacent_cosine(&before_inputs, &eval_indices);
        metrics.adjacent_cosine_after = avg_adjacent_cosine(&after_inputs, &eval_indices);
    }
    metrics.selected_count = output.len();

    if let Some(first) = output.first_mut() {
        let breakdown = first.score_breakdown.get_or_insert_with(HashMap::new);
        breakdown.insert(
            "dppAvgPairwiseCosineBefore".to_string(),
            metrics.avg_pairwise_cosine_before,
        );
        breakdown.insert(
            "dppAvgPairwiseCosineAfter".to_string(),
            metrics.avg_pairwise_cosine_after,
        );
    }
}
