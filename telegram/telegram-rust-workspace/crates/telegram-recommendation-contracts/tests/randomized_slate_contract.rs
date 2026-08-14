use std::cmp::Ordering;

use serde_json::{Value, json};
use telegram_randomized_policy_primitives::compute_full_distribution;
use telegram_recommendation_contracts::{
    CandidateNamespace, RandomizedSlateSimulationInputV1, RandomizedSlateSimulationV1,
    RecommendationDecisionLogV1, candidate_pool_sha256, canonical_json,
    compare_decision_pool_baseline, compute_simulation_sha256, sha256_hex,
    verify_simulation_sha256,
};

fn valid_output_json() -> Value {
    json!({
        "contractVersion": "randomized_slate_simulation_v1",
        "status": "simulated",
        "policy": {
            "policyId": "eligible_pool_epsilon_plackett_luce_v1",
            "policyVersion": "policy-v1",
            "configVersion": "config-v1",
            "epsilon": 0.2,
            "temperature": 1.0,
            "slateSize": 1
        },
        "baselineOrderVersion": "decision_pool_rank_then_identity_v1",
        "probabilitySemantics": "conditional_on_prior_slate_prefix_v1",
        "decisionFingerprint": {
            "decisionId": "8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab",
            "sha256": "ec507cbcdcc5d9e355080444f325615c79a66cbdeffc3c92f20c9ded983f4b27"
        },
        "candidatePoolFingerprint": {
            "sha256": "da0435ce1d114de9d8718464de92b3e7a29ae11285f6086f994aeabf4add9d55"
        },
        "orderedActions": [{
            "actionKey": {
                "candidateNamespace": "serving_post_id",
                "candidateId": "507f191e810c19729de8c001",
                "servedPosition": 1
            },
            "selectedWasDeterministicTop": true,
            "plackettLuceProbability": 0.75,
            "conditionalSelectionProbability": 0.95
        }],
        "supportDiagnostics": {
            "sourceCandidateCount": 2,
            "eligibleCandidateCount": 2,
            "excludedIneligibleCandidateCount": 0,
            "sampledCount": 1,
            "withoutReplacement": true
        },
        "numericalDiagnostics": {
            "probabilityMassTolerance": 1e-12,
            "maxProbabilityMassError": 0.0,
            "steps": [{
                "servedPosition": 1,
                "remainingCandidateCount": 2,
                "plackettLuceProbabilityMass": 1.0,
                "mixedProbabilityMass": 1.0,
                "probabilityMassError": 0.0
            }]
        },
        "evidenceKind": "simulated_propensity",
        "servable": false,
        "simulationSha256": "0000000000000000000000000000000000000000000000000000000000000000"
    })
}

fn valid_output() -> RandomizedSlateSimulationV1 {
    let mut output: RandomizedSlateSimulationV1 =
        serde_json::from_value(valid_output_json()).unwrap();
    output.simulation_sha256 = compute_simulation_sha256(&output).unwrap();
    output
}

fn valid_pair() -> (
    RandomizedSlateSimulationInputV1,
    RandomizedSlateSimulationV1,
) {
    let input: RandomizedSlateSimulationInputV1 =
        serde_json::from_value(valid_input_json()).unwrap();
    let mut output = valid_output();
    let source = input.parsed_source_decision_log().unwrap();
    output.decision_fingerprint.sha256 = input.source_decision_log_sha256.clone();
    output.candidate_pool_fingerprint.sha256 = source.candidate_pool.candidate_pool_sha256.clone();
    let logits = source
        .candidate_pool
        .candidates
        .iter()
        .filter(|candidate| candidate.eligible)
        .map(|candidate| candidate.score.unwrap())
        .collect::<Vec<_>>();
    let distribution =
        compute_full_distribution(&logits, input.config.epsilon, input.config.temperature).unwrap();
    output.ordered_actions[0].plackett_luce_probability = distribution.probabilities[0].0;
    output.ordered_actions[0].conditional_selection_probability = distribution.probabilities[0].1;
    output.numerical_diagnostics.steps[0].plackett_luce_probability_mass =
        distribution.diagnostics.plackett_luce_mass;
    output.numerical_diagnostics.steps[0].mixed_probability_mass =
        distribution.diagnostics.mixed_mass;
    output.numerical_diagnostics.steps[0].probability_mass_error = distribution
        .diagnostics
        .plackett_luce_mass_error
        .max(distribution.diagnostics.mixed_mass_error);
    output.numerical_diagnostics.max_probability_mass_error =
        output.numerical_diagnostics.steps[0].probability_mass_error;
    output.simulation_sha256 = compute_simulation_sha256(&output).unwrap();
    (input, output)
}

