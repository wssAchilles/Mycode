pub const REPLAY_WARM_USER: &str = include_str!("../fixtures/replay_warm_user.json");
pub const REPLAY_USER_STATE_MATRIX: &str =
    include_str!("../fixtures/replay_user_state_matrix.json");
pub const REPLAY_SCENARIOS: &str = include_str!("../fixtures/replay_scenarios.json");

pub const REPLAY_FIXTURE_NAMES: &[&str] = &[
    "replay_warm_user.json",
    "replay_user_state_matrix.json",
    "replay_scenarios.json",
];

#[cfg(test)]
mod tests {
    use super::{
        REPLAY_FIXTURE_NAMES, REPLAY_SCENARIOS, REPLAY_USER_STATE_MATRIX, REPLAY_WARM_USER,
    };

    #[test]
    fn exports_non_empty_replay_fixtures() {
        assert_eq!(REPLAY_FIXTURE_NAMES.len(), 3);
        assert!(REPLAY_WARM_USER.contains("warm_user_mock_phoenix_top_k"));
        assert!(REPLAY_USER_STATE_MATRIX.contains("sparse_user_source_mix_stays_stable"));
        assert!(REPLAY_SCENARIOS.contains("recommendation_replay_manifest_v1"));
    }
}
