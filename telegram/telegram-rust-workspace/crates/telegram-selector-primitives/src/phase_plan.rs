#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionPhase {
    PersonalizedWindow,
    RequiredLaneFloors,
    RequiredSpecialPoolFloors,
    ExplorationFloor,
    LaneOrderFill,
    NextAvailableFill,
    RelaxedLaneOrderFill,
    RelaxedNextAvailableFill,
}

impl SelectionPhase {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PersonalizedWindow => "personalized_window",
            Self::RequiredLaneFloors => "required_lane_floors",
            Self::RequiredSpecialPoolFloors => "required_special_pool_floors",
            Self::ExplorationFloor => "exploration_floor",
            Self::LaneOrderFill => "lane_order_fill",
            Self::NextAvailableFill => "next_available_fill",
            Self::RelaxedLaneOrderFill => "relaxed_lane_order_fill",
            Self::RelaxedNextAvailableFill => "relaxed_next_available_fill",
        }
    }
}

pub const REQUIRED_SELECTION_PHASES: &[SelectionPhase] = &[
    SelectionPhase::PersonalizedWindow,
    SelectionPhase::RequiredLaneFloors,
    SelectionPhase::RequiredSpecialPoolFloors,
    SelectionPhase::ExplorationFloor,
    SelectionPhase::LaneOrderFill,
    SelectionPhase::NextAvailableFill,
];

pub const RELAXED_SELECTION_PHASES: &[SelectionPhase] = &[
    SelectionPhase::RelaxedLaneOrderFill,
    SelectionPhase::RelaxedNextAvailableFill,
];

pub const SELECTOR_PHASE_PLAN_VERSION: &str = "selector_phase_plan_v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectorPhasePlanSnapshot {
    pub version: &'static str,
    pub required_phase_names: Vec<&'static str>,
    pub relaxed_phase_names: Vec<&'static str>,
}

pub fn selection_phase_names(phases: &[SelectionPhase]) -> Vec<&'static str> {
    phases.iter().map(|phase| phase.as_str()).collect()
}

pub fn required_selection_phase_names() -> Vec<&'static str> {
    selection_phase_names(REQUIRED_SELECTION_PHASES)
}

pub fn relaxed_selection_phase_names() -> Vec<&'static str> {
    selection_phase_names(RELAXED_SELECTION_PHASES)
}

pub fn selector_phase_plan_snapshot() -> SelectorPhasePlanSnapshot {
    SelectorPhasePlanSnapshot {
        version: SELECTOR_PHASE_PLAN_VERSION,
        required_phase_names: required_selection_phase_names(),
        relaxed_phase_names: relaxed_selection_phase_names(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        RELAXED_SELECTION_PHASES, REQUIRED_SELECTION_PHASES, SELECTOR_PHASE_PLAN_VERSION,
        SelectionPhase, relaxed_selection_phase_names, required_selection_phase_names,
        selection_phase_names, selector_phase_plan_snapshot,
    };

    #[test]
    fn exposes_required_then_relaxed_top_k_state_machine() {
        assert_eq!(
            REQUIRED_SELECTION_PHASES,
            &[
                SelectionPhase::PersonalizedWindow,
                SelectionPhase::RequiredLaneFloors,
                SelectionPhase::RequiredSpecialPoolFloors,
                SelectionPhase::ExplorationFloor,
                SelectionPhase::LaneOrderFill,
                SelectionPhase::NextAvailableFill,
            ]
        );
        assert_eq!(
            selection_phase_names(RELAXED_SELECTION_PHASES),
            vec!["relaxed_lane_order_fill", "relaxed_next_available_fill"]
        );
        assert_eq!(SELECTOR_PHASE_PLAN_VERSION, "selector_phase_plan_v1");
        assert_eq!(
            required_selection_phase_names().first().copied(),
            Some("personalized_window")
        );
        assert_eq!(
            relaxed_selection_phase_names().last().copied(),
            Some("relaxed_next_available_fill")
        );
        let snapshot = selector_phase_plan_snapshot();
        assert_eq!(snapshot.version, SELECTOR_PHASE_PLAN_VERSION);
        assert_eq!(
            snapshot.required_phase_names.first().copied(),
            Some("personalized_window")
        );
        assert_eq!(
            snapshot.relaxed_phase_names.last().copied(),
            Some("relaxed_next_available_fill")
        );
    }
}
