use std::io::{BufRead, Cursor};

use sha2::{Digest, Sha256};
use telegram_recommendation_contracts::{
    MAX_TARGET_DISTRIBUTION_LINE_BYTES, TargetDistributionStreamHighWaterDiagnosticsV2,
    TargetDistributionStreamIoMode, TargetDistributionStreamVerificationReceiptContractVersion,
    TargetDistributionStreamVerificationReceiptV2, TargetDistributionStreamVerifierVersion,
    TargetPolicyDistributionManifestV1, TargetPolicyDistributionRecordV1,
    TargetPolicyDistributionVerificationReceiptContractVersion,
    TargetPolicyDistributionVerificationReceiptV1, TargetPolicyDistributionVerificationStatus,
    TargetPolicyDistributionVerifierVersion, canonical_json,
    compute_target_distribution_receipt_sha256, compute_target_distribution_stream_receipt_sha256,
    sha256_hex, target_distribution_manifest_bytes,
};

use super::{
    TargetDistributionError, build::build_target_distribution_reader_emitting,
    stream_io::BoundedNdjsonReader,
};

const VERIFIER_SOURCE_BUNDLE: [(&str, &[u8]); 10] = [
    ("target_distribution/build.rs", include_bytes!("build.rs")),
    ("target_distribution/verify.rs", include_bytes!("verify.rs")),
    (
        "target_distribution/stream_io.rs",
        include_bytes!("stream_io.rs"),
    ),
    ("target_distribution/mod.rs", include_bytes!("mod.rs")),
    (
        "contracts/target_distribution.rs",
        include_bytes!(
            "../../../telegram-recommendation-contracts/src/contracts/target_distribution.rs"
        ),
    ),
    (
        "contracts/canonical.rs",
        include_bytes!("../../../telegram-recommendation-contracts/src/contracts/canonical.rs"),
    ),
    (
        "contracts/decision_log.rs",
        include_bytes!("../../../telegram-recommendation-contracts/src/contracts/decision_log.rs"),
    ),
    (
        "contracts/randomized_slate.rs",
        include_bytes!(
            "../../../telegram-recommendation-contracts/src/contracts/randomized_slate.rs"
        ),
    ),
    (
        "randomized_policy/epsilon_plackett_luce.rs",
        include_bytes!(
            "../../../telegram-randomized-policy-primitives/src/epsilon_plackett_luce.rs"
        ),
    ),
    ("Cargo.lock", include_bytes!("../../../../Cargo.lock")),
];

struct StreamingRecordComparator<R> {
    actual: BoundedNdjsonReader<R>,
    max_step_action_count: u32,
    max_prefix_action_count: u32,
}

impl<R: BufRead> StreamingRecordComparator<R> {
    fn new(actual: R) -> Self {
        Self {
            actual: BoundedNdjsonReader::new(actual),
            max_step_action_count: 0,
            max_prefix_action_count: 0,
        }
    }

    fn compare_line(&mut self, expected: &[u8]) -> Result<(), TargetDistributionError> {
        let actual = self
            .actual
            .read_line(TargetDistributionError::GrammarViolation)?
            .ok_or(TargetDistributionError::RecalculationMismatch)?;
        let expected = expected
            .strip_suffix(b"\n")
            .ok_or(TargetDistributionError::GrammarViolation)?;
        if expected != actual {
            return Err(classify_record_mismatch(expected, &actual));
        }
        if let TargetPolicyDistributionRecordV1::StepStart(step) = parse_record(expected)? {
            self.max_step_action_count = self.max_step_action_count.max(step.expected_action_count);
            self.max_prefix_action_count = self.max_prefix_action_count.max(
                u32::try_from(step.prefix_action_keys.len())
                    .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?,
            );
        }
        Ok(())
    }

    fn finish(mut self) -> Result<DistributionStreamDiagnostics, TargetDistributionError> {
        if self
            .actual
            .read_line(TargetDistributionError::GrammarViolation)?
            .is_some()
        {
            return Err(TargetDistributionError::RecalculationMismatch);
        }
        Ok(DistributionStreamDiagnostics {
            raw_sha256: self.actual.sha256_hex(),
            byte_len: self.actual.byte_len(),
            physical_record_count: self.actual.line_count(),
            max_line_bytes: self.actual.max_line_bytes(),
            max_step_action_count: self.max_step_action_count,
            max_prefix_action_count: self.max_prefix_action_count,
        })
    }
}

