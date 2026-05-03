use super::{
    REPLAY_FIXTURE_VERSION, REPLAY_SCENARIO_MANIFEST_VERSION, RecommendationReplayFixturePayload,
    RecommendationReplayScenarioManifestPayload, evaluate_replay_fixture,
};

const WARM_USER_REPLAY: &str = include_str!("../../tests/fixtures/replay_warm_user.json");
const REPLAY_SCENARIOS: &str = include_str!("../../tests/fixtures/replay_scenarios.json");

#[test]
fn evaluates_replay_fixture_scenarios() {
    let fixture: RecommendationReplayFixturePayload =
        serde_json::from_str(WARM_USER_REPLAY).expect("parse replay fixture");

    assert_eq!(fixture.replay_version, REPLAY_FIXTURE_VERSION);
    let scenario_names = fixture
        .scenarios
        .iter()
        .map(|scenario| scenario.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        scenario_names,
        vec![
            "warm_user_mock_phoenix_top_k",
            "cold_user_uses_cold_start_and_popular",
            "negative_action_suppresses_author_candidate",
            "external_id_duplicate_news_filter",
        ]
    );

    let results = evaluate_replay_fixture(&fixture).expect("evaluate replay fixture");
    assert_eq!(results.len(), 4);
    assert!(
        results.iter().all(|result| result.passed()),
        "replay violations: {:?}",
        results
    );

    let warm = results
        .iter()
        .find(|result| result.scenario_name == "warm_user_mock_phoenix_top_k")
        .expect("warm scenario result");
    assert_eq!(warm.selected_post_ids, vec!["post-diverse", "post-strong"]);

    let news = results
        .iter()
        .find(|result| result.scenario_name == "external_id_duplicate_news_filter")
        .expect("news scenario result");
    assert_eq!(news.filtered_post_ids, vec!["news-dup-b"]);
}

#[test]
fn replay_manifest_stays_aligned_with_fixture_scenarios() {
    let fixture: RecommendationReplayFixturePayload =
        serde_json::from_str(WARM_USER_REPLAY).expect("parse replay fixture");
    let manifest: RecommendationReplayScenarioManifestPayload =
        serde_json::from_str(REPLAY_SCENARIOS).expect("parse replay scenario manifest");

    assert_eq!(manifest.manifest_version, REPLAY_SCENARIO_MANIFEST_VERSION);

    let fixture_names = fixture
        .scenarios
        .iter()
        .map(|scenario| scenario.name.as_str())
        .collect::<Vec<_>>();
    let manifest_names = manifest
        .scenarios
        .iter()
        .map(|scenario| scenario.name.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        manifest_names, fixture_names,
        "replay scenario manifest and fixture cases must stay aligned"
    );
    assert!(manifest.scenarios.iter().all(|scenario| {
        !scenario.category.trim().is_empty()
            && !scenario.description.trim().is_empty()
            && !scenario.parity_refs.is_empty()
    }));
}

#[test]
fn rejects_unknown_replay_fixture_version() {
    let mut fixture: RecommendationReplayFixturePayload =
        serde_json::from_str(WARM_USER_REPLAY).expect("parse replay fixture");
    fixture.replay_version = "unknown".to_string();

    let error = evaluate_replay_fixture(&fixture).expect_err("version mismatch should fail");
    assert!(error.contains(REPLAY_FIXTURE_VERSION));
}
