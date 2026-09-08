use std::{
    fs::{self, File, OpenOptions},
    io::{BufReader, Read, Write},
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use telegram_recommendation_contracts::{
    CandidateNamespace, DecisionAction, DecisionActionKey, DecisionCandidate, PropensityEvidence,
    RandomizedSlateConfigV1, RecommendationDecisionLogContractVersion, RecommendationDecisionLogV1,
    TargetPolicyDistributionRecordV1, TargetPolicyDistributionSourceDatasetManifestContractVersion,
    TargetPolicyDistributionSourceDatasetManifestV1, candidate_pool_sha256, canonical_wire_json,
    compute_decision_records_sha256, sha256_hex, target_distribution_manifest_bytes,
};
use telegram_recommendation_policy_offline::target_distribution::{
    TargetDistributionError, build_target_distribution_from_reader,
    build_target_distribution_stream, build_target_distribution_to_writer,
    verify_target_distribution_from_readers, verify_target_distribution_stream,
};

struct GuardedTinyReader<'a> {
    bytes: &'a [u8],
    offset: usize,
    max_request: usize,
}

impl Read for GuardedTinyReader<'_> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        assert!(
            output.len() <= self.max_request,
            "reader core attempted an unbounded read"
        );
        let remaining = &self.bytes[self.offset..];
        let count = remaining.len().min(output.len());
        output[..count].copy_from_slice(&remaining[..count]);
        self.offset += count;
        Ok(count)
    }
}

fn tiny_reader(bytes: &[u8]) -> BufReader<GuardedTinyReader<'_>> {
    BufReader::with_capacity(
        7,
        GuardedTinyReader {
            bytes,
            offset: 0,
            max_request: 7,
        },
    )
}

static NEXT_TEMP_ARTIFACT_ID: AtomicU64 = AtomicU64::new(0);

struct TempArtifact {
    path: PathBuf,
}

impl TempArtifact {
    fn create() -> (Self, File) {
        let id = NEXT_TEMP_ARTIFACT_ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "telegram-target-distribution-{}-{id}.ndjson",
            std::process::id()
        ));
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .unwrap();
        (Self { path }, file)
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempArtifact {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

struct FailingReader<'a> {
    bytes: &'a [u8],
    offset: usize,
    fail_after: usize,
}

impl Read for FailingReader<'_> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if self.offset >= self.fail_after {
            return Err(std::io::Error::other("injected read failure"));
        }
        let remaining = &self.bytes[self.offset..self.fail_after.min(self.bytes.len())];
        let count = remaining.len().min(output.len());
        output[..count].copy_from_slice(&remaining[..count]);
        self.offset += count;
        Ok(count)
    }
}

struct FailingWriter {
    remaining: usize,
}

impl Write for FailingWriter {
    fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
        if self.remaining == 0 {
            return Err(std::io::Error::other("injected write failure"));
        }
        let count = input.len().min(self.remaining);
        self.remaining -= count;
        Ok(count)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn fixture_input() -> (RecommendationDecisionLogV1, RandomizedSlateConfigV1) {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../telegram-recommendation-fixtures/fixtures/randomized_slate_simulation_v1.json"
    ))
    .unwrap();
    (
        serde_json::from_value(fixture["input"]["sourceDecisionLog"].clone()).unwrap(),
        serde_json::from_value(fixture["input"]["config"].clone()).unwrap(),
    )
}

fn source_bytes(decision: &RecommendationDecisionLogV1) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(decision).unwrap();
    bytes.push(b'\n');
    bytes
}

fn config_bytes(config: &RandomizedSlateConfigV1) -> Vec<u8> {
    serde_json::to_vec(config).unwrap()
}

fn record_bytes(records: &[TargetPolicyDistributionRecordV1]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for record in records {
        bytes.extend_from_slice(canonical_wire_json(record).unwrap().as_bytes());
        bytes.push(b'\n');
    }
    bytes
}

fn source_manifest(source: &[u8], decision_count: u64, dataset_version: &str) -> Vec<u8> {
    let manifest = TargetPolicyDistributionSourceDatasetManifestV1 {
        contract_version: TargetPolicyDistributionSourceDatasetManifestContractVersion::V1,
        schema_version: RecommendationDecisionLogContractVersion::V1,
        dataset_version: dataset_version.to_string(),
        source_decision_ndjson_sha256: sha256_hex(source),
        decision_count,
        immutable_source_version: "synthetic-source-v1".to_string(),
        immutable: true,
    };
    let mut bytes = canonical_wire_json(&manifest).unwrap().into_bytes();
    bytes.push(b'\n');
    bytes
}

