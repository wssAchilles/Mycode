use super::{REPLAY_FIXTURE_VERSION, RecommendationReplayFixturePayload, evaluate_replay_fixture};

const WARM_USER_REPLAY: &str = include_str!("../../tests/fixtures/replay_warm_user.json");

#[test]
fn evaluates_warm_user_replay_fixture() {
    let fixture: RecommendationReplayFixturePayload =
        serde_json::from_str(WARM_USER_REPLAY).expect("parse replay fixture");

    assert_eq!(fixture.replay_version, REPLAY_FIXTURE_VERSION);
    assert_eq!(fixture.scenarios.len(), 1);

    let results = evaluate_replay_fixture(&fixture).expect("evaluate replay fixture");
    assert_eq!(results.len(), 1);
    assert!(
        results[0].passed(),
        "replay violations: {:?}",
        results[0].violations
    );
    assert_eq!(
        results[0].selected_post_ids,
        vec!["post-diverse", "post-strong"]
    );
}

#[test]
fn rejects_unknown_replay_fixture_version() {
    let mut fixture: RecommendationReplayFixturePayload =
        serde_json::from_str(WARM_USER_REPLAY).expect("parse replay fixture");
    fixture.replay_version = "unknown".to_string();

    let error = evaluate_replay_fixture(&fixture).expect_err("version mismatch should fail");
    assert!(error.contains(REPLAY_FIXTURE_VERSION));
}
