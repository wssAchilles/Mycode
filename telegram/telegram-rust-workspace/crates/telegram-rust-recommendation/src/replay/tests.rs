use super::{
    REPLAY_FIXTURE_VERSION, REPLAY_SCENARIO_MANIFEST_VERSION, RecommendationReplayFixturePayload,
    RecommendationReplayScenarioManifestPayload, evaluate_replay_fixture,
};

use telegram_recommendation_fixtures::{
    REPLAY_SCENARIOS, REPLAY_USER_STATE_MATRIX, REPLAY_WARM_USER,
};

#[test]
fn evaluates_replay_fixture_scenarios() {
    let fixtures = replay_fixtures();

    assert!(fixtures.iter().all(|fixture| {
        fixture.replay_version == REPLAY_FIXTURE_VERSION && !fixture.scenarios.is_empty()
    }));
    let scenario_names = fixtures
        .iter()
        .flat_map(|fixture| fixture.scenarios.iter())
        .map(|scenario| scenario.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        scenario_names,
        vec![
            "warm_user_mock_phoenix_top_k",
            "cold_user_uses_cold_start_and_popular",
            "negative_action_suppresses_author_candidate",
            "external_id_duplicate_news_filter",
            "sparse_user_source_mix_stays_stable",
            "heavy_user_repeated_author_soft_cap",
            "in_network_only_uses_recency_order",
            "duplicate_and_history_filters_report_drop_counts",
        ]
    );

    let results = fixtures
        .iter()
        .flat_map(|fixture| evaluate_replay_fixture(fixture).expect("evaluate replay fixture"))
        .collect::<Vec<_>>();
    assert_eq!(results.len(), 8);
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

    let history_filters = results
        .iter()
        .find(|result| result.scenario_name == "duplicate_and_history_filters_report_drop_counts")
        .expect("filter count scenario result");
    assert_eq!(
        history_filters
            .filter_drop_counts
            .get("DuplicateFilter")
            .copied(),
        Some(1)
    );
}

#[test]
fn replay_manifest_stays_aligned_with_fixture_scenarios() {
    let fixtures = replay_fixtures();
    let manifest: RecommendationReplayScenarioManifestPayload =
        serde_json::from_str(REPLAY_SCENARIOS).expect("parse replay scenario manifest");

    assert_eq!(manifest.manifest_version, REPLAY_SCENARIO_MANIFEST_VERSION);

    let fixture_names = fixtures
        .iter()
        .flat_map(|fixture| fixture.scenarios.iter())
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

fn replay_fixtures() -> Vec<RecommendationReplayFixturePayload> {
    [REPLAY_WARM_USER, REPLAY_USER_STATE_MATRIX]
        .into_iter()
        .map(|fixture| serde_json::from_str(fixture).expect("parse replay fixture"))
        .collect()
}

#[test]
fn rejects_unknown_replay_fixture_version() {
    let mut fixture: RecommendationReplayFixturePayload =
        serde_json::from_str(REPLAY_WARM_USER).expect("parse replay fixture");
    fixture.replay_version = "unknown".to_string();

    let error = evaluate_replay_fixture(&fixture).expect_err("version mismatch should fail");
    assert!(error.contains(REPLAY_FIXTURE_VERSION));
}
