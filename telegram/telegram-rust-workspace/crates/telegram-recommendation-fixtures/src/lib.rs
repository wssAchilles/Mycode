pub mod replay_assertions;
pub mod replay_contracts;

use std::collections::HashMap;

use replay_contracts::{
    RecommendationReplayFixturePayload, RecommendationReplayScenarioManifestPayload,
};

pub const REPLAY_WARM_USER: &str = include_str!("../fixtures/replay_warm_user.json");
pub const REPLAY_USER_STATE_MATRIX: &str =
    include_str!("../fixtures/replay_user_state_matrix.json");
pub const REPLAY_SCENARIOS: &str = include_str!("../fixtures/replay_scenarios.json");

pub const REPLAY_CASE_FIXTURE_NAMES: &[&str] =
    &["replay_warm_user.json", "replay_user_state_matrix.json"];

pub const REPLAY_CASE_FIXTURES: &[&str] = &[REPLAY_WARM_USER, REPLAY_USER_STATE_MATRIX];

pub const REPLAY_FIXTURE_NAMES: &[&str] = &[
    "replay_warm_user.json",
    "replay_user_state_matrix.json",
    "replay_scenarios.json",
];

pub const REPLAY_REQUIRED_SCENARIO_CATEGORIES: &[&str] = &[
    "ranking",
    "fallback-mix",
    "ranking-suppression",
    "hard-filter",
    "source-mix",
    "diversity",
    "selector",
];

pub fn parse_replay_case_fixtures()
-> Result<Vec<RecommendationReplayFixturePayload>, serde_json::Error> {
    REPLAY_CASE_FIXTURES
        .iter()
        .map(|fixture| serde_json::from_str(fixture))
        .collect()
}

pub fn parse_replay_manifest()
-> Result<RecommendationReplayScenarioManifestPayload, serde_json::Error> {
    serde_json::from_str(REPLAY_SCENARIOS)
}

pub fn replay_fixture_scenario_names(fixtures: &[RecommendationReplayFixturePayload]) -> Vec<&str> {
    fixtures
        .iter()
        .flat_map(|fixture| fixture.scenarios.iter())
        .map(|scenario| scenario.name.as_str())
        .collect()
}

pub fn replay_manifest_alignment_violations(
    fixtures: &[RecommendationReplayFixturePayload],
    manifest: &RecommendationReplayScenarioManifestPayload,
) -> Vec<String> {
    let fixture_names = replay_fixture_scenario_names(fixtures);
    let manifest_names = manifest
        .scenarios
        .iter()
        .map(|scenario| scenario.name.as_str())
        .collect::<Vec<_>>();
    let mut violations = Vec::new();

    if manifest_names != fixture_names {
        violations.push(format!(
            "replay_manifest_scenarios_mismatch: expected {:?} got {:?}",
            fixture_names, manifest_names
        ));
    }

    for scenario in &manifest.scenarios {
        if scenario.category.trim().is_empty() {
            violations.push(format!(
                "replay_manifest_category_missing: {}",
                scenario.name
            ));
        }
        if scenario.description.trim().is_empty() {
            violations.push(format!(
                "replay_manifest_description_missing: {}",
                scenario.name
            ));
        }
        if scenario.parity_refs.is_empty() {
            violations.push(format!(
                "replay_manifest_parity_refs_missing: {}",
                scenario.name
            ));
        }
    }

    violations
}

pub fn replay_manifest_category_counts(
    manifest: &RecommendationReplayScenarioManifestPayload,
) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for scenario in &manifest.scenarios {
        *counts.entry(scenario.category.clone()).or_insert(0) += 1;
    }
    counts
}

pub fn replay_manifest_required_category_violations(
    manifest: &RecommendationReplayScenarioManifestPayload,
) -> Vec<String> {
    let category_counts = replay_manifest_category_counts(manifest);
    REPLAY_REQUIRED_SCENARIO_CATEGORIES
        .iter()
        .filter(|category| !category_counts.contains_key(**category))
        .map(|category| format!("replay_manifest_required_category_missing: {category}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        REPLAY_CASE_FIXTURE_NAMES, REPLAY_CASE_FIXTURES, REPLAY_FIXTURE_NAMES,
        REPLAY_REQUIRED_SCENARIO_CATEGORIES, REPLAY_SCENARIOS, REPLAY_USER_STATE_MATRIX,
        REPLAY_WARM_USER, parse_replay_case_fixtures, parse_replay_manifest,
        replay_fixture_scenario_names, replay_manifest_alignment_violations,
        replay_manifest_category_counts, replay_manifest_required_category_violations,
    };
    use crate::replay_contracts::REPLAY_SCENARIO_MANIFEST_VERSION;

    #[test]
    fn exports_non_empty_replay_fixtures() {
        assert_eq!(REPLAY_CASE_FIXTURE_NAMES.len(), 2);
        assert_eq!(REPLAY_CASE_FIXTURES.len(), 2);
        assert_eq!(REPLAY_FIXTURE_NAMES.len(), 3);
        assert_eq!(REPLAY_REQUIRED_SCENARIO_CATEGORIES.len(), 7);
        assert!(REPLAY_WARM_USER.contains("warm_user_mock_phoenix_top_k"));
        assert!(REPLAY_USER_STATE_MATRIX.contains("sparse_user_source_mix_stays_stable"));
        assert!(REPLAY_SCENARIOS.contains("recommendation_replay_manifest_v1"));
    }

    #[test]
    fn parses_replay_case_fixtures_and_manifest_from_workspace_fixture_crate() {
        let fixtures = parse_replay_case_fixtures().expect("parse replay case fixtures");
        let manifest = parse_replay_manifest().expect("parse replay manifest");

        assert_eq!(manifest.manifest_version, REPLAY_SCENARIO_MANIFEST_VERSION);
        assert_eq!(replay_fixture_scenario_names(&fixtures).len(), 10);
        assert!(
            replay_manifest_alignment_violations(&fixtures, &manifest).is_empty(),
            "manifest and replay fixture cases must stay aligned"
        );
        assert!(
            replay_manifest_required_category_violations(&manifest).is_empty(),
            "replay manifest must keep high-value algorithm categories covered"
        );
        assert_eq!(replay_manifest_category_counts(&manifest)["hard-filter"], 2);
    }
}