fn valid_input_json() -> Value {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../telegram-recommendation-fixtures/fixtures/decision_log_v1.json"
    ))
    .unwrap();
    let mut source = fixture["decisionLog"].clone();
    source["candidatePool"]["candidates"][1]["score"] = json!(-0.378_964_779_926_598_3);
    source["candidatePool"]["candidatePoolSha256"] = json!(
        candidate_pool_sha256(
            source["candidatePool"]["candidates"]
                .as_array()
                .expect("candidate array")
        )
        .unwrap()
    );
    let source_sha256 = sha256_hex(canonical_json(&source).unwrap());
    json!({
        "contractVersion": "randomized_slate_simulation_input_v1",
        "sourceDecisionLog": source,
        "sourceDecisionLogSha256": source_sha256,
        "config": {
            "policyId": "eligible_pool_epsilon_plackett_luce_v1",
            "policyVersion": "policy-v1",
            "configVersion": "config-v1",
            "epsilon": 0.2,
            "temperature": 1.0,
            "slateSize": 1
        },
        "uniformDraws": [0.25]
    })
}

#[test]
fn canonicalizes_sorted_objects_and_f64_bits() {
    let value = json!({
        "z": [1, -0.0],
        "a": { "right": 1.0, "left": 0 }
    });

    assert_eq!(
        canonical_json(&value).unwrap(),
        "{\"a\":{\"left\":{\"$f64\":\"0000000000000000\"},\"right\":{\"$f64\":\"3ff0000000000000\"}},\"z\":[{\"$f64\":\"3ff0000000000000\"},{\"$f64\":\"0000000000000000\"}]}"
    );
}

#[test]
fn candidate_pool_digest_matches_node_fixture_rule() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../telegram-recommendation-fixtures/fixtures/decision_log_v1.json"
    ))
    .unwrap();
    let candidates = fixture["decisionLog"]["candidatePool"]["candidates"]
        .as_array()
        .unwrap();

    assert_eq!(
        candidate_pool_sha256(candidates).unwrap(),
        fixture["expectedCandidatePoolSha256"].as_str().unwrap()
    );
}

#[test]
fn decision_log_allows_sparse_absolute_served_positions() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../telegram-recommendation-fixtures/fixtures/decision_log_v1.json"
    ))
    .unwrap();
    let mut source = fixture["decisionLog"].clone();
    source["candidatePool"]["candidates"][0]["servedPosition"] = json!(2);
    source["actions"][0]["actionKey"]["servedPosition"] = json!(2);
    source["candidatePool"]["candidatePoolSha256"] = json!(
        candidate_pool_sha256(
            source["candidatePool"]["candidates"]
                .as_array()
                .expect("candidate array")
        )
        .unwrap()
    );

    let decision: RecommendationDecisionLogV1 = serde_json::from_value(source).unwrap();
    decision.validate().unwrap();
}

#[test]
fn simulation_digest_excludes_only_its_own_field() {
    let mut output = valid_output();
    output.validate().unwrap();
    let digest = output.simulation_sha256.clone();

    assert!(verify_simulation_sha256(&output).unwrap());
    output.policy.config_version = "config-v2".to_string();
    assert!(!verify_simulation_sha256(&output).unwrap());
    output.simulation_sha256 = digest;
    assert!(!verify_simulation_sha256(&output).unwrap());
}

#[test]
fn serde_is_strict_and_rejects_illegal_servable_or_probability() {
    let value = valid_output_json();
    let output: RandomizedSlateSimulationV1 = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(output).unwrap(), value);

    let mut invalid = value.clone();
    invalid["servable"] = json!(true);
    assert!(serde_json::from_value::<RandomizedSlateSimulationV1>(invalid).is_err());

    let mut invalid = value.clone();
    invalid["orderedActions"][0]["conditionalSelectionProbability"] = json!(0.0);
    assert!(serde_json::from_value::<RandomizedSlateSimulationV1>(invalid).is_err());

    let mut invalid = value;
    invalid["unexpected"] = json!(true);
    assert!(serde_json::from_value::<RandomizedSlateSimulationV1>(invalid).is_err());
}

#[test]
fn input_round_trip_locks_policy_literal_and_source_fingerprints() {
    let value = valid_input_json();
    let input: RandomizedSlateSimulationInputV1 = serde_json::from_value(value.clone()).unwrap();
    input.validate().unwrap();
    assert_eq!(serde_json::to_value(input).unwrap(), value);

    let mut invalid = value;
    invalid["config"]["policyId"] = json!("other_policy");
    assert!(serde_json::from_value::<RandomizedSlateSimulationInputV1>(invalid).is_err());
}

