use std::collections::HashMap;

use serde_json::json;

use crate::pipeline::local::scorers::local_ranking_ladder_specs;

use super::{
    REPLAY_FIXTURE_VERSION, REPLAY_SCENARIO_MANIFEST_VERSION, RecommendationReplayFixturePayload,
    evaluate_replay_fixture, stage_contracts::replay_stage_contract_violations,
};

use telegram_filter_primitives::FILTER_DECISION_DROP_COUNT_FIELD;
use telegram_pipeline_primitives::{
    PIPELINE_STAGE_CONTRACT_VERSION, PIPELINE_STAGE_DETAIL_CONTRACT_VERSION_FIELD,
    PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD, PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD,
    PIPELINE_STAGE_KIND_FILTER, PIPELINE_STAGE_KIND_SELECTOR, PIPELINE_STAGE_KIND_SERVING,
    PIPELINE_STAGE_KIND_SOURCE_MERGE,
};
use telegram_recommendation_fixtures::{
    REPLAY_WARM_USER, parse_replay_case_fixtures, parse_replay_manifest,
    replay_fixture_scenario_names, replay_manifest_alignment_violations,
    replay_manifest_required_category_violations,
};
use telegram_selector_primitives::{
    SELECTOR_AUDIT_VERSION, SELECTOR_CONSTRAINT_VERSION, SELECTOR_DETAIL_AUDIT_VERSION_FIELD,
    SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD, SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD,
    SELECTOR_DETAIL_POLICY_VERSION_FIELD, SELECTOR_DETAIL_SCORE_INPUT_FIELD,
    SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD, SELECTOR_POLICY_VERSION,
    SELECTOR_SCORE_SOURCE_VERSION,
};
use telegram_serving_primitives::{
    RUST_SERVING_LANE_STAGE_NAME, SERVING_SCORE_INPUT_SELECTOR_ORDER,
    SERVING_STAGE_MUTATES_SCORE_FIELD, SERVING_STAGE_SCORE_INPUT_FIELD,
};
use telegram_source_primitives::SOURCE_LANE_MERGE_STAGE_NAME;

#[test]
fn evaluates_replay_fixture_scenarios() {
    let fixtures = replay_fixtures();

    assert!(fixtures.iter().all(|fixture| {
        fixture.replay_version == REPLAY_FIXTURE_VERSION && !fixture.scenarios.is_empty()
    }));
    let scenario_names = replay_fixture_scenario_names(&fixtures);
    assert_eq!(
        scenario_names,
        vec![
            "warm_user_mock_phoenix_top_k",
            "cold_user_uses_cold_start_and_popular",
            "negative_action_suppresses_author_candidate",
            "external_id_duplicate_news_filter",
            "ranking-negative-feedback-dedup",
            "ranking-scorer-order-content-quality-affinity",
            "trend_fused_adjustments_write_breakdown",
            "sparse_user_source_mix_stays_stable",
            "heavy_user_repeated_author_soft_cap",
            "in_network_only_uses_recency_order",
            "duplicate_and_history_filters_report_drop_counts",
            "fallback_fill_skips_repeated_author_when_source_underfills",
            "relaxed_fill_backfills_underfilled_repeated_author",
        ]
    );

    let results = fixtures
        .iter()
        .flat_map(|fixture| evaluate_replay_fixture(fixture).expect("evaluate replay fixture"))
        .collect::<Vec<_>>();
    assert_eq!(results.len(), 13);
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
    let manifest = parse_replay_manifest().expect("parse replay scenario manifest");

    assert_eq!(manifest.manifest_version, REPLAY_SCENARIO_MANIFEST_VERSION);
    assert!(
        replay_manifest_alignment_violations(&fixtures, &manifest).is_empty(),
        "replay scenario manifest and fixture cases must stay aligned"
    );
    assert!(
        replay_manifest_required_category_violations(&manifest).is_empty(),
        "replay manifest must preserve the required algorithm coverage categories"
    );
}

fn replay_fixtures() -> Vec<RecommendationReplayFixturePayload> {
    parse_replay_case_fixtures().expect("parse replay fixture")
}

#[test]
fn rejects_unknown_replay_fixture_version() {
    let mut fixture: RecommendationReplayFixturePayload =
        serde_json::from_str(REPLAY_WARM_USER).expect("parse replay fixture");
    fixture.replay_version = "unknown".to_string();

    let error = evaluate_replay_fixture(&fixture).expect_err("version mismatch should fail");
    assert!(error.contains(REPLAY_FIXTURE_VERSION));
}

#[test]
fn replay_stage_contract_violations_are_categorized_by_contract_surface() {
    let stage_details = HashMap::from([(
        "WeightedScorer".to_string(),
        HashMap::from([
            ("stageName".to_string(), json!("WeightedScorer")),
            ("stageKind".to_string(), json!("ranking")),
        ]),
    )]);

    let violations =
        replay_stage_contract_violations(&local_ranking_ladder_specs(), &stage_details);

    assert!(
        violations
            .iter()
            .any(|violation| violation.starts_with("stage_contract_violation:")),
        "violations should expose the generic stage contract category: {violations:?}"
    );
    assert!(
        violations
            .iter()
            .any(|violation| violation.starts_with("ranking_contract_violation:")),
        "violations should expose the ranking contract category: {violations:?}"
    );
}