fn two_action_decision() -> (RecommendationDecisionLogV1, RandomizedSlateConfigV1) {
    let (mut decision, mut config) = fixture_input();
    let second = &mut decision.candidate_pool.candidates[1];
    second.selected = true;
    second.selection_rank = NonZeroU32::new(2);
    second.served = true;
    second.served_position = NonZeroU32::new(2);
    decision.actions.push(DecisionAction {
        action_key: DecisionActionKey {
            candidate_namespace: second.candidate_namespace,
            candidate_id: second.candidate_id.clone(),
            served_position: NonZeroU32::new(2).unwrap(),
        },
        selection_rank: NonZeroU32::new(2).unwrap(),
        behavior_propensity: PropensityEvidence::NotEvaluableDeterministic {
            reason: telegram_recommendation_contracts::DeterministicNotEvaluableReason::DeterministicTopKNoLoggedProbability,
        },
    });
    decision.candidate_pool.candidate_pool_sha256 =
        candidate_pool_sha256(&decision.candidate_pool.candidates).unwrap();
    config.slate_size = NonZeroU32::new(2).unwrap();
    (decision, config)
}

#[test]
fn stream_grammar_digests_and_receipt_round_trip() {
    let (decision, config) = two_action_decision();
    let source = source_bytes(&decision);
    let config = config_bytes(&config);
    let source_manifest = source_manifest(&source, 1, "synthetic-phase9-v1");
    let built = build_target_distribution_stream(&source, &source_manifest, &config).unwrap();
    let records = built
        .ndjson
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_slice::<TargetPolicyDistributionRecordV1>(line).unwrap())
        .collect::<Vec<_>>();

    assert!(matches!(
        records[0],
        TargetPolicyDistributionRecordV1::DecisionStart(_)
    ));
    assert!(matches!(
        records[1],
        TargetPolicyDistributionRecordV1::StepStart(_)
    ));
    assert!(matches!(
        records[5],
        TargetPolicyDistributionRecordV1::StepStart(_)
    ));
    assert!(matches!(
        records.last().unwrap(),
        TargetPolicyDistributionRecordV1::DecisionEnd(_)
    ));
    let end = match records.last().unwrap() {
        TargetPolicyDistributionRecordV1::DecisionEnd(end) => end,
        _ => unreachable!(),
    };
    assert_eq!(end.step_count, 2);
    assert_eq!(end.action_probability_count, 5);
    assert_eq!(
        end.decision_records_sha256,
        compute_decision_records_sha256(&records[..records.len() - 1]).unwrap()
    );
    assert_eq!(built.manifest.decision_count, 1);
    assert_eq!(built.manifest.step_count, 2);
    assert_eq!(built.manifest.action_probability_count, 5);
    assert_eq!(built.manifest.physical_record_count, 9);
    assert_eq!(
        built.manifest.distribution_ndjson_sha256,
        sha256_hex(&built.ndjson)
    );

    let manifest_bytes = target_distribution_manifest_bytes(&built.manifest).unwrap();
    let receipt = verify_target_distribution_stream(
        &source,
        &source_manifest,
        &config,
        &built.ndjson,
        &manifest_bytes,
    )
    .unwrap();
    receipt.validate().unwrap();
    assert_eq!(receipt.verified_physical_record_count, 9);
}

#[test]
fn writer_and_raw_lines_are_canonical_wire_json() {
    let (decision, config) = two_action_decision();
    let source = source_bytes(&decision);
    let config = config_bytes(&config);
    let source_manifest = source_manifest(&source, 1, "synthetic-phase9-v1");
    let built = build_target_distribution_stream(&source, &source_manifest, &config).unwrap();
    let mut streamed = Vec::new();
    let streamed_manifest =
        build_target_distribution_to_writer(&source, &source_manifest, &config, &mut streamed)
            .unwrap();

    assert_eq!(streamed, built.ndjson);
    assert_eq!(streamed_manifest, built.manifest);
    for line in streamed
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let record: TargetPolicyDistributionRecordV1 = serde_json::from_slice(line).unwrap();
        assert_eq!(line, canonical_wire_json(&record).unwrap().as_bytes());
    }
    let manifest_bytes = target_distribution_manifest_bytes(&streamed_manifest).unwrap();
    let manifest_line = manifest_bytes.strip_suffix(b"\n").unwrap();
    let parsed: telegram_recommendation_contracts::TargetPolicyDistributionManifestV1 =
        serde_json::from_slice(manifest_line).unwrap();
    assert_eq!(
        manifest_line,
        canonical_wire_json(&parsed).unwrap().as_bytes()
    );
}