#[test]
fn validation_rejects_minus_mixture_and_non_contiguous_positions() {
    let mut output = valid_output();
    output.ordered_actions[0].conditional_selection_probability = 0.65;
    assert!(output.validate().is_err());

    let mut invalid = valid_output_json();
    invalid["orderedActions"][0]["actionKey"]["servedPosition"] = json!(2);
    let output: RandomizedSlateSimulationV1 = serde_json::from_value(invalid).unwrap();
    assert!(output.validate().is_err());
}

#[test]
fn input_rejects_closed_uniform_boundaries_and_zero_epsilon() {
    let mut invalid = valid_input_json();
    invalid["config"]["epsilon"] = json!(0.0);
    assert!(serde_json::from_value::<RandomizedSlateSimulationInputV1>(invalid).is_err());

    let mut invalid = valid_input_json();
    invalid["uniformDraws"] = json!([0.0]);
    assert!(serde_json::from_value::<RandomizedSlateSimulationInputV1>(invalid).is_err());

    let mut invalid = valid_input_json();
    invalid["uniformDraws"] = json!([1.0]);
    assert!(serde_json::from_value::<RandomizedSlateSimulationInputV1>(invalid).is_err());

    let mut valid = valid_input_json();
    valid["config"]["epsilon"] = json!(1.0);
    serde_json::from_value::<RandomizedSlateSimulationInputV1>(valid).unwrap();

    let mut input: RandomizedSlateSimulationInputV1 =
        serde_json::from_value(valid_input_json()).unwrap();
    input.config.epsilon = 0.0;
    assert!(input.validate().is_err());
    input.config.epsilon = 0.2;
    input.uniform_draws[0] = 0.0;
    assert!(input.validate().is_err());
}

#[test]
fn input_and_output_reject_silent_short_slates() {
    let mut input = valid_input_json();
    input["config"]["slateSize"] = json!(3);
    input["uniformDraws"] = json!([0.2, 0.4]);
    let input: RandomizedSlateSimulationInputV1 = serde_json::from_value(input).unwrap();
    assert!(input.validate().is_err());

    let mut output = valid_output_json();
    output["policy"]["slateSize"] = json!(3);
    let output: RandomizedSlateSimulationV1 = serde_json::from_value(output).unwrap();
    assert!(compute_simulation_sha256(&output).is_err());
    assert!(output.validate().is_err());
}

#[test]
fn validation_rejects_placeholder_or_drifted_simulation_digest() {
    let output: RandomizedSlateSimulationV1 = serde_json::from_value(valid_output_json()).unwrap();
    assert!(output.validate().is_err());

    let mut output = valid_output();
    output.policy.config_version = "drifted".to_string();
    assert!(output.validate().is_err());
}

#[test]
fn source_digest_preserves_raw_decision_time_representation() {
    for decision_at in ["2026-07-16T08:00:00.000Z", "2026-07-16T16:00:00+08:00"] {
        let mut value = valid_input_json();
        value["sourceDecisionLog"]["decisionAt"] = json!(decision_at);
        value["sourceDecisionLogSha256"] = json!(sha256_hex(
            canonical_json(&value["sourceDecisionLog"]).unwrap()
        ));

        let input: RandomizedSlateSimulationInputV1 = serde_json::from_value(value).unwrap();
        input.validate().unwrap();
        assert_eq!(
            input
                .parsed_source_decision_log()
                .unwrap()
                .decision_at
                .to_rfc3339(),
            "2026-07-16T08:00:00+00:00"
        );
    }
}

#[test]
fn output_validation_binds_to_the_exact_input() {
    let (input, output) = valid_pair();
    output.validate_against(&input).unwrap();

    let mut drifted = output.clone();
    drifted.decision_fingerprint.sha256 =
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string();
    drifted.simulation_sha256 = compute_simulation_sha256(&drifted).unwrap();
    assert!(drifted.validate_against(&input).is_err());

    let mut drifted = output.clone();
    drifted.policy.config_version = "other-config".to_string();
    drifted.simulation_sha256 = compute_simulation_sha256(&drifted).unwrap();
    assert!(drifted.validate_against(&input).is_err());

    let mut drifted = output;
    drifted.support_diagnostics.eligible_candidate_count = 1;
    drifted
        .support_diagnostics
        .excluded_ineligible_candidate_count = 1;
    drifted.numerical_diagnostics.steps[0].remaining_candidate_count = 1;
    drifted.simulation_sha256 = compute_simulation_sha256(&drifted).unwrap();
    assert!(drifted.validate_against(&input).is_err());
}

