use sha2::{Digest, Sha256};
use telegram_recommendation_contracts::{
    TargetDistributionStreamVerificationReceiptV2, TargetPolicyDistributionManifestV1,
    TargetPolicyDistributionRecordV1, TargetPolicyDistributionSourceDatasetManifestV1,
    TargetPolicyDistributionVerificationReceiptV1, canonical_json, canonical_wire_json,
    compute_decision_records_sha256, compute_target_distribution_receipt_sha256,
    compute_target_distribution_stream_receipt_sha256,
};

fn record_json(record_type: &str) -> serde_json::Value {
    match record_type {
        "decision_start" => serde_json::json!({
            "recordType": "decision_start",
            "contractVersion": "target_policy_distribution_v1",
            "decisionId": "8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab",
            "decisionFingerprint": {
                "decisionId": "8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab",
                "sha256": "1".repeat(64)
            },
            "candidatePoolFingerprint": { "sha256": "2".repeat(64) },
            "policy": {
                "policyId": "eligible_pool_epsilon_plackett_luce_v1",
                "policyVersion": "epsilon-pl-v1",
                "configVersion": "phase9-v1",
                "epsilon": 0.2,
                "temperature": 1.0,
                "slateSize": 2
            },
            "baselineOrderVersion": "decision_pool_rank_then_identity_v1",
            "probabilitySemantics": "conditional_on_prior_slate_prefix_v1",
            "evidenceKind": "simulated_target_distribution",
            "servable": false
        }),
        "step_start" => serde_json::json!({
            "recordType": "step_start",
            "decisionId": "8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab",
            "servedPosition": 1,
            "prefixActionKeys": [],
            "expectedActionCount": 2,
            "plackettLuceProbabilityMass": 1.0,
            "plackettLuceMassError": 0.0,
            "mixedProbabilityMass": 1.0,
            "mixedMassError": 0.0
        }),
        "action_probability" => serde_json::json!({
            "recordType": "action_probability",
            "decisionId": "8d3dd5de-a2c1-47e2-bafb-91bf557cf4ab",
            "actionKey": {
                "candidateNamespace": "serving_post_id",
                "candidateId": "507f191e810c19729de8c001",
                "servedPosition": 1
            },
            "deterministicTop": true,
            "plackettLuceProbability": 0.75,
            "conditionalSelectionProbability": 0.95
        }),
        _ => unreachable!(),
    }
}

#[test]
fn stream_receipt_v2_binds_io_mode_high_water_and_self_hash() {
    let mut receipt: TargetDistributionStreamVerificationReceiptV2 =
        serde_json::from_value(serde_json::json!({
            "contractVersion": "target_distribution_stream_verification_receipt_v2",
            "verifierVersion": "telegram_recommendation_policy_offline_stream_verifier_v2",
            "verifierBuildFingerprintSha256": "0".repeat(64),
            "ioMode": "bounded_stream_v1",
            "status": "verified",
            "sourceDecisionNdjsonSha256": "1".repeat(64),
            "sourceDatasetManifestSha256": "2".repeat(64),
            "policyConfigSha256": "3".repeat(64),
            "policyConfigRawSha256": "6".repeat(64),
            "distributionNdjsonSha256": "4".repeat(64),
            "targetManifestSha256": "5".repeat(64),
            "verifiedDecisionCount": 1,
            "verifiedStepCount": 1,
            "verifiedActionProbabilityCount": 2,
            "verifiedPhysicalRecordCount": 5,
            "highWaterDiagnostics": {
                "maxSourceLineBytes": 512,
                "maxDistributionLineBytes": 256,
                "maxCandidateCount": 2,
                "maxStepActionCount": 2,
                "maxPrefixActionCount": 0
            },
            "verificationReceiptSha256": "0".repeat(64),
            "servable": false
        }))
        .unwrap();
    receipt.verification_receipt_sha256 =
        compute_target_distribution_stream_receipt_sha256(&receipt).unwrap();
    receipt.validate().unwrap();

    receipt.high_water_diagnostics.max_candidate_count = 2_049;
    assert!(receipt.validate().is_err());
}