#[test]
fn tiny_chunk_readers_match_legacy_bytes_and_issue_v2_receipt() {
    let (decision, config) = two_action_decision();
    let source = source_bytes(&decision);
    let config = config_bytes(&config);
    let source_manifest = source_manifest(&source, 1, "synthetic-phase9-v1");
    let legacy = build_target_distribution_stream(&source, &source_manifest, &config).unwrap();
    let mut streamed = Vec::new();
    let streamed_manifest = build_target_distribution_from_reader(
        tiny_reader(&source),
        &source_manifest,
        &config,
        &mut streamed,
    )
    .unwrap();

    assert_eq!(streamed, legacy.ndjson);
    assert_eq!(streamed_manifest, legacy.manifest);
    let manifest_bytes = target_distribution_manifest_bytes(&streamed_manifest).unwrap();
    let receipt = verify_target_distribution_from_readers(
        tiny_reader(&source),
        &source_manifest,
        &config,
        tiny_reader(&streamed),
        &manifest_bytes,
    )
    .unwrap();

    receipt.validate().unwrap();
    assert_eq!(receipt.verified_physical_record_count, 9);
    assert_eq!(receipt.high_water_diagnostics.max_candidate_count, 4);
    assert_eq!(receipt.high_water_diagnostics.max_step_action_count, 3);
    assert_eq!(receipt.high_water_diagnostics.max_prefix_action_count, 1);
    assert!(receipt.high_water_diagnostics.max_source_line_bytes < 1 << 20);
    assert!(receipt.high_water_diagnostics.max_distribution_line_bytes < 1 << 20);
}

#[test]
fn reader_and_writer_failures_do_not_return_artifact_evidence() {
    let (decision, config) = two_action_decision();
    let source = source_bytes(&decision);
    let config = config_bytes(&config);
    let source_manifest = source_manifest(&source, 1, "synthetic-phase10-io-failure-v1");
    let failing_reader = BufReader::with_capacity(
        7,
        FailingReader {
            bytes: &source,
            offset: 0,
            fail_after: 32,
        },
    );
    let mut output = Vec::new();
    assert_eq!(
        build_target_distribution_from_reader(
            failing_reader,
            &source_manifest,
            &config,
            &mut output,
        ),
        Err(TargetDistributionError::InputReadFailed)
    );

    let mut failing_writer = FailingWriter { remaining: 32 };
    assert_eq!(
        build_target_distribution_from_reader(
            tiny_reader(&source),
            &source_manifest,
            &config,
            &mut failing_writer,
        ),
        Err(TargetDistributionError::OutputWriteFailed)
    );

    let built = build_target_distribution_stream(&source, &source_manifest, &config).unwrap();
    let manifest_bytes = target_distribution_manifest_bytes(&built.manifest).unwrap();
    let failing_source = BufReader::with_capacity(
        7,
        FailingReader {
            bytes: &source,
            offset: 0,
            fail_after: 32,
        },
    );
    assert_eq!(
        verify_target_distribution_from_readers(
            failing_source,
            &source_manifest,
            &config,
            tiny_reader(&built.ndjson),
            &manifest_bytes,
        ),
        Err(TargetDistributionError::InputReadFailed)
    );

    let failing_distribution = BufReader::with_capacity(
        7,
        FailingReader {
            bytes: &built.ndjson,
            offset: 0,
            fail_after: 32,
        },
    );
    assert_eq!(
        verify_target_distribution_from_readers(
            tiny_reader(&source),
            &source_manifest,
            &config,
            failing_distribution,
            &manifest_bytes,
        ),
        Err(TargetDistributionError::InputReadFailed)
    );
}

