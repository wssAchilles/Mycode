use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::signals::user_actions::UserActionProfile;

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
pub use detail::build_selector_stage_detail;
pub use report::{SelectorSelectionOutput, SelectorSelectionReport};
pub(crate) use stage_payload::{SelectorStageInput, build_selector_stage};

use constraints::{SelectorSoftCaps, selector_constraints, window_factor};
use fill::{run_relaxed_selection_phases, run_required_selection_phases};
use output::{annotate_selector_rank_provenance, build_selector_output};
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
        };
        debug_assert!(
            selector_selection_report_contract_violations(&output.report).is_empty(),
            "legacy selector report must preserve selection count contract"
        );
        return output;
    }

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
    let output = build_selector_output(
        &sorted,
        window,
        window_size,
        selection.selection_order,
        target_size,
    );
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
    };
    debug_assert!(
        selector_selection_report_contract_violations(&output.report).is_empty(),
        "policy selector report must preserve phase and count contract"
    );
    output
}