#[test]
fn replay_stage_contract_violations_cover_selector_and_serving_surfaces() {
    let stage_details = HashMap::from([
        (
            "TopKSelector".to_string(),
            HashMap::from([
                (
                    PIPELINE_STAGE_DETAIL_CONTRACT_VERSION_FIELD.to_string(),
                    json!(PIPELINE_STAGE_CONTRACT_VERSION),
                ),
                (
                    PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD.to_string(),
                    json!("TopKSelector"),
                ),
                (
                    PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD.to_string(),
                    json!(PIPELINE_STAGE_KIND_SELECTOR),
                ),
                (
                    SELECTOR_DETAIL_POLICY_VERSION_FIELD.to_string(),
                    json!(SELECTOR_POLICY_VERSION),
                ),
                (
                    SELECTOR_DETAIL_AUDIT_VERSION_FIELD.to_string(),
                    json!(SELECTOR_AUDIT_VERSION),
                ),
                (
                    SELECTOR_DETAIL_CONSTRAINT_VERSION_FIELD.to_string(),
                    json!(SELECTOR_CONSTRAINT_VERSION),
                ),
                (
                    SELECTOR_DETAIL_SCORE_SOURCE_VERSION_FIELD.to_string(),
                    json!(SELECTOR_SCORE_SOURCE_VERSION),
                ),
                (
                    SELECTOR_DETAIL_SCORE_INPUT_FIELD.to_string(),
                    json!("weighted_score"),
                ),
                (
                    SELECTOR_DETAIL_FINAL_SCORE_ONLY_FIELD.to_string(),
                    json!(true),
                ),
            ]),
        ),
        (
            RUST_SERVING_LANE_STAGE_NAME.to_string(),
            HashMap::from([
                (
                    PIPELINE_STAGE_DETAIL_CONTRACT_VERSION_FIELD.to_string(),
                    json!(PIPELINE_STAGE_CONTRACT_VERSION),
                ),
                (
                    PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD.to_string(),
                    json!(RUST_SERVING_LANE_STAGE_NAME),
                ),
                (
                    PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD.to_string(),
                    json!(PIPELINE_STAGE_KIND_SERVING),
                ),
                (
                    SERVING_STAGE_SCORE_INPUT_FIELD.to_string(),
                    json!(SERVING_SCORE_INPUT_SELECTOR_ORDER),
                ),
                (SERVING_STAGE_MUTATES_SCORE_FIELD.to_string(), json!(false)),
            ]),
        ),
    ]);

    let violations =
        replay_stage_contract_violations(&local_ranking_ladder_specs(), &stage_details);

    assert!(
        violations
            .iter()
            .any(|violation| violation.starts_with("selector_contract_violation:")),
        "selector detail drift should be categorized: {violations:?}"
    );
    assert!(
        violations
            .iter()
            .any(|violation| violation.starts_with("serving_page_build_contract_violation:")),
        "serving page build drift should be categorized: {violations:?}"
    );
}

#[test]
fn replay_stage_contract_violations_cover_source_merge_and_filter_surfaces() {
    let stage_details = HashMap::from([
        (
            SOURCE_LANE_MERGE_STAGE_NAME.to_string(),
            HashMap::from([
                (
                    PIPELINE_STAGE_DETAIL_CONTRACT_VERSION_FIELD.to_string(),
                    json!(PIPELINE_STAGE_CONTRACT_VERSION),
                ),
                (
                    PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD.to_string(),
                    json!(SOURCE_LANE_MERGE_STAGE_NAME),
                ),
                (
                    PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD.to_string(),
                    json!(PIPELINE_STAGE_KIND_SOURCE_MERGE),
                ),
            ]),
        ),
        (
            "DuplicateFilter".to_string(),
            HashMap::from([
                (
                    PIPELINE_STAGE_DETAIL_CONTRACT_VERSION_FIELD.to_string(),
                    json!(PIPELINE_STAGE_CONTRACT_VERSION),
                ),
                (
                    PIPELINE_STAGE_DETAIL_STAGE_NAME_FIELD.to_string(),
                    json!("DuplicateFilter"),
                ),
                (
                    PIPELINE_STAGE_DETAIL_STAGE_KIND_FIELD.to_string(),
                    json!(PIPELINE_STAGE_KIND_FILTER),
                ),
                (FILTER_DECISION_DROP_COUNT_FIELD.to_string(), json!(1)),
            ]),
        ),
    ]);

    let violations =
        replay_stage_contract_violations(&local_ranking_ladder_specs(), &stage_details);

    assert!(
        violations
            .iter()
            .any(|violation| violation.starts_with("source_merge_contract_violation:")),
        "source merge detail drift should be categorized: {violations:?}"
    );
    assert!(
        violations
            .iter()
            .any(|violation| violation.starts_with("filter_contract_violation:")),
        "filter detail drift should be categorized: {violations:?}"
    );
}