#[test]
fn source_manifest_schema_digest_and_count_are_verified() {
    let (decision, config) = two_action_decision();
    let source = source_bytes(&decision);
    let config = config_bytes(&config);
    let valid = source_manifest(&source, 1, "manifest-owned-dataset-v1");
    let built = build_target_distribution_stream(&source, &valid, &config).unwrap();
    assert_eq!(built.manifest.dataset_version, "manifest-owned-dataset-v1");

    let mutate = |field: &str, value: serde_json::Value| {
        let mut manifest: serde_json::Value = serde_json::from_slice(&valid).unwrap();
        manifest[field] = value;
        let mut bytes = canonical_wire_json(&manifest).unwrap().into_bytes();
        bytes.push(b'\n');
        bytes
    };
    assert_eq!(
        build_target_distribution_stream(
            &source,
            &mutate(
                "schemaVersion",
                serde_json::json!("recommendation_decision_log_v2")
            ),
            &config,
        )
        .unwrap_err(),
        TargetDistributionError::InvalidManifest
    );
    assert_eq!(
        build_target_distribution_stream(
            &source,
            &mutate(
                "sourceDecisionNdjsonSha256",
                serde_json::json!("0".repeat(64))
            ),
            &config,
        )
        .unwrap_err(),
        TargetDistributionError::DigestMismatch
    );
    assert_eq!(
        build_target_distribution_stream(
            &source,
            &mutate("decisionCount", serde_json::json!(2)),
            &config,
        )
        .unwrap_err(),
        TargetDistributionError::CountMismatch
    );
}

#[test]
fn partial_logged_slate_requires_only_logged_action_support() {
    let (mut decision, mut config) = fixture_input();
    decision.candidate_pool.candidates = (0..10_u32)
        .map(|index| DecisionCandidate {
            candidate_namespace: CandidateNamespace::ServingPostId,
            candidate_id: format!("partial-candidate-{index:02}"),
            pool_rank: NonZeroU32::new(index + 1).unwrap(),
            eligible: true,
            score: Some(f64::from(index) / 10.0),
            selected: index == 0,
            selection_rank: (index == 0).then(|| NonZeroU32::new(1).unwrap()),
            served: index == 0,
            served_position: (index == 0).then(|| NonZeroU32::new(1).unwrap()),
            objective_evidence: Vec::new(),
        })
        .collect();
    decision.actions.truncate(1);
    decision.actions[0].action_key.candidate_id = "partial-candidate-00".to_string();
    decision.candidate_pool.total_count = 10;
    decision.candidate_pool.candidate_pool_sha256 =
        candidate_pool_sha256(&decision.candidate_pool.candidates).unwrap();
    config.slate_size = NonZeroU32::new(64).unwrap();
    let source = source_bytes(&decision);
    let source_manifest = source_manifest(&source, 1, "partial-slate-v1");

    let built = build_target_distribution_stream(&source, &source_manifest, &config_bytes(&config))
        .unwrap();
    assert_eq!(built.manifest.step_count, 1);
    assert_eq!(built.manifest.action_probability_count, 10);
}

#[test]
fn verifier_rejects_ordered_logged_prefix_drift_even_with_rehashed_bytes() {
    let (decision, config) = two_action_decision();
    let source = source_bytes(&decision);
    let config = config_bytes(&config);
    let source_manifest = source_manifest(&source, 1, "synthetic-phase9-v1");
    let built = build_target_distribution_stream(&source, &source_manifest, &config).unwrap();
    let mut records = built
        .ndjson
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_slice::<TargetPolicyDistributionRecordV1>(line).unwrap())
        .collect::<Vec<_>>();
    let second_step_index = records
        .iter()
        .position(|record| matches!(record, TargetPolicyDistributionRecordV1::StepStart(step) if step.served_position.get() == 2))
        .unwrap();
    let TargetPolicyDistributionRecordV1::StepStart(step) = &mut records[second_step_index] else {
        unreachable!();
    };
    step.prefix_action_keys[0].candidate_id = "drifted-prefix".to_string();
    let end_index = records.len() - 1;
    let digest = compute_decision_records_sha256(&records[..end_index]).unwrap();
    let TargetPolicyDistributionRecordV1::DecisionEnd(end) = &mut records[end_index] else {
        unreachable!();
    };
    end.decision_records_sha256 = digest;
    let corrupted = record_bytes(&records);
    let mut manifest = built.manifest;
    manifest.distribution_ndjson_sha256 = sha256_hex(&corrupted);
    let manifest = target_distribution_manifest_bytes(&manifest).unwrap();

    assert_eq!(
        verify_target_distribution_stream(
            &source,
            &source_manifest,
            &config,
            &corrupted,
            &manifest,
        ),
        Err(TargetDistributionError::PrefixDrift)
    );
}