struct DistributionStreamDiagnostics {
    raw_sha256: String,
    byte_len: u64,
    physical_record_count: u64,
    max_line_bytes: u64,
    max_step_action_count: u32,
    max_prefix_action_count: u32,
}

fn classify_record_mismatch(expected: &[u8], actual: &[u8]) -> TargetDistributionError {
    match (parse_record(expected), parse_record(actual)) {
        (
            Ok(TargetPolicyDistributionRecordV1::StepStart(expected)),
            Ok(TargetPolicyDistributionRecordV1::StepStart(actual)),
        ) if expected.prefix_action_keys != actual.prefix_action_keys => {
            TargetDistributionError::PrefixDrift
        }
        (Ok(expected), Ok(actual))
            if std::mem::discriminant(&expected) == std::mem::discriminant(&actual) =>
        {
            TargetDistributionError::RecalculationMismatch
        }
        _ => TargetDistributionError::GrammarViolation,
    }
}

fn parse_record(line: &[u8]) -> Result<TargetPolicyDistributionRecordV1, TargetDistributionError> {
    let record: TargetPolicyDistributionRecordV1 =
        serde_json::from_slice(line).map_err(|_| TargetDistributionError::GrammarViolation)?;
    record.validate().map_err(|error| {
        if error.contains("prefixActionKeys") {
            TargetDistributionError::PrefixDrift
        } else {
            TargetDistributionError::GrammarViolation
        }
    })?;
    Ok(record)
}

pub fn target_distribution_stream_verifier_build_fingerprint_sha256() -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"target_distribution_stream_verifier_source_bundle_v1\0");
    for (path, source) in VERIFIER_SOURCE_BUNDLE {
        hasher.update(u64::try_from(path.len()).unwrap_or(u64::MAX).to_be_bytes());
        hasher.update(path.as_bytes());
        hasher.update(
            u64::try_from(source.len())
                .unwrap_or(u64::MAX)
                .to_be_bytes(),
        );
        hasher.update(source);
    }
    format!("{:x}", hasher.finalize())
}

pub fn verify_target_distribution_from_readers<SR, DR>(
    source_decision_ndjson: SR,
    source_dataset_manifest: &[u8],
    policy_config: &[u8],
    distribution_ndjson: DR,
    target_manifest: &[u8],
) -> Result<TargetDistributionStreamVerificationReceiptV2, TargetDistributionError>
where
    SR: BufRead,
    DR: BufRead,
{
    validate_small_input(source_dataset_manifest)?;
    validate_small_input(policy_config)?;
    validate_small_input(target_manifest)?;
    let manifest: TargetPolicyDistributionManifestV1 = serde_json::from_slice(target_manifest)
        .map_err(|_| TargetDistributionError::InvalidManifest)?;
    manifest
        .validate()
        .map_err(|_| TargetDistributionError::InvalidManifest)?;
    if target_distribution_manifest_bytes(&manifest)
        .map_err(|_| TargetDistributionError::InvalidManifest)?
        != target_manifest
    {
        return Err(TargetDistributionError::InvalidManifest);
    }
    let config: telegram_recommendation_contracts::RandomizedSlateConfigV1 =
        serde_json::from_slice(policy_config)
            .map_err(|_| TargetDistributionError::InvalidConfig)?;
    let config_sha256 =
        sha256_hex(canonical_json(&config).map_err(|_| TargetDistributionError::InvalidConfig)?);
    if manifest.source_dataset_manifest_sha256 != sha256_hex(source_dataset_manifest)
        || manifest.policy_config_sha256 != config_sha256
    {
        return Err(TargetDistributionError::DigestMismatch);
    }

    let mut comparator = StreamingRecordComparator::new(distribution_ndjson);
    let build = build_target_distribution_reader_emitting(
        source_decision_ndjson,
        source_dataset_manifest,
        policy_config,
        |line| comparator.compare_line(line),
    )?;
    let distribution = comparator.finish()?;
    if distribution.byte_len > telegram_recommendation_contracts::MAX_TARGET_DISTRIBUTION_FILE_BYTES
    {
        return Err(TargetDistributionError::ResourceLimitExceeded);
    }
    if distribution.raw_sha256 != manifest.distribution_ndjson_sha256 {
        return Err(TargetDistributionError::DigestMismatch);
    }
    if distribution.physical_record_count != manifest.physical_record_count {
        return Err(TargetDistributionError::CountMismatch);
    }
    if build.manifest != manifest {
        return Err(TargetDistributionError::RecalculationMismatch);
    }

    let mut receipt = TargetDistributionStreamVerificationReceiptV2 {
        contract_version: TargetDistributionStreamVerificationReceiptContractVersion::V2,
        verifier_version: TargetDistributionStreamVerifierVersion::V2,
        verifier_build_fingerprint_sha256:
            target_distribution_stream_verifier_build_fingerprint_sha256(),
        io_mode: TargetDistributionStreamIoMode::BoundedStreamV1,
        status: TargetPolicyDistributionVerificationStatus::Verified,
        source_decision_ndjson_sha256: manifest.source_decision_ndjson_sha256,
        source_dataset_manifest_sha256: manifest.source_dataset_manifest_sha256,
        policy_config_sha256: manifest.policy_config_sha256,
        policy_config_raw_sha256: sha256_hex(policy_config),
        distribution_ndjson_sha256: manifest.distribution_ndjson_sha256,
        target_manifest_sha256: sha256_hex(target_manifest),
        verified_decision_count: manifest.decision_count,
        verified_step_count: manifest.step_count,
        verified_action_probability_count: manifest.action_probability_count,
        verified_physical_record_count: manifest.physical_record_count,
        high_water_diagnostics: TargetDistributionStreamHighWaterDiagnosticsV2 {
            max_source_line_bytes: build.diagnostics.max_source_line_bytes,
            max_distribution_line_bytes: distribution.max_line_bytes,
            max_candidate_count: build.diagnostics.max_candidate_count,
            max_step_action_count: distribution.max_step_action_count,
            max_prefix_action_count: distribution.max_prefix_action_count,
        },
        verification_receipt_sha256: "0".repeat(64),
        servable: false,
    };
    receipt.verification_receipt_sha256 =
        compute_target_distribution_stream_receipt_sha256(&receipt)
            .map_err(|_| TargetDistributionError::InvalidManifest)?;
    receipt
        .validate()
        .map_err(|_| TargetDistributionError::InvalidManifest)?;
    Ok(receipt)
}