#[test]
fn source_dataset_manifest_is_strict_and_wire_json_preserves_numbers() {
    let manifest: TargetPolicyDistributionSourceDatasetManifestV1 =
        serde_json::from_value(serde_json::json!({
            "contractVersion": "target_policy_distribution_source_dataset_manifest_v1",
            "schemaVersion": "recommendation_decision_log_v1",
            "datasetVersion": "synthetic-phase9-v1",
            "sourceDecisionNdjsonSha256": "1".repeat(64),
            "decisionCount": 1,
            "immutableSourceVersion": "synthetic-source-v1",
            "immutable": true
        }))
        .unwrap();
    manifest.validate().unwrap();
    let wire = canonical_wire_json(&serde_json::json!({
        "z": 1.0,
        "a": { "servedPosition": 2 }
    }))
    .unwrap();
    assert_eq!(wire, r#"{"a":{"servedPosition":2},"z":1.0}"#);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&wire).unwrap()["z"],
        1.0
    );

    let mut unknown = serde_json::to_value(manifest).unwrap();
    unknown["reviewedBy"] = serde_json::json!("untrusted");
    assert!(
        serde_json::from_value::<TargetPolicyDistributionSourceDatasetManifestV1>(unknown).is_err()
    );
}

#[test]
fn record_contract_is_strict_and_decision_digest_excludes_end() {
    let records = ["decision_start", "step_start", "action_probability"]
        .map(record_json)
        .map(|value| serde_json::from_value::<TargetPolicyDistributionRecordV1>(value).unwrap());
    let expected_bytes = records
        .iter()
        .map(|record| format!("{}\n", canonical_json(record).unwrap()))
        .collect::<String>();
    assert_eq!(
        compute_decision_records_sha256(&records).unwrap(),
        format!("{:x}", Sha256::digest(expected_bytes.as_bytes()))
    );

    let mut unknown = record_json("action_probability");
    unknown["selectionProbability"] = serde_json::json!(0.95);
    assert!(serde_json::from_value::<TargetPolicyDistributionRecordV1>(unknown).is_err());
}

#[test]
fn step_contract_rejects_prefix_and_probability_drift() {
    let mut wrong_prefix = record_json("step_start");
    wrong_prefix["servedPosition"] = serde_json::json!(2);
    let record: TargetPolicyDistributionRecordV1 = serde_json::from_value(wrong_prefix).unwrap();
    assert!(record.validate().is_err());

    let mut wrong_probability = record_json("action_probability");
    wrong_probability["conditionalSelectionProbability"] = serde_json::json!(0.0);
    assert!(serde_json::from_value::<TargetPolicyDistributionRecordV1>(wrong_probability).is_err());
}

#[test]
fn manifest_counts_and_receipt_self_hash_are_bound() {
    let manifest: TargetPolicyDistributionManifestV1 = serde_json::from_value(serde_json::json!({
        "contractVersion": "target_policy_distribution_manifest_v1",
        "producerVersion": "telegram_recommendation_policy_offline_v1",
        "datasetVersion": "synthetic-phase9-v1",
        "sourceDecisionNdjsonSha256": "1".repeat(64),
        "sourceDatasetManifestSha256": "2".repeat(64),
        "policyConfigSha256": "3".repeat(64),
        "decisionCount": 1,
        "stepCount": 1,
        "actionProbabilityCount": 2,
        "physicalRecordCount": 5,
        "distributionNdjsonSha256": "4".repeat(64),
        "createdFromImmutableInputs": true,
        "servable": false
    }))
    .unwrap();
    manifest.validate().unwrap();

    let mut receipt: TargetPolicyDistributionVerificationReceiptV1 =
        serde_json::from_value(serde_json::json!({
            "contractVersion": "target_policy_distribution_verification_receipt_v1",
            "verifierVersion": "telegram_recommendation_policy_offline_verifier_v1",
            "status": "verified",
            "sourceDecisionNdjsonSha256": "1".repeat(64),
            "sourceDatasetManifestSha256": "2".repeat(64),
            "policyConfigSha256": "3".repeat(64),
            "distributionNdjsonSha256": "4".repeat(64),
            "targetManifestSha256": "5".repeat(64),
            "verifiedDecisionCount": 1,
            "verifiedStepCount": 1,
            "verifiedActionProbabilityCount": 2,
            "verifiedPhysicalRecordCount": 5,
            "verificationReceiptSha256": "0".repeat(64),
            "servable": false
        }))
        .unwrap();
    receipt.verification_receipt_sha256 =
        compute_target_distribution_receipt_sha256(&receipt).unwrap();
    receipt.validate().unwrap();

    receipt.verified_action_probability_count += 1;
    assert!(receipt.validate().is_err());
}