#[test]
fn incremental_rebuild_rejects_rehashed_action_corruption() {
    let (decision, config) = two_action_decision();
    let source = source_bytes(&decision);
    let config = config_bytes(&config);
    let source_manifest = source_manifest(&source, 1, "synthetic-phase9-v1");
    let built = build_target_distribution_stream(&source, &source_manifest, &config).unwrap();
    let mut records = built
        .ndjson
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_slice::<TargetPolicyDistributionRecordV1>(line).unwrap())
        .collect::<Vec<_>>();
    let action_index = records
        .iter()
        .rposition(|record| {
            matches!(
                record,
                TargetPolicyDistributionRecordV1::ActionProbability(action)
                    if action.action_key.served_position.get() == 2
            )
        })
        .unwrap();
    let TargetPolicyDistributionRecordV1::ActionProbability(action) = &mut records[action_index]
    else {
        unreachable!();
    };
    action.action_key.candidate_id = "rehashed-action-corruption".to_string();
    let end_index = records.len() - 1;
    let digest = compute_decision_records_sha256(&records[..end_index]).unwrap();
    let TargetPolicyDistributionRecordV1::DecisionEnd(end) = &mut records[end_index] else {
        unreachable!();
    };
    end.decision_records_sha256 = digest;
    let corrupted = record_bytes(&records);
    let mut manifest = built.manifest;
    manifest.distribution_ndjson_sha256 = sha256_hex(&corrupted);
    let manifest = target_distribution_manifest_bytes(&manifest).unwrap();

    assert_eq!(
        verify_target_distribution_stream(
            &source,
            &source_manifest,
            &config,
            &corrupted,
            &manifest,
        ),
        Err(TargetDistributionError::RecalculationMismatch)
    );
}

fn maximal_decision() -> (RecommendationDecisionLogV1, RandomizedSlateConfigV1) {
    let (mut decision, mut config) = fixture_input();
    decision.candidate_pool.candidates = (0..2_048_u32)
        .map(|index| {
            let served = index < 64;
            DecisionCandidate {
                candidate_namespace: CandidateNamespace::ServingPostId,
                candidate_id: format!("candidate-{index:04}"),
                pool_rank: NonZeroU32::new(index + 1).unwrap(),
                eligible: true,
                score: Some(0.0),
                selected: served,
                selection_rank: served.then(|| NonZeroU32::new(index + 1).unwrap()),
                served,
                served_position: served.then(|| NonZeroU32::new(index + 1).unwrap()),
                objective_evidence: Vec::new(),
            }
        })
        .collect();
    decision.actions = (0..64_u32)
        .map(|index| DecisionAction {
            action_key: DecisionActionKey {
                candidate_namespace: CandidateNamespace::ServingPostId,
                candidate_id: format!("candidate-{index:04}"),
                served_position: NonZeroU32::new(index + 1).unwrap(),
            },
            selection_rank: NonZeroU32::new(index + 1).unwrap(),
            behavior_propensity: PropensityEvidence::NotEvaluableDeterministic {
                reason: telegram_recommendation_contracts::DeterministicNotEvaluableReason::DeterministicTopKNoLoggedProbability,
            },
        })
        .collect();
    decision.candidate_pool.total_count = 2_048;
    decision.candidate_pool.candidate_pool_sha256 =
        candidate_pool_sha256(&decision.candidate_pool.candidates).unwrap();
    config.slate_size = NonZeroU32::new(64).unwrap();
    (decision, config)
}