pub fn verify_target_distribution_stream(
    source_decision_ndjson: &[u8],
    source_dataset_manifest: &[u8],
    policy_config: &[u8],
    distribution_ndjson: &[u8],
    target_manifest: &[u8],
) -> Result<TargetPolicyDistributionVerificationReceiptV1, TargetDistributionError> {
    let v2 = verify_target_distribution_from_readers(
        Cursor::new(source_decision_ndjson),
        source_dataset_manifest,
        policy_config,
        Cursor::new(distribution_ndjson),
        target_manifest,
    )?;
    let mut receipt = TargetPolicyDistributionVerificationReceiptV1 {
        contract_version: TargetPolicyDistributionVerificationReceiptContractVersion::V1,
        verifier_version: TargetPolicyDistributionVerifierVersion::V1,
        status: v2.status,
        source_decision_ndjson_sha256: v2.source_decision_ndjson_sha256,
        source_dataset_manifest_sha256: v2.source_dataset_manifest_sha256,
        policy_config_sha256: v2.policy_config_sha256,
        distribution_ndjson_sha256: v2.distribution_ndjson_sha256,
        target_manifest_sha256: v2.target_manifest_sha256,
        verified_decision_count: v2.verified_decision_count,
        verified_step_count: v2.verified_step_count,
        verified_action_probability_count: v2.verified_action_probability_count,
        verified_physical_record_count: v2.verified_physical_record_count,
        verification_receipt_sha256: "0".repeat(64),
        servable: false,
    };
    receipt.verification_receipt_sha256 = compute_target_distribution_receipt_sha256(&receipt)
        .map_err(|_| TargetDistributionError::InvalidManifest)?;
    receipt
        .validate()
        .map_err(|_| TargetDistributionError::InvalidManifest)?;
    Ok(receipt)
}

fn validate_small_input(input: &[u8]) -> Result<(), TargetDistributionError> {
    if u64::try_from(input.len()).unwrap_or(u64::MAX) > MAX_TARGET_DISTRIBUTION_LINE_BYTES {
        Err(TargetDistributionError::ResourceLimitExceeded)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::target_distribution_stream_verifier_build_fingerprint_sha256;

    #[test]
    fn verifier_build_fingerprint_is_sha256() {
        let fingerprint = target_distribution_stream_verifier_build_fingerprint_sha256();
        assert_eq!(fingerprint.len(), 64);
        assert!(fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
}
