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

pub fn selection_phase_names(phases: &[SelectionPhase]) -> Vec<&'static str> {
    phases.iter().map(|phase| phase.as_str()).collect()
}

#[cfg(test)]
mod tests {
    use super::{
        RELAXED_SELECTION_PHASES, REQUIRED_SELECTION_PHASES, SelectionPhase, selection_phase_names,
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
    }
}