#[test]
fn maximal_support_is_many_bounded_physical_records() {
    let (decision, config) = maximal_decision();
    let source = source_bytes(&decision);
    let source_manifest = source_manifest(&source, 1, "synthetic-max-support-v1");
    let config = config_bytes(&config);
    let (artifact, mut writer) = TempArtifact::create();
    let manifest = build_target_distribution_from_reader(
        tiny_reader(&source),
        &source_manifest,
        &config,
        &mut writer,
    )
    .unwrap();
    writer.flush().unwrap();
    writer.sync_all().unwrap();
    drop(writer);
    let expected_action_records = (0..64_u64).map(|step| 2_048 - step).sum::<u64>();

    assert_eq!(expected_action_records, 129_056);
    assert_eq!(manifest.action_probability_count, expected_action_records);
    assert_eq!(manifest.physical_record_count, 1 + 64 + 129_056 + 1);
    assert!(
        fs::metadata(artifact.path()).unwrap().len()
            <= telegram_recommendation_contracts::MAX_TARGET_DISTRIBUTION_FILE_BYTES
    );
    let manifest_bytes = target_distribution_manifest_bytes(&manifest).unwrap();
    let receipt = verify_target_distribution_from_readers(
        tiny_reader(&source),
        &source_manifest,
        &config,
        BufReader::with_capacity(8 * 1024, File::open(artifact.path()).unwrap()),
        &manifest_bytes,
    )
    .unwrap();
    assert_eq!(
        receipt.distribution_ndjson_sha256,
        manifest.distribution_ndjson_sha256
    );
    assert_eq!(
        receipt.verified_action_probability_count,
        expected_action_records
    );
    assert_eq!(
        receipt.verified_physical_record_count,
        manifest.physical_record_count
    );
    assert_eq!(receipt.high_water_diagnostics.max_candidate_count, 2_048);
    assert_eq!(receipt.high_water_diagnostics.max_step_action_count, 2_048);
    assert_eq!(receipt.high_water_diagnostics.max_prefix_action_count, 63);
    assert!(receipt.high_water_diagnostics.max_distribution_line_bytes <= 1 << 20);
}

#[test]
fn resource_support_and_grammar_fail_closed_without_partial_evidence() {
    let (decision, config) = two_action_decision();
    let config = config_bytes(&config);
    let mut oversized_line = vec![b'x'; (1 << 20) + 1];
    oversized_line.push(b'\n');
    let oversized_manifest = source_manifest(&oversized_line, 1, "synthetic-phase9-v1");
    assert_eq!(
        build_target_distribution_stream(&oversized_line, &oversized_manifest, &config)
            .unwrap_err(),
        TargetDistributionError::ResourceLimitExceeded
    );
    let mut output = Vec::new();
    assert_eq!(
        build_target_distribution_from_reader(
            tiny_reader(&oversized_line),
            &oversized_manifest,
            &config,
            &mut output,
        )
        .unwrap_err(),
        TargetDistributionError::ResourceLimitExceeded
    );
    assert!(output.is_empty());

    let mut incomplete = decision.clone();
    incomplete.candidate_pool.support_evidence =
        telegram_recommendation_contracts::CandidateSupportEvidence::Incomplete {
            reason: "partial_pool".to_string(),
        };
    let incomplete_source = source_bytes(&incomplete);
    let incomplete_manifest = source_manifest(&incomplete_source, 1, "synthetic-phase9-v1");
    assert_eq!(
        build_target_distribution_stream(&incomplete_source, &incomplete_manifest, &config)
            .unwrap_err(),
        TargetDistributionError::SupportIncomplete
    );

    let source = source_bytes(&decision);
    let source_manifest = source_manifest(&source, 1, "synthetic-phase9-v1");
    let built = build_target_distribution_stream(&source, &source_manifest, &config).unwrap();
    let mut lines = built
        .ndjson
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(<[u8]>::to_vec)
        .collect::<Vec<_>>();
    lines.swap(1, 2);
    let corrupt = lines
        .into_iter()
        .flat_map(|mut line| {
            line.push(b'\n');
            line
        })
        .collect::<Vec<_>>();
    let mut manifest = built.manifest;
    manifest.distribution_ndjson_sha256 = sha256_hex(&corrupt);
    let manifest = target_distribution_manifest_bytes(&manifest).unwrap();
    assert_eq!(
        verify_target_distribution_stream(&source, &source_manifest, &config, &corrupt, &manifest,),
        Err(TargetDistributionError::GrammarViolation)
    );
}

#[test]
fn dataset_version_must_fit_the_bounded_manifest_record() {
    let (decision, config) = two_action_decision();
    let source = source_bytes(&decision);
    let config = config_bytes(&config);
    let oversized_dataset_version = "x".repeat(1 << 20);
    let oversized_manifest = source_manifest(&source, 1, &oversized_dataset_version);

    assert_eq!(
        build_target_distribution_stream(&source, &oversized_manifest, &config).unwrap_err(),
        TargetDistributionError::ResourceLimitExceeded
    );

    let field_fits_but_manifest_does_not = "x".repeat((1 << 20) - 256);
    let oversized_manifest = source_manifest(&source, 1, &field_fits_but_manifest_does_not);
    assert_eq!(
        build_target_distribution_stream(&source, &oversized_manifest, &config).unwrap_err(),
        TargetDistributionError::ResourceLimitExceeded
    );
}
