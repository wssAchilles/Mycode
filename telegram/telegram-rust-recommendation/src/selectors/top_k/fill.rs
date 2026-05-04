use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

use super::candidates::{is_exploration_candidate, is_strong_personalized_candidate};
use super::constraints::{
    SelectorConstraints, SelectorSoftCaps, SpecialPoolRequirement, personalized_window_size,
    special_pool_matches, special_pool_requirements,
};
use super::state::SelectionState;
use telegram_selector_primitives::SelectionLimits;

pub(super) fn run_required_selection_phases(
    query: &RecommendationQueryPayload,
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selection: &mut SelectionState,
    soft_caps: SelectorSoftCaps,
) {
    let limits = soft_caps.enforced();

    fill_personalized_window(query, window, target_size, constraints, selection, limits);
    fill_required_lane_floors(window, target_size, constraints, selection, limits);
    fill_required_special_pool_floors(
        window,
        target_size,
        constraints,
        selection,
        limits,
        special_pool_requirements(query, window, target_size),
    );
    fill_exploration_floor(window, target_size, constraints, selection, limits);
    fill_by_lane_order(
        window,
        target_size,
        &constraints.lane_order,
        constraints,
        selection,
        limits,
    );
    fill_next_available(window, target_size, constraints, selection, limits);
}

pub(super) fn run_relaxed_selection_phases(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selection: &mut SelectionState,
    soft_caps: SelectorSoftCaps,
) {
    let limits = soft_caps.relaxed();

    fill_by_lane_order(
        window,
        target_size,
        &constraints.lane_order,
        constraints,
        selection,
        limits,
    );
    fill_next_available(window, target_size, constraints, selection, limits);
}

fn fill_next_available(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selection: &mut SelectionState,
    limits: SelectionLimits,
) {
    while selection.len() < target_size {
        let Some(index) = selection.next_candidate_index(window, None, constraints, limits) else {
            break;
        };
        selection.apply_candidate(window, index);
    }
}

fn fill_personalized_window(
    query: &RecommendationQueryPayload,
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selection: &mut SelectionState,
    limits: SelectionLimits,
) {
    let target = personalized_window_size(query, target_size).min(target_size);
    while selection.len() < target {
        let Some(index) = window.iter().enumerate().find_map(|(index, candidate)| {
            if selection.contains(index) || !is_strong_personalized_candidate(candidate) {
                return None;
            }
            selection
                .can_select_candidate(candidate, None, constraints, limits)
                .then_some(index)
        }) else {
            break;
        };

        selection.apply_candidate(window, index);
    }
}

fn fill_by_lane_order(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    lane_order: &[String],
    constraints: &SelectorConstraints,
    selection: &mut SelectionState,
    limits: SelectionLimits,
) {
    loop {
        if selection.len() >= target_size {
            break;
        }

        let mut progress = false;
        for lane in lane_order {
            if selection.len() >= target_size {
                break;
            }
            let Some(index) =
                selection.next_candidate_index(window, Some(lane.as_str()), constraints, limits)
            else {
                continue;
            };
            selection.apply_candidate(window, index);
            progress = true;
        }

        if !progress {
            break;
        }
    }
}

fn fill_required_lane_floors(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selection: &mut SelectionState,
    limits: SelectionLimits,
) {
    loop {
        if selection.len() >= target_size {
            break;
        }

        let mut progress = false;
        for lane in &constraints.lane_order {
            let lane_floor = constraints
                .lane_floors
                .get(lane)
                .copied()
                .unwrap_or_default();
            if selection.lane_count(lane) >= lane_floor {
                continue;
            }
            let Some(index) =
                selection.next_candidate_index(window, Some(lane.as_str()), constraints, limits)
            else {
                continue;
            };
            selection.apply_candidate(window, index);
            progress = true;
            if selection.len() >= target_size {
                break;
            }
        }

        if !progress {
            break;
        }
    }
}

fn fill_required_special_pool_floors(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selection: &mut SelectionState,
    limits: SelectionLimits,
    requirements: Vec<SpecialPoolRequirement>,
) {
    for requirement in requirements {
        if requirement.floor == 0 {
            continue;
        }

        while selection.len() < target_size
            && selection.selected_matching_count(window, |candidate| {
                special_pool_matches(candidate, requirement.kind)
            }) < requirement.floor
        {
            let Some(index) = window.iter().enumerate().find_map(|(index, candidate)| {
                if selection.contains(index) || !special_pool_matches(candidate, requirement.kind) {
                    return None;
                }
                selection
                    .can_select_candidate(candidate, None, constraints, limits)
                    .then_some(index)
            }) else {
                break;
            };

            selection.apply_candidate(window, index);
        }
    }
}

fn fill_exploration_floor(
    window: &[RecommendationCandidatePayload],
    target_size: usize,
    constraints: &SelectorConstraints,
    selection: &mut SelectionState,
    limits: SelectionLimits,
) {
    if constraints.exploration_floor == 0 {
        return;
    }

    while selection.len() < target_size
        && selection.selected_matching_count(window, is_exploration_candidate)
            < constraints.exploration_floor
    {
        let Some(index) = window.iter().enumerate().find_map(|(index, candidate)| {
            if selection.contains(index) || !is_exploration_candidate(candidate) {
                return None;
            }
            selection
                .can_select_candidate(candidate, None, constraints, limits)
                .then_some(index)
        }) else {
            break;
        };

        selection.apply_candidate(window, index);
    }
}
