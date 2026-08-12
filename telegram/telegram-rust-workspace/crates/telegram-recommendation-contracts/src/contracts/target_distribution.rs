use std::{collections::HashSet, num::NonZeroU32};

use serde::{Deserialize, Deserializer, Serialize, de};
use sha2::{Digest, Sha256};

use super::{
    canonical::{canonical_json, sha256_hex},
    decision_log::{DecisionActionKey, RecommendationDecisionLogContractVersion},
    randomized_slate::{
        BaselineOrderVersion, CandidatePoolFingerprint, DecisionFingerprint,
        PROBABILITY_MASS_TOLERANCE, ProbabilitySemantics, RandomizedSlateConfigV1,
    },
};

pub const MAX_TARGET_DISTRIBUTION_CANDIDATES: usize = 2_048;
pub const MAX_TARGET_DISTRIBUTION_POSITIONS: usize = 64;
pub const MAX_TARGET_DISTRIBUTION_LINE_BYTES: u64 = 1 << 20;
pub const MAX_TARGET_DISTRIBUTION_FILE_BYTES: u64 = 512 << 20;
pub const MAX_TARGET_DISTRIBUTION_AGGREGATE_BYTES: u64 = 1 << 30;
pub const MAX_TARGET_DISTRIBUTION_DECISIONS: u64 = 1_000_000;
pub const MAX_TARGET_DISTRIBUTION_PHYSICAL_RECORDS: u64 = 2_000_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetPolicyDistributionContractVersion {
    #[serde(rename = "target_policy_distribution_v1")]
    V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetPolicyDistributionEvidenceKind {
    #[serde(rename = "simulated_target_distribution")]
    SimulatedTargetDistribution,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetPolicyDistributionSourceDatasetManifestContractVersion {
    #[serde(rename = "target_policy_distribution_source_dataset_manifest_v1")]
    V1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionSourceDatasetManifestV1 {
    pub contract_version: TargetPolicyDistributionSourceDatasetManifestContractVersion,
    pub schema_version: RecommendationDecisionLogContractVersion,
    pub dataset_version: String,
    pub source_decision_ndjson_sha256: String,
    pub decision_count: u64,
    pub immutable_source_version: String,
    #[serde(deserialize_with = "deserialize_true")]
    pub immutable: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetPolicyDistributionManifestContractVersion {
    #[serde(rename = "target_policy_distribution_manifest_v1")]
    V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetPolicyDistributionProducerVersion {
    #[serde(rename = "telegram_recommendation_policy_offline_v1")]
    V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetPolicyDistributionVerificationReceiptContractVersion {
    #[serde(rename = "target_policy_distribution_verification_receipt_v1")]
    V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetPolicyDistributionVerifierVersion {
    #[serde(rename = "telegram_recommendation_policy_offline_verifier_v1")]
    V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetDistributionStreamVerificationReceiptContractVersion {
    #[serde(rename = "target_distribution_stream_verification_receipt_v2")]
    V2,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetDistributionStreamVerifierVersion {
    #[serde(rename = "telegram_recommendation_policy_offline_stream_verifier_v2")]
    V2,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetDistributionStreamIoMode {
    #[serde(rename = "bounded_stream_v1")]
    BoundedStreamV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetPolicyDistributionVerificationStatus {
    #[serde(rename = "verified")]
    Verified,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "recordType", rename_all = "snake_case", deny_unknown_fields)]
pub enum TargetPolicyDistributionRecordV1 {
    DecisionStart(TargetPolicyDistributionDecisionStartV1),
    StepStart(TargetPolicyDistributionStepStartV1),
    ActionProbability(TargetPolicyActionProbabilityV1),
    DecisionEnd(TargetPolicyDistributionDecisionEndV1),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionDecisionStartV1 {
    pub contract_version: TargetPolicyDistributionContractVersion,
    pub decision_id: String,
    pub decision_fingerprint: DecisionFingerprint,
    pub candidate_pool_fingerprint: CandidatePoolFingerprint,
    pub policy: RandomizedSlateConfigV1,
    pub baseline_order_version: BaselineOrderVersion,
    pub probability_semantics: ProbabilitySemantics,
    pub evidence_kind: TargetPolicyDistributionEvidenceKind,
    #[serde(deserialize_with = "deserialize_false")]
    pub servable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionStepStartV1 {
    pub decision_id: String,
    pub served_position: NonZeroU32,
    pub prefix_action_keys: Vec<DecisionActionKey>,
    pub expected_action_count: u32,
    #[serde(deserialize_with = "deserialize_finite")]
    pub plackett_luce_probability_mass: f64,
    #[serde(deserialize_with = "deserialize_non_negative_finite")]
    pub plackett_luce_mass_error: f64,
    #[serde(deserialize_with = "deserialize_finite")]
    pub mixed_probability_mass: f64,
    #[serde(deserialize_with = "deserialize_non_negative_finite")]
    pub mixed_mass_error: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyActionProbabilityV1 {
    pub decision_id: String,
    pub action_key: DecisionActionKey,
    pub deterministic_top: bool,
    #[serde(deserialize_with = "deserialize_probability")]
    pub plackett_luce_probability: f64,
    #[serde(deserialize_with = "deserialize_probability")]
    pub conditional_selection_probability: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionDecisionEndV1 {
    pub decision_id: String,
    pub step_count: u32,
    pub action_probability_count: u64,
    pub decision_records_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionManifestV1 {
    pub contract_version: TargetPolicyDistributionManifestContractVersion,
    pub producer_version: TargetPolicyDistributionProducerVersion,
    pub dataset_version: String,
    pub source_decision_ndjson_sha256: String,
    pub source_dataset_manifest_sha256: String,
    pub policy_config_sha256: String,
    pub decision_count: u64,
    pub step_count: u64,
    pub action_probability_count: u64,
    pub physical_record_count: u64,
    pub distribution_ndjson_sha256: String,
    #[serde(deserialize_with = "deserialize_true")]
    pub created_from_immutable_inputs: bool,
    #[serde(deserialize_with = "deserialize_false")]
    pub servable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetPolicyDistributionVerificationReceiptV1 {
    pub contract_version: TargetPolicyDistributionVerificationReceiptContractVersion,
    pub verifier_version: TargetPolicyDistributionVerifierVersion,
    pub status: TargetPolicyDistributionVerificationStatus,
    pub source_decision_ndjson_sha256: String,
    pub source_dataset_manifest_sha256: String,
    pub policy_config_sha256: String,
    pub distribution_ndjson_sha256: String,
    pub target_manifest_sha256: String,
    pub verified_decision_count: u64,
    pub verified_step_count: u64,
    pub verified_action_probability_count: u64,
    pub verified_physical_record_count: u64,
    pub verification_receipt_sha256: String,
    #[serde(deserialize_with = "deserialize_false")]
    pub servable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetDistributionStreamHighWaterDiagnosticsV2 {
    pub max_source_line_bytes: u64,
    pub max_distribution_line_bytes: u64,
    pub max_candidate_count: u32,
    pub max_step_action_count: u32,
    pub max_prefix_action_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetDistributionStreamVerificationReceiptV2 {
    pub contract_version: TargetDistributionStreamVerificationReceiptContractVersion,
    pub verifier_version: TargetDistributionStreamVerifierVersion,
    pub verifier_build_fingerprint_sha256: String,
    pub io_mode: TargetDistributionStreamIoMode,
    pub status: TargetPolicyDistributionVerificationStatus,
    pub source_decision_ndjson_sha256: String,
    pub source_dataset_manifest_sha256: String,
    pub policy_config_sha256: String,
    pub policy_config_raw_sha256: String,
    pub distribution_ndjson_sha256: String,
    pub target_manifest_sha256: String,
    pub verified_decision_count: u64,
    pub verified_step_count: u64,
    pub verified_action_probability_count: u64,
    pub verified_physical_record_count: u64,
    pub high_water_diagnostics: TargetDistributionStreamHighWaterDiagnosticsV2,
    pub verification_receipt_sha256: String,
    #[serde(deserialize_with = "deserialize_false")]
    pub servable: bool,
}

impl TargetPolicyDistributionRecordV1 {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::DecisionStart(record) => record.validate(),
            Self::StepStart(record) => record.validate(),
            Self::ActionProbability(record) => record.validate(),
            Self::DecisionEnd(record) => record.validate(),
        }
    }

    pub fn decision_id(&self) -> &str {
        match self {
            Self::DecisionStart(record) => &record.decision_id,
            Self::StepStart(record) => &record.decision_id,
            Self::ActionProbability(record) => &record.decision_id,
            Self::DecisionEnd(record) => &record.decision_id,
        }
    }
}

impl TargetPolicyDistributionSourceDatasetManifestV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_non_empty("datasetVersion", &self.dataset_version)?;
        require_non_empty("immutableSourceVersion", &self.immutable_source_version)?;
        if u64::try_from(self.dataset_version.len() + 1).unwrap_or(u64::MAX)
            > MAX_TARGET_DISTRIBUTION_LINE_BYTES
        {
            return Err("datasetVersion exceeds target distribution record limit".to_string());
        }
        require_sha256(
            "sourceDecisionNdjsonSha256",
            &self.source_decision_ndjson_sha256,
        )?;
        if self.decision_count == 0 || self.decision_count > MAX_TARGET_DISTRIBUTION_DECISIONS {
            return Err("decisionCount is outside semantic limits".to_string());
        }
        if !self.immutable {
            return Err("immutable must be true".to_string());
        }
        Ok(())
    }
}

impl TargetPolicyDistributionDecisionStartV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_canonical_uuid("decisionId", &self.decision_id)?;
        require_canonical_uuid(
            "decisionFingerprint.decisionId",
            &self.decision_fingerprint.decision_id,
        )?;
        if self.decision_id != self.decision_fingerprint.decision_id {
            return Err("decision fingerprint id must match decisionId".to_string());
        }
        require_sha256(
            "decisionFingerprint.sha256",
            &self.decision_fingerprint.sha256,
        )?;
        require_sha256(
            "candidatePoolFingerprint.sha256",
            &self.candidate_pool_fingerprint.sha256,
        )?;
        self.policy.validate()?;
        if usize::try_from(self.policy.slate_size.get()).unwrap_or(usize::MAX)
            > MAX_TARGET_DISTRIBUTION_POSITIONS
        {
            return Err("slateSize exceeds target distribution position limit".to_string());
        }
        if self.servable {
            return Err("servable must be false".to_string());
        }
        Ok(())
    }
}

impl TargetPolicyDistributionStepStartV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_canonical_uuid("decisionId", &self.decision_id)?;
        let position = usize::try_from(self.served_position.get()).unwrap_or(usize::MAX);
        if position > MAX_TARGET_DISTRIBUTION_POSITIONS {
            return Err("servedPosition exceeds target distribution position limit".to_string());
        }
        if self.prefix_action_keys.len() != position - 1 {
            return Err("prefixActionKeys length must equal servedPosition - 1".to_string());
        }
        if self.expected_action_count == 0
            || usize::try_from(self.expected_action_count).unwrap_or(usize::MAX)
                > MAX_TARGET_DISTRIBUTION_CANDIDATES
        {
            return Err("expectedActionCount is outside candidate limits".to_string());
        }
        let mut identities = HashSet::new();
        for (index, key) in self.prefix_action_keys.iter().enumerate() {
            require_non_empty("prefixActionKeys.candidateId", &key.candidate_id)?;
            if usize::try_from(key.served_position.get()).ok() != Some(index + 1) {
                return Err("prefixActionKeys must be ordered and contiguous from 1".to_string());
            }
            if !identities.insert((key.candidate_namespace, key.candidate_id.as_str())) {
                return Err("prefixActionKeys candidate identities must be unique".to_string());
            }
        }
        validate_mass(
            "plackettLuce",
            self.plackett_luce_probability_mass,
            self.plackett_luce_mass_error,
        )?;
        validate_mass("mixed", self.mixed_probability_mass, self.mixed_mass_error)
    }
}

impl TargetPolicyActionProbabilityV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_canonical_uuid("decisionId", &self.decision_id)?;
        require_non_empty("actionKey.candidateId", &self.action_key.candidate_id)?;
        if usize::try_from(self.action_key.served_position.get()).unwrap_or(usize::MAX)
            > MAX_TARGET_DISTRIBUTION_POSITIONS
        {
            return Err(
                "action servedPosition exceeds target distribution position limit".to_string(),
            );
        }
        validate_probability("plackettLuceProbability", self.plackett_luce_probability)?;
        validate_probability(
            "conditionalSelectionProbability",
            self.conditional_selection_probability,
        )
    }
}

impl TargetPolicyDistributionDecisionEndV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_canonical_uuid("decisionId", &self.decision_id)?;
        if self.step_count == 0
            || usize::try_from(self.step_count).unwrap_or(usize::MAX)
                > MAX_TARGET_DISTRIBUTION_POSITIONS
        {
            return Err("stepCount is outside position limits".to_string());
        }
        if self.action_probability_count == 0 {
            return Err("actionProbabilityCount must be positive".to_string());
        }
        require_sha256("decisionRecordsSha256", &self.decision_records_sha256)
    }
}

impl TargetPolicyDistributionManifestV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_non_empty("datasetVersion", &self.dataset_version)?;
        if u64::try_from(self.dataset_version.len() + 1).unwrap_or(u64::MAX)
            > MAX_TARGET_DISTRIBUTION_LINE_BYTES
        {
            return Err("datasetVersion exceeds target distribution record limit".to_string());
        }
        for (name, digest) in [
            (
                "sourceDecisionNdjsonSha256",
                &self.source_decision_ndjson_sha256,
            ),
            (
                "sourceDatasetManifestSha256",
                &self.source_dataset_manifest_sha256,
            ),
            ("policyConfigSha256", &self.policy_config_sha256),
            ("distributionNdjsonSha256", &self.distribution_ndjson_sha256),
        ] {
            require_sha256(name, digest)?;
        }
        if self.decision_count == 0 || self.decision_count > MAX_TARGET_DISTRIBUTION_DECISIONS {
            return Err("decisionCount is outside semantic limits".to_string());
        }
        if self.step_count < self.decision_count || self.action_probability_count < self.step_count
        {
            return Err("manifest semantic counts are inconsistent".to_string());
        }
        let expected_physical = self
            .decision_count
            .checked_mul(2)
            .and_then(|count| count.checked_add(self.step_count))
            .and_then(|count| count.checked_add(self.action_probability_count))
            .ok_or_else(|| "physicalRecordCount overflow".to_string())?;
        if self.physical_record_count != expected_physical
            || self.physical_record_count > MAX_TARGET_DISTRIBUTION_PHYSICAL_RECORDS
        {
            return Err("physicalRecordCount is inconsistent or exceeds limits".to_string());
        }
        if !self.created_from_immutable_inputs {
            return Err("createdFromImmutableInputs must be true".to_string());
        }
        if self.servable {
            return Err("servable must be false".to_string());
        }
        Ok(())
    }
}

impl TargetPolicyDistributionVerificationReceiptV1 {
    pub fn validate(&self) -> Result<(), String> {
        for (name, digest) in [
            (
                "sourceDecisionNdjsonSha256",
                &self.source_decision_ndjson_sha256,
            ),
            (
                "sourceDatasetManifestSha256",
                &self.source_dataset_manifest_sha256,
            ),
            ("policyConfigSha256", &self.policy_config_sha256),
            ("distributionNdjsonSha256", &self.distribution_ndjson_sha256),
            ("targetManifestSha256", &self.target_manifest_sha256),
            (
                "verificationReceiptSha256",
                &self.verification_receipt_sha256,
            ),
        ] {
            require_sha256(name, digest)?;
        }
        let expected_physical = self
            .verified_decision_count
            .checked_mul(2)
            .and_then(|count| count.checked_add(self.verified_step_count))
            .and_then(|count| count.checked_add(self.verified_action_probability_count))
            .ok_or_else(|| "verified physical record count overflow".to_string())?;
        if self.verified_decision_count == 0
            || self.verified_decision_count > MAX_TARGET_DISTRIBUTION_DECISIONS
            || self.verified_step_count < self.verified_decision_count
            || self.verified_action_probability_count < self.verified_step_count
            || self.verified_physical_record_count != expected_physical
            || self.verified_physical_record_count > MAX_TARGET_DISTRIBUTION_PHYSICAL_RECORDS
        {
            return Err("verified counts are inconsistent or exceed limits".to_string());
        }
        if self.servable {
            return Err("servable must be false".to_string());
        }
        if self.verification_receipt_sha256 != compute_target_distribution_receipt_sha256(self)? {
            return Err("verificationReceiptSha256 does not match receipt".to_string());
        }
        Ok(())
    }
}

impl TargetDistributionStreamVerificationReceiptV2 {
    pub fn validate(&self) -> Result<(), String> {
        for (name, digest) in [
            (
                "verifierBuildFingerprintSha256",
                &self.verifier_build_fingerprint_sha256,
            ),
            (
                "sourceDecisionNdjsonSha256",
                &self.source_decision_ndjson_sha256,
            ),
            (
                "sourceDatasetManifestSha256",
                &self.source_dataset_manifest_sha256,
            ),
            ("policyConfigSha256", &self.policy_config_sha256),
            ("policyConfigRawSha256", &self.policy_config_raw_sha256),
            ("distributionNdjsonSha256", &self.distribution_ndjson_sha256),
            ("targetManifestSha256", &self.target_manifest_sha256),
            (
                "verificationReceiptSha256",
                &self.verification_receipt_sha256,
            ),
        ] {
            require_sha256(name, digest)?;
        }
        let expected_physical = self
            .verified_decision_count
            .checked_mul(2)
            .and_then(|count| count.checked_add(self.verified_step_count))
            .and_then(|count| count.checked_add(self.verified_action_probability_count))
            .ok_or_else(|| "verified physical record count overflow".to_string())?;
        if self.verified_decision_count == 0
            || self.verified_decision_count > MAX_TARGET_DISTRIBUTION_DECISIONS
            || self.verified_step_count < self.verified_decision_count
            || self.verified_action_probability_count < self.verified_step_count
            || self.verified_physical_record_count != expected_physical
            || self.verified_physical_record_count > MAX_TARGET_DISTRIBUTION_PHYSICAL_RECORDS
        {
            return Err("verified counts are inconsistent or exceed limits".to_string());
        }
        let diagnostics = &self.high_water_diagnostics;
        if diagnostics.max_source_line_bytes == 0
            || diagnostics.max_source_line_bytes > MAX_TARGET_DISTRIBUTION_LINE_BYTES
            || diagnostics.max_distribution_line_bytes == 0
            || diagnostics.max_distribution_line_bytes > MAX_TARGET_DISTRIBUTION_LINE_BYTES
            || diagnostics.max_candidate_count == 0
            || usize::try_from(diagnostics.max_candidate_count).unwrap_or(usize::MAX)
                > MAX_TARGET_DISTRIBUTION_CANDIDATES
            || diagnostics.max_step_action_count == 0
            || diagnostics.max_step_action_count > diagnostics.max_candidate_count
            || usize::try_from(diagnostics.max_prefix_action_count).unwrap_or(usize::MAX)
                >= MAX_TARGET_DISTRIBUTION_POSITIONS
        {
            return Err("stream high-water diagnostics are outside limits".to_string());
        }
        if self.servable {
            return Err("servable must be false".to_string());
        }
        if self.verification_receipt_sha256
            != compute_target_distribution_stream_receipt_sha256(self)?
        {
            return Err("verificationReceiptSha256 does not match receipt".to_string());
        }
        Ok(())
    }
}

pub fn compute_decision_records_sha256(
    records_before_decision_end: &[TargetPolicyDistributionRecordV1],
) -> Result<String, String> {
    let mut hasher = Sha256::new();
    for record in records_before_decision_end {
        if matches!(record, TargetPolicyDistributionRecordV1::DecisionEnd(_)) {
            return Err("decision_end must not be included in decisionRecordsSha256".to_string());
        }
        hasher.update(canonical_json(record).map_err(|error| error.to_string())?);
        hasher.update(b"\n");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn target_distribution_manifest_bytes(
    manifest: &TargetPolicyDistributionManifestV1,
) -> Result<Vec<u8>, String> {
    manifest.validate()?;
    let mut bytes = super::canonical::canonical_wire_json(manifest)
        .map_err(|error| error.to_string())?
        .into_bytes();
    bytes.push(b'\n');
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_TARGET_DISTRIBUTION_LINE_BYTES {
        return Err("target distribution manifest exceeds record limit".to_string());
    }
    Ok(bytes)
}

pub fn compute_target_distribution_receipt_sha256(
    receipt: &TargetPolicyDistributionVerificationReceiptV1,
) -> Result<String, String> {
    let mut value = serde_json::to_value(receipt).map_err(|error| error.to_string())?;
    value
        .as_object_mut()
        .expect("receipt serializes as an object")
        .remove("verificationReceiptSha256");
    Ok(sha256_hex(
        canonical_json(&value).map_err(|error| error.to_string())?,
    ))
}

pub fn compute_target_distribution_stream_receipt_sha256(
    receipt: &TargetDistributionStreamVerificationReceiptV2,
) -> Result<String, String> {
    let mut value = serde_json::to_value(receipt).map_err(|error| error.to_string())?;
    value
        .as_object_mut()
        .expect("receipt serializes as an object")
        .remove("verificationReceiptSha256");
    Ok(sha256_hex(
        canonical_json(&value).map_err(|error| error.to_string())?,
    ))
}

fn validate_mass(name: &str, mass: f64, recorded_error: f64) -> Result<(), String> {
    if !mass.is_finite() || !recorded_error.is_finite() || recorded_error < 0.0 {
        return Err(format!(
            "{name} mass diagnostics must be finite and non-negative"
        ));
    }
    let expected_error = (mass - 1.0).abs();
    if (recorded_error - expected_error).abs() > f64::EPSILON
        || recorded_error > PROBABILITY_MASS_TOLERANCE
    {
        return Err(format!("{name} mass diagnostics are inconsistent"));
    }
    Ok(())
}

fn validate_probability(name: &str, value: f64) -> Result<(), String> {
    if value.is_finite() && value > 0.0 && value <= 1.0 {
        Ok(())
    } else {
        Err(format!("{name} must be finite and in (0, 1]"))
    }
}

fn require_non_empty(name: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{name} must not be empty"))
    } else {
        Ok(())
    }
}

fn require_sha256(name: &str, value: &str) -> Result<(), String> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(format!("{name} must be a lowercase SHA-256 digest"))
    }
}

fn require_canonical_uuid(name: &str, value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let valid = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(byte)
            }
        });
    if valid {
        Ok(())
    } else {
        Err(format!("{name} must be a lowercase canonical UUID"))
    }
}

fn deserialize_finite<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = f64::deserialize(deserializer)?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(de::Error::custom("value must be finite"))
    }
}

fn deserialize_non_negative_finite<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = deserialize_finite(deserializer)?;
    if value >= 0.0 {
        Ok(value)
    } else {
        Err(de::Error::custom("value must be non-negative"))
    }
}

fn deserialize_probability<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = deserialize_finite(deserializer)?;
    validate_probability("probability", value).map_err(de::Error::custom)?;
    Ok(value)
}

fn deserialize_true<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    match bool::deserialize(deserializer)? {
        true => Ok(true),
        false => Err(de::Error::custom("value must be true")),
    }
}

fn deserialize_false<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    match bool::deserialize(deserializer)? {
        false => Ok(false),
        true => Err(de::Error::custom("value must be false")),
    }
}