#[test]
fn paired_validation_rejects_action_outside_eligible_pool() {
    let (input, mut output) = valid_pair();
    output.ordered_actions[0].action_key.candidate_id = "unknown-candidate".to_string();
    output.simulation_sha256 = compute_simulation_sha256(&output).unwrap();

    assert!(output.validate().is_ok());
    assert!(output.validate_against(&input).is_err());
}

#[test]
fn paired_validation_rejects_forged_deterministic_top_evidence() {
    let (input, mut output) = valid_pair();
    output.ordered_actions[0].selected_was_deterministic_top = false;
    output.ordered_actions[0].conditional_selection_probability =
        input.config.epsilon * output.ordered_actions[0].plackett_luce_probability;
    output.simulation_sha256 = compute_simulation_sha256(&output).unwrap();

    assert!(output.validate().is_ok());
    assert!(output.validate_against(&input).is_err());
}

#[test]
fn paired_validation_replays_uniform_draws_and_probabilities() {
    let (input, output) = valid_pair();
    let mut forged = output.clone();
    forged.ordered_actions[0].plackett_luce_probability = 0.5;
    forged.ordered_actions[0].conditional_selection_probability = 0.9;
    forged.simulation_sha256 = compute_simulation_sha256(&forged).unwrap();
    assert!(forged.validate().is_ok());
    assert!(forged.validate_against(&input).is_err());

    let mut drifted_draw = input.clone();
    drifted_draw.uniform_draws[0] = 0.99;
    assert!(output.validate_against(&drifted_draw).is_err());
}

#[test]
fn paired_validation_uses_identity_order_to_break_pool_rank_ties() {
    let mut input = valid_input_json();
    input["sourceDecisionLog"]["candidatePool"]["candidates"][1]["poolRank"] = json!(1);
    let candidates = input["sourceDecisionLog"]["candidatePool"]["candidates"]
        .as_array()
        .unwrap();
    let pool_sha256 = candidate_pool_sha256(candidates).unwrap();
    input["sourceDecisionLog"]["candidatePool"]["candidatePoolSha256"] = json!(pool_sha256.clone());
    let decision_sha256 = sha256_hex(canonical_json(&input["sourceDecisionLog"]).unwrap());
    input["sourceDecisionLogSha256"] = json!(decision_sha256.clone());
    let input: RandomizedSlateSimulationInputV1 = serde_json::from_value(input).unwrap();

    let mut output = valid_output();
    output.decision_fingerprint.sha256 = decision_sha256;
    output.candidate_pool_fingerprint.sha256 = pool_sha256;
    output.ordered_actions[0].action_key.candidate_id = "507f191e810c19729de8c002".to_string();
    output.ordered_actions[0].selected_was_deterministic_top = false;
    output.ordered_actions[0].conditional_selection_probability = 0.15;
    output.simulation_sha256 = compute_simulation_sha256(&output).unwrap();

    assert!(output.validate_against(&input).is_err());
}

#[test]
fn baseline_comparator_uses_namespace_wire_tag_before_candidate_bytes() {
    let input: RandomizedSlateSimulationInputV1 =
        serde_json::from_value(valid_input_json()).unwrap();
    let source = input.parsed_source_decision_log().unwrap();
    let mut left = source.candidate_pool.candidates[0].clone();
    let mut right = source.candidate_pool.candidates[1].clone();
    right.pool_rank = left.pool_rank;
    left.candidate_namespace = CandidateNamespace::ServingPostId;
    left.candidate_id = "a".to_string();
    right.candidate_namespace = CandidateNamespace::ModelPostId;
    right.candidate_id = "z".to_string();
    assert_eq!(
        compare_decision_pool_baseline(&left, &right),
        Ordering::Greater
    );

    left.candidate_namespace = CandidateNamespace::ModelPostId;
    assert_eq!(
        compare_decision_pool_baseline(&left, &right),
        Ordering::Less
    );
}

#[test]
fn input_rejects_duplicate_candidate_identity_even_with_valid_fingerprints() {
    let mut input = valid_input_json();
    input["sourceDecisionLog"]["candidatePool"]["candidates"][1]["candidateId"] =
        input["sourceDecisionLog"]["candidatePool"]["candidates"][0]["candidateId"].clone();
    let candidates = input["sourceDecisionLog"]["candidatePool"]["candidates"]
        .as_array()
        .unwrap();
    input["sourceDecisionLog"]["candidatePool"]["candidatePoolSha256"] =
        json!(candidate_pool_sha256(candidates).unwrap());
    input["sourceDecisionLogSha256"] = json!(sha256_hex(
        canonical_json(&input["sourceDecisionLog"]).unwrap()
    ));
    let input: RandomizedSlateSimulationInputV1 = serde_json::from_value(input).unwrap();

    assert!(input.validate().is_err());
}
