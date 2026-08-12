use std::{collections::HashMap, fs, io::Cursor, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use telegram_ranking_primitives::{
    ActionWeightedScoreInput, HeuristicWeightedScoreInput, PhoenixWeightedScoreInput,
    WeightedScoreInput, compute_weighted_score_summary, normalize_weighted_score,
};
use telegram_recommendation_contracts::contracts::decision_log::RecommendationDecisionLogV1;
use telegram_recommendation_contracts::contracts::query::EmbeddingContextPayload;
use telegram_recommendation_contracts::{
    RandomizedSlateConfigV1, RandomizedSlateEvidenceKind, RandomizedSlateSimulationInputV1,
    RandomizedSlateSimulationV1, TargetDistributionStreamVerificationReceiptV2,
    TargetPolicyDistributionVerificationReceiptV1, candidate_pool_sha256, canonical_json,
    compute_simulation_sha256, sha256_hex,
};
use telegram_recommendation_fixtures::parse_replay_case_fixtures;
use telegram_recommendation_policy_offline::target_distribution::{
    build_target_distribution_stream, verify_target_distribution_from_readers,
    verify_target_distribution_stream,
};

const FLOAT_TOLERANCE: f64 = 1e-8;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CrossRuntimeManifest {
    manifest_version: String,
    domains: Vec<FixtureDomain>,
}

#[derive(Debug, Deserialize)]
struct FixtureDomain {
    domain: String,
    version: String,
    fixtures: Vec<FixtureReference>,
}

#[derive(Debug, Deserialize)]
struct FixtureReference {
    path: String,
    digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeightedScoreFixture {
    fixture_version: String,
    identity: IdentityEnvelope,
    cases: Vec<WeightedScoreCase>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct IdentityEnvelope {
    serving_post_id: String,
    model_post_id: String,
    id_namespace: String,
}

#[derive(Debug, Deserialize)]
struct WeightedScoreCase {
    name: String,
    input: WeightedScoreFixtureInput,
    expected: GoldenWeightedScoreSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeightedScoreFixtureInput {
    #[serde(default)]
    phoenix_scores: Option<HashMap<String, f64>>,
    #[serde(default)]
    action_scores: Option<HashMap<String, f64>>,
    #[serde(default)]
    heuristic_scores: HashMap<String, f64>,
    #[serde(default)]
    evidence_prior: f64,
    #[serde(default)]
    signal_prior: f64,
    #[serde(default)]
    video_duration_sec: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct GoldenWeightedScoreSummary {
    input_mode: String,
    base_raw_score: f64,
    positive_score: f64,
    negative_score: f64,
    evidence_score: f64,
    raw_score: f64,
    normalized_weighted_score: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RandomizedSlateFixture {
    fixture_version: String,
    input: RandomizedSlateSimulationInputV1,
    expected: RandomizedSlateSimulationV1,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyntheticBehaviorTrajectoryFixture {
    fixture_version: String,
    target_fixture_path: String,
    behavior_policy_config_sha256: String,
    target_policy_config_sha256: String,
    input: RandomizedSlateSimulationInputV1,
    expected: RandomizedSlateSimulationV1,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TargetDistributionStreamFixture {
    fixture_version: String,
    dataset_version: String,
    source_decision_ndjson: String,
    source_dataset_manifest_raw: String,
    policy_config_raw: String,
    expected_distribution_ndjson: String,
    expected_target_manifest_raw: String,
    expected_receipt: TargetPolicyDistributionVerificationReceiptV1,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TargetDistributionStreamReceiptFixtureV2 {
    fixture_version: String,
    source_fixture_path: String,
    expected_receipt: TargetDistributionStreamVerificationReceiptV2,
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name)
}

fn fixture_version(value: &Value) -> Option<&str> {
    [
        "fixtureVersion",
        "replayVersion",
        "manifestVersion",
        "contractVersion",
    ]
    .into_iter()
    .find_map(|key| value.get(key).and_then(Value::as_str))
}

fn score(map: &HashMap<String, f64>, key: &str) -> f64 {
    map.get(key).copied().unwrap_or_default()
}

fn score_input(input: &WeightedScoreFixtureInput) -> WeightedScoreInput {
    WeightedScoreInput {
        phoenix_scores: input
            .phoenix_scores
            .as_ref()
            .map(|scores| PhoenixWeightedScoreInput {
                like: score(scores, "like"),
                reply: score(scores, "reply"),
                repost: score(scores, "repost"),
                quote: score(scores, "quote"),
                photo_expand: score(scores, "photoExpand"),
                click: score(scores, "click"),
                quoted_click: score(scores, "quotedClick"),
                profile_click: score(scores, "profileClick"),
                video_quality_view: if input.video_duration_sec.unwrap_or_default() > 5.0 {
                    score(scores, "videoQualityView")
                } else {
                    0.0
                },
                share: score(scores, "share"),
                share_via_dm: score(scores, "shareViaDm"),
                share_via_copy_link: score(scores, "shareViaCopyLink"),
                dwell: score(scores, "dwell"),
                dwell_time: score(scores, "dwellTime"),
                follow_author: score(scores, "followAuthor"),
                not_interested: score(scores, "notInterested"),
                dismiss: score(scores, "dismiss"),
                block_author: score(scores, "blockAuthor"),
                block: score(scores, "block"),
                mute_author: score(scores, "muteAuthor"),
                report: score(scores, "report"),
            }),
        action_scores: input
            .action_scores
            .as_ref()
            .map(|scores| ActionWeightedScoreInput {
                like: score(scores, "like"),
                reply: score(scores, "reply"),
                repost: score(scores, "repost"),
                click: score(scores, "click"),
                dwell: score(scores, "dwell"),
                negative: score(scores, "negative"),
            }),
        heuristic_scores: HeuristicWeightedScoreInput {
            engagement_rate: score(&input.heuristic_scores, "engagementRate"),
            reply_proxy: score(&input.heuristic_scores, "replyProxy"),
            repost_proxy: score(&input.heuristic_scores, "repostProxy"),
            click_proxy: score(&input.heuristic_scores, "clickProxy"),
            content_proxy: score(&input.heuristic_scores, "contentProxy"),
            follow_proxy: score(&input.heuristic_scores, "followProxy"),
            retrieval_support: score(&input.heuristic_scores, "retrievalSupport"),
        },
        evidence_prior: input.evidence_prior,
        signal_prior: input.signal_prior,
    }
}

fn assert_close(case: &str, field: &str, actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= FLOAT_TOLERANCE,
        "{case}.{field}: expected {expected}, got {actual}"
    );
}

#[test]
fn manifest_references_versioned_fixture_files_with_digests() {
    let raw = fs::read_to_string(fixture_path("cross_runtime_manifest.json"))
        .expect("read cross-runtime manifest");
    let manifest: CrossRuntimeManifest = serde_json::from_str(&raw).expect("parse manifest");

    assert_eq!(
        manifest.manifest_version,
        "recommendation_cross_runtime_manifest_v1"
    );
    assert_eq!(manifest.domains.len(), 9);

    for domain in manifest.domains {
        assert!(!domain.domain.trim().is_empty());
        assert!(!domain.fixtures.is_empty());
        for fixture in domain.fixtures {
            assert!(
                fixture.digest.len() == 64
                    && fixture.digest.bytes().all(|byte| byte.is_ascii_hexdigit()),
                "{} must have a SHA-256 digest",
                fixture.path
            );
            let fixture_raw = fs::read(fixture_path(&fixture.path))
                .unwrap_or_else(|error| panic!("read {}: {error}", fixture.path));
            assert_eq!(
                format!("{:x}", Sha256::digest(&fixture_raw)),
                fixture.digest,
                "{} digest drifted from manifest",
                fixture.path
            );
            let fixture_value: Value = serde_json::from_slice(&fixture_raw)
                .unwrap_or_else(|error| panic!("parse {}: {error}", fixture.path));
            assert_eq!(
                fixture_version(&fixture_value),
                Some(domain.version.as_str()),
                "{} version drifted from manifest",
                fixture.path
            );
        }
    }
}

#[test]
fn randomized_slate_fixture_round_trips_and_binds_all_digests() {
    let raw = fs::read_to_string(fixture_path("randomized_slate_simulation_v1.json"))
        .expect("read randomized slate fixture");
    let fixture: RandomizedSlateFixture =
        serde_json::from_str(&raw).expect("deserialize randomized slate fixture");

    assert_eq!(
        fixture.fixture_version,
        "randomized_slate_simulation_fixture_v1"
    );
    fixture.input.validate().expect("validate simulation input");
    fixture
        .expected
        .validate_against(&fixture.input)
        .expect("validate simulation output against input");
    assert_eq!(
        serde_json::to_value(&fixture).expect("serialize randomized slate fixture"),
        serde_json::from_str::<Value>(&raw).expect("parse randomized slate fixture value")
    );

    let source = fixture
        .input
        .parsed_source_decision_log()
        .expect("parse source decision log");
    assert_eq!(
        candidate_pool_sha256(&source.candidate_pool.candidates).unwrap(),
        source.candidate_pool.candidate_pool_sha256
    );
    assert_eq!(
        sha256_hex(canonical_json(&fixture.input.source_decision_log).unwrap()),
        fixture.input.source_decision_log_sha256
    );
    assert_eq!(
        compute_simulation_sha256(&fixture.expected).unwrap(),
        fixture.expected.simulation_sha256
    );
}

#[test]
fn phase11_synthetic_behavior_fixture_binds_target_source_and_logged_trajectory() {
    let raw = fs::read_to_string(fixture_path(
        "phase11_synthetic_behavior_trajectory_v1.json",
    ))
    .expect("read Phase 11 synthetic behavior fixture");
    let fixture: SyntheticBehaviorTrajectoryFixture =
        serde_json::from_str(&raw).expect("deserialize Phase 11 synthetic behavior fixture");
    assert_eq!(
        fixture.fixture_version,
        "randomized_slate_simulation_fixture_v1"
    );
    assert_eq!(
        fixture.target_fixture_path,
        "target_policy_distribution_stream_v1.json"
    );

    let target_raw = fs::read_to_string(fixture_path(&fixture.target_fixture_path))
        .expect("read target distribution fixture");
    let target: TargetDistributionStreamFixture =
        serde_json::from_str(&target_raw).expect("parse target distribution fixture");
    let target_source_value: Value = serde_json::from_str(target.source_decision_ndjson.trim_end())
        .expect("parse target source decision");
    assert_eq!(fixture.input.source_decision_log, target_source_value);
    assert_eq!(
        fixture.input.source_decision_log["candidatePool"],
        target_source_value["candidatePool"]
    );

    let target_source: RecommendationDecisionLogV1 =
        serde_json::from_value(target_source_value).expect("deserialize target source decision");
    let target_action_keys = target_source
        .actions
        .iter()
        .map(|action| action.action_key.clone())
        .collect::<Vec<_>>();
    let behavior_action_keys = fixture
        .expected
        .ordered_actions
        .iter()
        .map(|action| action.action_key.clone())
        .collect::<Vec<_>>();
    assert_eq!(behavior_action_keys, target_action_keys);

    let target_config: RandomizedSlateConfigV1 =
        serde_json::from_str(&target.policy_config_raw).expect("parse target policy config");
    assert_eq!(
        fixture.behavior_policy_config_sha256,
        sha256_hex(canonical_json(&fixture.input.config).unwrap())
    );
    assert_eq!(
        fixture.target_policy_config_sha256,
        sha256_hex(canonical_json(&target_config).unwrap())
    );
    assert_eq!(
        fixture.target_policy_config_sha256,
        target.expected_receipt.policy_config_sha256
    );
    assert_ne!(
        fixture.behavior_policy_config_sha256,
        fixture.target_policy_config_sha256
    );

    fixture.input.validate().expect("validate behavior input");
    fixture
        .expected
        .validate_against(&fixture.input)
        .expect("validate behavior output against input");
    assert_eq!(
        fixture.expected.evidence_kind,
        RandomizedSlateEvidenceKind::SimulatedPropensity
    );
    assert!(!fixture.expected.servable);
    assert_eq!(
        serde_json::to_value(&fixture).expect("serialize synthetic behavior fixture"),
        serde_json::from_str::<Value>(&raw).expect("parse synthetic behavior fixture value")
    );
}

#[test]
fn target_distribution_stream_fixture_is_rebuilt_and_verified_by_rust() {
    let raw = fs::read_to_string(fixture_path("target_policy_distribution_stream_v1.json"))
        .expect("read target distribution stream fixture");
    let fixture: TargetDistributionStreamFixture =
        serde_json::from_str(&raw).expect("parse target distribution stream fixture");
    assert_eq!(
        fixture.fixture_version,
        "target_policy_distribution_stream_fixture_v1"
    );

    let built = build_target_distribution_stream(
        fixture.source_decision_ndjson.as_bytes(),
        fixture.source_dataset_manifest_raw.as_bytes(),
        fixture.policy_config_raw.as_bytes(),
    )
    .expect("rebuild target distribution fixture");
    assert_eq!(built.manifest.dataset_version, fixture.dataset_version);
    assert_eq!(
        built.ndjson,
        fixture.expected_distribution_ndjson.as_bytes()
    );
    assert_eq!(
        telegram_recommendation_contracts::target_distribution_manifest_bytes(&built.manifest)
            .unwrap(),
        fixture.expected_target_manifest_raw.as_bytes()
    );
    assert_eq!(
        verify_target_distribution_stream(
            fixture.source_decision_ndjson.as_bytes(),
            fixture.source_dataset_manifest_raw.as_bytes(),
            fixture.policy_config_raw.as_bytes(),
            fixture.expected_distribution_ndjson.as_bytes(),
            fixture.expected_target_manifest_raw.as_bytes(),
        )
        .expect("verify target distribution fixture"),
        fixture.expected_receipt
    );
}

#[test]
fn target_distribution_stream_receipt_v2_is_rebuilt_by_bounded_reader_core() {
    let receipt_raw =
        fs::read_to_string(fixture_path("target_distribution_stream_receipt_v2.json"))
            .expect("read stream receipt fixture");
    let receipt_fixture: TargetDistributionStreamReceiptFixtureV2 =
        serde_json::from_str(&receipt_raw).expect("parse stream receipt fixture");
    assert_eq!(
        receipt_fixture.fixture_version,
        "target_distribution_stream_receipt_fixture_v2"
    );
    let source_raw = fs::read_to_string(fixture_path(&receipt_fixture.source_fixture_path))
        .expect("read source stream fixture");
    let source: TargetDistributionStreamFixture =
        serde_json::from_str(&source_raw).expect("parse source stream fixture");

    let receipt = verify_target_distribution_from_readers(
        Cursor::new(source.source_decision_ndjson.as_bytes()),
        source.source_dataset_manifest_raw.as_bytes(),
        source.policy_config_raw.as_bytes(),
        Cursor::new(source.expected_distribution_ndjson.as_bytes()),
        source.expected_target_manifest_raw.as_bytes(),
    )
    .expect("verify v2 stream receipt fixture");
    assert_eq!(receipt, receipt_fixture.expected_receipt);
    receipt.validate().expect("validate v2 receipt self hash");
}

#[test]
fn decision_log_fixture_round_trips_and_rejects_invalid_probability() {
    let raw = fs::read_to_string(fixture_path("decision_log_v1.json"))
        .expect("read decision log fixture");
    let fixture: Value = serde_json::from_str(&raw).expect("parse decision log fixture envelope");
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(fixture["decisionLog"].clone()).expect("deserialize decision log");
    decision.validate().expect("validate decision log");
    let round_trip = serde_json::to_value(&decision).expect("serialize decision log");

    assert_eq!(round_trip, fixture["decisionLog"]);
    assert_eq!(round_trip["actions"][0]["actionKey"]["servedPosition"], 1);

    let mut invalid = round_trip;
    invalid["actions"][0]["behaviorPropensity"] = serde_json::json!({
        "status": "logged_randomized",
        "selectionProbability": 0.0
    });
    assert!(serde_json::from_value::<RecommendationDecisionLogV1>(invalid).is_err());
}

#[test]
fn decision_log_fixture_has_cross_runtime_canonical_digests() {
    let raw = fs::read_to_string(fixture_path("decision_log_v1.json"))
        .expect("read decision log fixture");
    let fixture: Value = serde_json::from_str(&raw).expect("parse decision log fixture envelope");
    let decision = &fixture["decisionLog"];
    let candidate_lines = decision["candidatePool"]["candidates"]
        .as_array()
        .expect("candidate array")
        .iter()
        .map(|candidate| canonical_decision_json(candidate))
        .collect::<Vec<_>>();
    let candidate_ndjson = format!("{}\n", candidate_lines.join("\n"));

    assert_eq!(
        format!("{:x}", Sha256::digest(candidate_ndjson.as_bytes())),
        fixture["expectedCandidatePoolSha256"].as_str().unwrap()
    );
    assert_eq!(
        format!(
            "{:x}",
            Sha256::digest(canonical_decision_json(decision).as_bytes())
        ),
        fixture["expectedDecisionSha256"].as_str().unwrap()
    );

    let edge_case = &fixture["canonicalizationCase"];
    assert_eq!(
        canonical_decision_json(&edge_case["left"]),
        edge_case["expectedCanonical"].as_str().unwrap()
    );
    assert_eq!(
        canonical_decision_json(&edge_case["right"]),
        edge_case["expectedCanonical"].as_str().unwrap()
    );
}

#[test]
fn decision_log_validation_rejects_illegal_cross_field_combinations() {
    let raw = fs::read_to_string(fixture_path("decision_log_v1.json"))
        .expect("read decision log fixture");
    let fixture: Value = serde_json::from_str(&raw).expect("parse decision log fixture envelope");

    let mut invalid = fixture["decisionLog"].clone();
    invalid["requestId"] = serde_json::json!("not-a-uuid");
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(invalid).expect("deserialize invalid decision shape");
    assert!(decision.validate().is_err());

    let mut invalid = fixture["decisionLog"].clone();
    invalid["candidatePool"]["candidates"][0]["selected"] = serde_json::json!(false);
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(invalid).expect("deserialize invalid candidate state");
    assert!(decision.validate().is_err());

    let mut invalid = fixture["decisionLog"].clone();
    invalid["candidatePool"]["candidatePoolSha256"] = serde_json::json!("0".repeat(64));
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(invalid).expect("deserialize drifted pool digest");
    assert!(decision.validate().is_err());

    let mut invalid = fixture["decisionLog"].clone();
    invalid["candidatePool"]["candidates"][1]["candidateId"] =
        invalid["candidatePool"]["candidates"][0]["candidateId"].clone();
    invalid["candidatePool"]["candidatePoolSha256"] = serde_json::json!(
        candidate_pool_sha256(
            invalid["candidatePool"]["candidates"]
                .as_array()
                .expect("candidate array")
        )
        .unwrap()
    );
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(invalid).expect("deserialize duplicate candidate identity");
    assert!(decision.validate().is_err());

    let mut invalid = fixture["decisionLog"].clone();
    invalid["candidatePool"]["candidates"][0]["eligible"] = serde_json::json!(false);
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(invalid).expect("deserialize ineligible selected candidate");
    assert!(decision.validate().is_err());

    let mut invalid = fixture["decisionLog"].clone();
    invalid["actions"] = serde_json::json!([]);
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(invalid).expect("deserialize missing action state");
    assert!(decision.validate().is_err());

    let mut invalid = fixture["decisionLog"].clone();
    invalid["actions"][0]["behaviorPropensity"] = serde_json::json!({
        "status": "logged_randomized",
        "selectionProbability": 0.5
    });
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(invalid).expect("deserialize deterministic randomized action");
    assert!(decision.validate().is_err());

    let mut invalid = fixture["decisionLog"].clone();
    invalid["behaviorPolicyKind"] = serde_json::json!("logged_randomized");
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(invalid).expect("deserialize randomized deterministic action");
    assert!(decision.validate().is_err());

    let mut valid = fixture["decisionLog"].clone();
    valid["behaviorPolicyKind"] = serde_json::json!("logged_randomized");
    valid["actions"][0]["behaviorPropensity"] = serde_json::json!({
        "status": "unknown_support",
        "reason": "pool_truncated"
    });
    let decision: RecommendationDecisionLogV1 =
        serde_json::from_value(valid).expect("deserialize fail-closed randomized action");
    decision.validate().expect("validate unknown support");
}

fn canonical_decision_json(value: &Value) -> String {
    serde_json::to_string(&canonical_decision_value(value)).expect("serialize canonical value")
}

fn canonical_decision_value(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonical_decision_value).collect()),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .map(|key| (key.clone(), canonical_decision_value(&values[key])))
                    .collect(),
            )
        }
        Value::Number(value) => {
            let number = value.as_f64().expect("JSON number as f64");
            let bits = if number == 0.0 { 0 } else { number.to_bits() };
            serde_json::json!({ "$f64": format!("{bits:016x}") })
        }
        _ => value.clone(),
    }
}

#[test]
fn weighted_fixture_matches_authoritative_rust_summary_and_identity_round_trip() {
    let raw = fs::read_to_string(fixture_path("weighted_score_golden.json"))
        .expect("read weighted score fixture");
    let fixture: WeightedScoreFixture =
        serde_json::from_str(&raw).expect("parse weighted score fixture");

    assert_eq!(
        fixture.fixture_version,
        "recommendation_weighted_score_golden_v1"
    );
    assert_eq!(fixture.cases.len(), 6);
    let identity_json = serde_json::to_string(&fixture.identity).expect("serialize identity");
    assert_eq!(
        serde_json::from_str::<IdentityEnvelope>(&identity_json).expect("deserialize identity"),
        fixture.identity
    );

    for case in fixture.cases {
        let input = score_input(&case.input);
        let input_mode = if input.phoenix_scores.is_some() {
            "phoenix"
        } else if input.action_scores.is_some() {
            "action"
        } else {
            "heuristic"
        };
        let summary = compute_weighted_score_summary(input);

        assert_eq!(
            input_mode, case.expected.input_mode,
            "{}.inputMode",
            case.name
        );
        assert_close(
            &case.name,
            "baseRawScore",
            summary.base_raw_score,
            case.expected.base_raw_score,
        );
        assert_close(
            &case.name,
            "positiveScore",
            summary.positive_score,
            case.expected.positive_score,
        );
        assert_close(
            &case.name,
            "negativeScore",
            summary.negative_score,
            case.expected.negative_score,
        );
        assert_close(
            &case.name,
            "evidenceScore",
            summary.evidence_score,
            case.expected.evidence_score,
        );
        assert_close(
            &case.name,
            "rawScore",
            summary.raw_score,
            case.expected.raw_score,
        );
        assert_close(
            &case.name,
            "normalizedWeightedScore",
            normalize_weighted_score(summary.raw_score),
            case.expected.normalized_weighted_score,
        );
    }
}

#[test]
fn replay_query_serde_round_trip_preserves_nested_embedding_contract() {
    let fixtures = parse_replay_case_fixtures().expect("parse replay fixtures");
    let query = &fixtures[0].scenarios[0].query;
    let round_trip = serde_json::to_value(query).expect("serialize replay query");

    assert_eq!(
        round_trip["embeddingContext"]["embeddingContract"],
        serde_json::json!({
            "embeddingSpace": "recommendation_two_tower_v1",
            "dimensions": 256,
            "retrievalEmbeddingDim": 256,
            "rankingEmbeddingDim": 256,
            "modelVersion": "2026-04-29_kuai_lite256",
            "artifactVersion": "2026-04-29_kuai_lite256",
            "producer": "cross_runtime_golden_fixture",
            "semantic": true
        })
    );
}

#[test]
fn partial_embedding_contract_survives_serde_round_trip() {
    let payload = serde_json::json!({
        "interestedInClusters": [],
        "producerEmbedding": [],
        "usable": true,
        "embeddingContract": {
            "embeddingSpace": "recommendation_two_tower_v1",
            "modelVersion": "2026-04-29_kuai_lite256"
        }
    });
    let context: EmbeddingContextPayload =
        serde_json::from_value(payload.clone()).expect("deserialize partial embedding contract");
    let round_trip = serde_json::to_value(context).expect("serialize partial embedding contract");

    assert_eq!(
        round_trip["embeddingContract"],
        payload["embeddingContract"]
    );
}

#[test]
fn embedding_contract_rejects_non_positive_dimensions() {
    for (field, value) in [
        ("dimensions", 0),
        ("dimensions", -1),
        ("retrievalEmbeddingDim", 0),
        ("retrievalEmbeddingDim", -1),
        ("rankingEmbeddingDim", 0),
        ("rankingEmbeddingDim", -1),
    ] {
        let mut contract = serde_json::json!({
            "embeddingSpace": "recommendation_two_tower_v1",
            "dimensions": 256,
            "retrievalEmbeddingDim": 256,
            "rankingEmbeddingDim": 256,
            "modelVersion": "2026-04-29_kuai_lite256",
            "artifactVersion": "2026-04-29_kuai_lite256",
            "producer": "cross_runtime_golden_fixture",
            "semantic": true
        });
        contract[field] = serde_json::json!(value);
        let payload = serde_json::json!({
            "interestedInClusters": [],
            "producerEmbedding": [],
            "usable": true,
            "embeddingContract": contract
        });

        assert!(
            serde_json::from_value::<EmbeddingContextPayload>(payload).is_err(),
            "{field}={value} must be rejected"
        );
    }
}
