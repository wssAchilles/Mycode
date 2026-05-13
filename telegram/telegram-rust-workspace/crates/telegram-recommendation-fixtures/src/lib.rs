pub mod replay_assertions;
pub mod replay_contracts;

use std::collections::HashMap;

use replay_contracts::{
    RecommendationReplayFixturePayload, RecommendationReplayScenarioManifestPayload,
    RecommendationReplayScenarioPayload,
};

pub const REPLAY_WARM_USER: &str = include_str!("../fixtures/replay_warm_user.json");
pub const REPLAY_USER_STATE_MATRIX: &str =
    include_str!("../fixtures/replay_user_state_matrix.json");
pub const REPLAY_SCENARIOS: &str = include_str!("../fixtures/replay_scenarios.json");
pub const SCORER_CONTRACT: &str = include_str!("../fixtures/scorer_contract.json");

pub const REPLAY_CASE_FIXTURE_NAMES: &[&str] =
    &["replay_warm_user.json", "replay_user_state_matrix.json"];

pub const REPLAY_CASE_FIXTURES: &[&str] = &[REPLAY_WARM_USER, REPLAY_USER_STATE_MATRIX];

pub const REPLAY_FIXTURE_NAMES: &[&str] = &[
    "replay_warm_user.json",
    "replay_user_state_matrix.json",
    "replay_scenarios.json",
    "scorer_contract.json",
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

pub const REPLAY_SCENARIO_GROUP_RANKING: &str = "ranking";
pub const REPLAY_SCENARIO_GROUP_SOURCE: &str = "source";
pub const REPLAY_SCENARIO_GROUP_FILTER: &str = "filter";
pub const REPLAY_SCENARIO_GROUP_SELECTOR: &str = "selector";
pub const REPLAY_SCENARIO_GROUP_FALLBACK: &str = "fallback";
pub const REPLAY_SCENARIO_GROUP_DIVERSITY: &str = "diversity";

pub const REPLAY_REQUIRED_SCENARIO_GROUPS: &[&str] = &[
    REPLAY_SCENARIO_GROUP_RANKING,
    REPLAY_SCENARIO_GROUP_SOURCE,
    REPLAY_SCENARIO_GROUP_FILTER,
    REPLAY_SCENARIO_GROUP_SELECTOR,
    REPLAY_SCENARIO_GROUP_FALLBACK,
    REPLAY_SCENARIO_GROUP_DIVERSITY,
];

pub const REPLAY_ALLOWED_RISK_LEVELS: &[&str] = &["high", "medium"];
pub const REPLAY_ALLOWED_EXPECTED_FAILURE_TYPES: &[&str] = &[
    "ranking_drift",
    "selection_drift",
    "filter_drift",
    "source_drift",
    "contract_drift",
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
        if scenario.protected_surface.trim().is_empty() {
            violations.push(format!(
                "replay_manifest_protected_surface_missing: {}",
                scenario.name
            ));
        }
        if !REPLAY_ALLOWED_RISK_LEVELS.contains(&scenario.risk_level.as_str()) {
            violations.push(format!(
                "replay_manifest_risk_level_invalid: {}:{}",
                scenario.name, scenario.risk_level
            ));
        }
        if !REPLAY_ALLOWED_EXPECTED_FAILURE_TYPES.contains(&scenario.expected_failure_type.as_str())
        {
            violations.push(format!(
                "replay_manifest_expected_failure_type_invalid: {}:{}",
                scenario.name, scenario.expected_failure_type
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

pub fn replay_scenario_group(category: &str) -> &'static str {
    match category {
        "ranking" | "ranking-suppression" => REPLAY_SCENARIO_GROUP_RANKING,
        "source-mix" => REPLAY_SCENARIO_GROUP_SOURCE,
        "hard-filter" => REPLAY_SCENARIO_GROUP_FILTER,
        "selector" => REPLAY_SCENARIO_GROUP_SELECTOR,
        "fallback-mix" => REPLAY_SCENARIO_GROUP_FALLBACK,
        "diversity" => REPLAY_SCENARIO_GROUP_DIVERSITY,
        _ => "uncategorized",
    }
}

pub fn replay_manifest_group_counts(
    manifest: &RecommendationReplayScenarioManifestPayload,
) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for scenario in &manifest.scenarios {
        *counts
            .entry(replay_scenario_group(&scenario.category).to_string())
            .or_insert(0) += 1;
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

pub fn replay_manifest_high_risk_assertion_violations(
    fixtures: &[RecommendationReplayFixturePayload],
    manifest: &RecommendationReplayScenarioManifestPayload,
) -> Vec<String> {
    let scenarios_by_name = fixtures
        .iter()
        .flat_map(|fixture| fixture.scenarios.iter())
        .map(|scenario| (scenario.name.as_str(), scenario))
        .collect::<HashMap<_, _>>();
    let mut violations = Vec::new();

    for scenario in manifest
        .scenarios
        .iter()
        .filter(|scenario| scenario.risk_level == "high")
    {
        let Some(fixture_scenario) = scenarios_by_name.get(scenario.name.as_str()) else {
            continue;
        };
        if !scenario_has_explicit_expected_assertion(fixture_scenario) {
            violations.push(format!(
                "replay_manifest_high_risk_assertion_missing: {}",
                scenario.name
            ));
        }
    }

    violations
}

fn scenario_has_explicit_expected_assertion(
    scenario: &RecommendationReplayScenarioPayload,
) -> bool {
    let expected = &scenario.expected;

    expected.top_post_id.is_some()
        || !expected.selected_post_ids.is_empty()
        || expected.min_selected_count.is_some()
        || expected.max_selected_count.is_some()
        || !expected.stage_order.is_empty()
        || !expected.must_have_stages.is_empty()
        || !expected.must_not_have_stages.is_empty()
        || !expected.must_select_post_ids.is_empty()
        || !expected.must_not_select_post_ids.is_empty()
        || !expected.must_filter_post_ids.is_empty()
        || !expected.must_not_filter_post_ids.is_empty()
        || !expected.must_rank_before.is_empty()
        || !expected.score_ranges.is_empty()
        || !expected.candidate_breakdown_ranges.is_empty()
        || !expected.ranking_stage_kinds.is_empty()
        || !expected.filter_drop_counts.is_empty()
        || !expected.selected_source_counts.is_empty()
        || !expected.selected_lane_counts.is_empty()
        || !expected.min_selected_source_counts.is_empty()
        || !expected.max_selected_source_counts.is_empty()
        || !expected.selector_deferred_reason_counts.is_empty()
        || expected.max_repeated_author.is_some()
        || expected.max_selected_per_external_id.is_some()
        || !expected.stage_details.is_empty()
}

#[cfg(test)]
mod tests {
    use super::{
        REPLAY_ALLOWED_EXPECTED_FAILURE_TYPES, REPLAY_ALLOWED_RISK_LEVELS,
        REPLAY_CASE_FIXTURE_NAMES, REPLAY_CASE_FIXTURES, REPLAY_FIXTURE_NAMES,
        REPLAY_REQUIRED_SCENARIO_CATEGORIES, REPLAY_REQUIRED_SCENARIO_GROUPS,
        REPLAY_SCENARIO_GROUP_FILTER, REPLAY_SCENARIO_GROUP_RANKING,
        REPLAY_SCENARIO_GROUP_SELECTOR, REPLAY_SCENARIO_GROUP_SOURCE, REPLAY_SCENARIOS,
        REPLAY_USER_STATE_MATRIX, REPLAY_WARM_USER, SCORER_CONTRACT, parse_replay_case_fixtures,
        parse_replay_manifest, replay_fixture_scenario_names, replay_manifest_alignment_violations,
        replay_manifest_category_counts, replay_manifest_group_counts,
        replay_manifest_high_risk_assertion_violations,
        replay_manifest_required_category_violations,
    };
    use crate::replay_contracts::REPLAY_SCENARIO_MANIFEST_VERSION;
    use serde_json::Value;
    use telegram_component_primitives::scorers::{
        LOCAL_SCORER_STAGE_NAMES, MODEL_PROVIDER_SCORER_NAMES,
    };

    #[test]
    fn exports_non_empty_replay_fixtures() {
        assert_eq!(REPLAY_CASE_FIXTURE_NAMES.len(), 2);
        assert_eq!(REPLAY_CASE_FIXTURES.len(), 2);
        assert_eq!(REPLAY_FIXTURE_NAMES.len(), 4);
        assert_eq!(REPLAY_REQUIRED_SCENARIO_CATEGORIES.len(), 7);
        assert_eq!(REPLAY_REQUIRED_SCENARIO_GROUPS.len(), 6);
        assert_eq!(REPLAY_ALLOWED_RISK_LEVELS, ["high", "medium"]);
        assert!(REPLAY_ALLOWED_EXPECTED_FAILURE_TYPES.contains(&"ranking_drift"));
        assert!(REPLAY_WARM_USER.contains("warm_user_mock_phoenix_top_k"));
        assert!(REPLAY_USER_STATE_MATRIX.contains("sparse_user_source_mix_stays_stable"));
        assert!(REPLAY_SCENARIOS.contains("recommendation_replay_manifest_v2"));
        assert!(SCORER_CONTRACT.contains("recommendation_scorer_contract_v1"));
    }

    #[test]
    fn parses_replay_case_fixtures_and_manifest_from_workspace_fixture_crate() {
        let fixtures = parse_replay_case_fixtures().expect("parse replay case fixtures");
        let manifest = parse_replay_manifest().expect("parse replay manifest");

        assert_eq!(manifest.manifest_version, REPLAY_SCENARIO_MANIFEST_VERSION);
        assert_eq!(replay_fixture_scenario_names(&fixtures).len(), 13);
        assert!(
            replay_manifest_alignment_violations(&fixtures, &manifest).is_empty(),
            "manifest and replay fixture cases must stay aligned"
        );
        assert!(
            replay_manifest_required_category_violations(&manifest).is_empty(),
            "replay manifest must keep high-value algorithm categories covered"
        );
        assert!(
            replay_manifest_high_risk_assertion_violations(&fixtures, &manifest).is_empty(),
            "high-risk replay scenarios must keep explicit expected assertions"
        );
        assert_eq!(replay_manifest_category_counts(&manifest)["hard-filter"], 2);
        let group_counts = replay_manifest_group_counts(&manifest);
        assert!(group_counts[REPLAY_SCENARIO_GROUP_RANKING] >= 3);
        assert!(group_counts[REPLAY_SCENARIO_GROUP_SOURCE] >= 1);
        assert!(group_counts[REPLAY_SCENARIO_GROUP_FILTER] >= 1);
        assert!(group_counts[REPLAY_SCENARIO_GROUP_SELECTOR] >= 1);
    }

    #[test]
    fn scorer_contract_fixture_matches_workspace_component_primitives() {
        let contract: Value = serde_json::from_str(SCORER_CONTRACT).expect("parse scorer contract");
        let provider_scorers = contract["providerScorers"]
            .as_array()
            .expect("provider scorers array")
            .iter()
            .map(|value| value.as_str().expect("provider scorer name"))
            .collect::<Vec<_>>();
        let local_scorers = contract["localScorers"]
            .as_array()
            .expect("local scorers array")
            .iter()
            .map(|value| value.as_str().expect("local scorer name"))
            .collect::<Vec<_>>();

        assert_eq!(provider_scorers, MODEL_PROVIDER_SCORER_NAMES);
        assert_eq!(local_scorers, LOCAL_SCORER_STAGE_NAMES);
        assert_eq!(
            contract["rustLocalCandidateFieldWrites"]["WeightedScorer"],
            serde_json::json!(["weighted_score", "pipeline_score", "score_breakdown"])
        );
        assert_eq!(
            contract["rustLocalCandidateFieldWrites"]["ScoreContractScorer"],
            serde_json::json!([
                "score_contract_version",
                "score_breakdown_version",
                "score_breakdown"
            ])
        );
    }
}
