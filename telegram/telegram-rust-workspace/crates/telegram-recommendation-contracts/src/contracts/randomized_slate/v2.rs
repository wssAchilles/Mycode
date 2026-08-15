use std::{collections::HashSet, mem::size_of};

use serde::{Deserialize, Serialize};
use telegram_randomized_policy_primitives::{
    DETERMINISTIC_RNG_SUITE_V1, DeterministicOpen53Rng, OPEN53_MAX_WORDS_PER_DRAW_V1,
    OPEN53_WORD_BYTES_V1, compute_development_rng_context_sha256_v1,
    compute_development_seed_commitment_sha256_v1, compute_full_distribution,
};

use super::{
    BaselineOrderVersion, CandidatePoolFingerprint, DecisionFingerprint, NumericalDiagnostics,
    NumericalDiagnosticsStep, ProbabilitySemantics, RandomizedSlateConfigV1, SupportDiagnostics,
    candidate_namespace_wire_tag, compare_decision_pool_baseline,
};
use crate::contracts::{
    canonical::{canonical_json, sha256_hex},
    decision_log::{
        BehaviorPolicyKind, CandidateSupportEvidence, DecisionActionKey, DecisionCandidate,
        RecommendationDecisionLogV1,
    },
};

pub const DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES: usize = 32 * 1024 * 1024;
pub const DEVELOPMENT_V2_MAX_OUTPUT_CANONICAL_BYTES: usize = 32 * 1024 * 1024;
pub const DEVELOPMENT_V2_MAX_HASH_BYTES: u64 = 512 * 1024 * 1024;
pub const DEVELOPMENT_V2_MAX_ALGORITHM_ALLOCATION_BYTES: u64 = 128 * 1024 * 1024;
pub const DEVELOPMENT_V2_MAX_CANDIDATE_WORK_UNITS: u64 = 5_000_000;
pub const DEVELOPMENT_V2_MAX_EPOCH_ID_BYTES: usize = 128;
pub const DEVELOPMENT_V2_POLICY_ARITHMETIC_VERSION: &str = "rust_epsilon_plackett_luce_binary64_v1";
const DEVELOPMENT_V2_RECEIPT_FIXED_BYTES_UPPER_BOUND: u64 = 1024 * 1024;
const DEVELOPMENT_V2_RECEIPT_PER_ACTION_BYTES_UPPER_BOUND: u64 = 4096;
const JSON_STRING_BYTE_EXPANSION_UPPER_BOUND: u64 = 6;

const OPEN53_MASK: u64 = (1_u64 << 53) - 1;
const OPEN53_DENOMINATOR: f64 = 9_007_199_254_740_992.0;

mod admission;
pub use admission::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RandomizedSlateDevelopmentInputContractVersionV2 {
    #[serde(rename = "randomized_slate_development_input_v2")]
    V2,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RandomizedSlateDevelopmentReceiptContractVersionV2 {
    #[serde(rename = "randomized_slate_development_receipt_v2")]
    V2,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DevelopmentCommitmentPurposeV1 {
    #[serde(rename = "development_reveal_consistency_only_v1")]
    DevelopmentRevealConsistencyOnlyV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DevelopmentEvidenceKindV1 {
    #[serde(rename = "simulated_propensity")]
    SimulatedPropensity,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum JointProbabilityStatusV1 {
    #[serde(rename = "finite_positive")]
    FinitePositive,
    #[serde(rename = "underflow_log_only")]
    UnderflowLogOnly,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DevelopmentResourceLimitsVersionV1 {
    #[serde(rename = "randomized_slate_development_resource_limits_v1")]
    V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DevelopmentRawInputAdmissionV1 {
    #[serde(rename = "admitted_before_parse_v1")]
    AdmittedBeforeParseV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DevelopmentAlgorithmAdmissionV1 {
    #[serde(rename = "admitted_before_rng_and_policy_v1")]
    AdmittedBeforeRngAndPolicyV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RandomizedSlateDevelopmentInputV2 {
    pub contract_version: RandomizedSlateDevelopmentInputContractVersionV2,
    pub source_decision_log: serde_json::Value,
    pub source_decision_log_sha256: String,
    pub config: RandomizedSlateConfigV1,
    pub epoch_id: String,
    pub revealed_development_seed_hex: String,
    pub seed_commitment_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevelopmentRandomTranscriptV1 {
    pub start_byte_offset: u64,
    pub raw_words_hex: Vec<String>,
    pub accepted_unsigned_53: String,
    pub uniform_draw: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RandomizedSlateDevelopmentActionV2 {
    pub action_key: DecisionActionKey,
    pub deterministic_top_action_key: DecisionActionKey,
    pub selected_was_deterministic_top: bool,
    pub prefix_sha256: String,
    pub remaining_support_sha256: String,
    pub remaining_candidate_count: u32,
    pub distribution_sha256: String,
    pub plackett_luce_probability: f64,
    pub conditional_selection_probability: f64,
    pub conditional_log_probability: f64,
    pub selected_interval_lower_inclusive: f64,
    pub selected_interval_upper_exclusive: f64,
    pub random_transcript: DevelopmentRandomTranscriptV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrderedJointProbabilityV1 {
    pub status: JointProbabilityStatusV1,
    pub log_joint_conditional_selection_probability: f64,
    pub joint_conditional_selection_probability: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DevelopmentResourceReceiptV1 {
    pub limits_version: DevelopmentResourceLimitsVersionV1,
    pub raw_input_admission: DevelopmentRawInputAdmissionV1,
    pub algorithm_admission: DevelopmentAlgorithmAdmissionV1,
    pub maximum_raw_input_bytes: u64,
    pub maximum_output_canonical_bytes: u64,
    pub maximum_hash_bytes: u64,
    pub maximum_algorithm_allocation_bytes: u64,
    pub maximum_candidate_work_units: u64,
    pub raw_input_bytes: u64,
    pub source_decision_canonical_bytes: u64,
    pub policy_config_canonical_bytes: u64,
    pub candidate_count: u32,
    pub eligible_candidate_count: u32,
    pub slate_size: u32,
    pub baseline_sort_passes: u32,
    pub baseline_sort_items: u32,
    pub baseline_sort_comparison_upper_bound: u64,
    pub distribution_entry_evaluations: u64,
    pub selection_comparison_upper_bound: u64,
    pub removal_shift_upper_bound: u64,
    pub candidate_work_units: u64,
    pub maximum_rng_words: u64,
    pub maximum_rng_bytes: u64,
    pub planned_output_canonical_bytes_upper_bound: u64,
    pub planned_hash_bytes_upper_bound: u64,
    pub planned_algorithm_allocation_bytes_upper_bound: u64,
    pub actual_rng_words: u64,
    pub actual_rng_bytes: u64,
    pub actual_output_canonical_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RandomizedSlateDevelopmentReceiptV2 {
    pub contract_version: RandomizedSlateDevelopmentReceiptContractVersionV2,
    pub status: String,
    pub policy: RandomizedSlateConfigV1,
    pub policy_config_sha256: String,
    pub policy_arithmetic_version: String,
    pub baseline_order_version: BaselineOrderVersion,
    pub probability_semantics: ProbabilitySemantics,
    pub rng_protocol: String,
    pub commitment_purpose: DevelopmentCommitmentPurposeV1,
    pub epoch_id: String,
    pub revealed_development_seed_hex: String,
    pub seed_commitment_sha256: String,
    pub rng_context_sha256: String,
    pub decision_fingerprint: DecisionFingerprint,
    pub candidate_pool_fingerprint: CandidatePoolFingerprint,
    pub ordered_actions: Vec<RandomizedSlateDevelopmentActionV2>,
    pub ordered_joint_probability: OrderedJointProbabilityV1,
    pub support_diagnostics: SupportDiagnostics,
    pub numerical_diagnostics: NumericalDiagnostics,
    pub resource_receipt: DevelopmentResourceReceiptV1,
    pub evidence_kind: DevelopmentEvidenceKindV1,
    pub servable: bool,
    pub real_dataset_eligible: bool,
    pub transcript_sha256: String,
}

impl RandomizedSlateDevelopmentInputV2 {
    pub fn parsed_source_decision_log(&self) -> Result<RecommendationDecisionLogV1, String> {
        serde_json::from_value(self.source_decision_log.clone())
            .map_err(|error| format!("parse sourceDecisionLog: {error}"))
    }

    pub fn revealed_seed(&self) -> Result<[u8; 32], String> {
        decode_hex_32(
            "revealedDevelopmentSeedHex",
            &self.revealed_development_seed_hex,
        )
    }

    pub fn validate(&self) -> Result<RecommendationDecisionLogV1, String> {
        if self.epoch_id.is_empty() || self.epoch_id.len() > DEVELOPMENT_V2_MAX_EPOCH_ID_BYTES {
            return Err("epochId must contain 1..=128 UTF-8 bytes".to_string());
        }
        self.config.validate()?;
        require_sha256("sourceDecisionLogSha256", &self.source_decision_log_sha256)?;
        require_sha256("seedCommitmentSha256", &self.seed_commitment_sha256)?;
        let source = self.parsed_source_decision_log()?;
        source.validate()?;
        let source_canonical = canonical_json(&self.source_decision_log)
            .map_err(|error| format!("canonicalize sourceDecisionLog: {error}"))?;
        if sha256_hex(&source_canonical) != self.source_decision_log_sha256 {
            return Err("sourceDecisionLogSha256 does not match sourceDecisionLog".to_string());
        }
        let seed = self.revealed_seed()?;
        let commitment =
            compute_development_seed_commitment_sha256_v1(self.epoch_id.as_bytes(), &seed)
                .map_err(|error| format!("compute development commitment: {error:?}"))?;
        if hex_32(&commitment) != self.seed_commitment_sha256 {
            return Err(
                "seedCommitmentSha256 does not match revealed development seed".to_string(),
            );
        }
        Ok(source)
    }
}

impl RandomizedSlateDevelopmentReceiptV2 {
    pub fn validate_against_raw(&self, raw_input: &[u8]) -> Result<(), String> {
        admit_development_input_raw_v1(raw_input)
            .map_err(|error| format!("development input admission failed: {error:?}"))?;
        let input: RandomizedSlateDevelopmentInputV2 = serde_json::from_slice(raw_input)
            .map_err(|error| format!("parse development input: {error}"))?;
        let source = input.validate()?;
        self.validate_hash_preimage()?;
        if self.policy != input.config
            || self.policy_config_sha256 != policy_config_sha256_v1(&input.config)?
            || self.epoch_id != input.epoch_id
            || self.revealed_development_seed_hex != input.revealed_development_seed_hex
            || self.seed_commitment_sha256 != input.seed_commitment_sha256
        {
            return Err("receipt input binding mismatch".to_string());
        }
        if self.decision_fingerprint.decision_id != source.decision_id
            || self.decision_fingerprint.sha256 != input.source_decision_log_sha256
            || self.candidate_pool_fingerprint.sha256 != source.candidate_pool.candidate_pool_sha256
        {
            return Err("receipt source binding mismatch".to_string());
        }
        let source_sha =
            decode_hex_32("sourceDecisionLogSha256", &input.source_decision_log_sha256)?;
        let pool_sha = decode_hex_32(
            "candidatePoolSha256",
            &source.candidate_pool.candidate_pool_sha256,
        )?;
        let config_sha = decode_hex_32("policyConfigSha256", &self.policy_config_sha256)?;
        let expected_context = compute_development_rng_context_sha256_v1(
            input.epoch_id.as_bytes(),
            source.decision_id.as_bytes(),
            &source_sha,
            &pool_sha,
            &config_sha,
        )
        .map_err(|error| format!("compute development RNG context: {error:?}"))?;
        if self.rng_context_sha256 != hex_32(&expected_context) {
            return Err("rngContextSha256 does not match input context".to_string());
        }
        validate_resource_against_input(self, raw_input, &input, &source)?;
        validate_algorithm_replay(self, &input, &source, &source_sha, &pool_sha, &config_sha)?;
        if self.transcript_sha256 != compute_development_transcript_sha256_v2(self)? {
            return Err("transcriptSha256 does not match receipt".to_string());
        }
        let canonical_bytes = canonical_json(
            &serde_json::to_value(self)
                .map_err(|error| format!("serialize development receipt: {error}"))?,
        )
        .map_err(|error| format!("canonicalize development receipt: {error}"))?;
        if self.resource_receipt.actual_output_canonical_bytes
            != u64::try_from(canonical_bytes.len()).map_err(|_| "receipt byte count overflow")?
        {
            return Err("actualOutputCanonicalBytes does not match receipt bytes".to_string());
        }
        Ok(())
    }

    fn validate_hash_preimage(&self) -> Result<(), String> {
        self.policy.validate()?;
        if self.status != "simulated" {
            return Err("status must be simulated".to_string());
        }
        if self.policy_arithmetic_version != DEVELOPMENT_V2_POLICY_ARITHMETIC_VERSION
            || self.rng_protocol != DETERMINISTIC_RNG_SUITE_V1
        {
            return Err("receipt algorithm version mismatch".to_string());
        }
        if self.servable || self.real_dataset_eligible {
            return Err("development receipt must remain non-servable and synthetic".to_string());
        }
        for (name, value) in [
            ("policyConfigSha256", self.policy_config_sha256.as_str()),
            ("seedCommitmentSha256", self.seed_commitment_sha256.as_str()),
            ("rngContextSha256", self.rng_context_sha256.as_str()),
            (
                "decisionFingerprint.sha256",
                self.decision_fingerprint.sha256.as_str(),
            ),
            (
                "candidatePoolFingerprint.sha256",
                self.candidate_pool_fingerprint.sha256.as_str(),
            ),
            ("transcriptSha256", self.transcript_sha256.as_str()),
        ] {
            require_sha256(name, value)?;
        }
        if self.ordered_actions.len() != self.policy.slate_size.get() as usize
            || self.numerical_diagnostics.steps.len() != self.ordered_actions.len()
            || self.support_diagnostics.eligible_candidate_count < self.policy.slate_size.get()
        {
            return Err("action, numerical, and support counts must match slateSize".to_string());
        }

        let mut identities = HashSet::new();
        let mut expected_offset = 0_u64;
        let mut expected_joint_log = 0.0_f64;
        let mut expected_joint_probability = 1.0_f64;
        let mut actual_rng_words = 0_u64;
        for (index, action) in self.ordered_actions.iter().enumerate() {
            let position = u32::try_from(index + 1).map_err(|_| "action position overflow")?;
            if action.action_key.served_position.get() != position
                || action.deterministic_top_action_key.served_position.get() != position
            {
                return Err("action positions must be contiguous and 1-based".to_string());
            }
            if !identities.insert((
                action.action_key.candidate_namespace,
                action.action_key.candidate_id.as_str(),
            )) {
                return Err("ordered action identities must be unique".to_string());
            }
            let selected_is_top = action.action_key.candidate_namespace
                == action.deterministic_top_action_key.candidate_namespace
                && action.action_key.candidate_id
                    == action.deterministic_top_action_key.candidate_id;
            if action.selected_was_deterministic_top != selected_is_top {
                return Err("deterministic-top binding is inconsistent".to_string());
            }
            let expected_remaining = self
                .support_diagnostics
                .eligible_candidate_count
                .checked_sub(u32::try_from(index).map_err(|_| "remaining count overflow")?)
                .ok_or_else(|| "remaining count underflow".to_string())?;
            if action.remaining_candidate_count != expected_remaining {
                return Err("remainingCandidateCount is inconsistent".to_string());
            }
            for (name, value) in [
                ("prefixSha256", action.prefix_sha256.as_str()),
                (
                    "remainingSupportSha256",
                    action.remaining_support_sha256.as_str(),
                ),
                ("distributionSha256", action.distribution_sha256.as_str()),
            ] {
                require_sha256(name, value)?;
            }
            validate_probability("plackettLuceProbability", action.plackett_luce_probability)?;
            validate_probability(
                "conditionalSelectionProbability",
                action.conditional_selection_probability,
            )?;
            let deterministic_mass = f64::from(action.selected_was_deterministic_top);
            let expected_conditional = (1.0 - self.policy.epsilon) * deterministic_mass
                + self.policy.epsilon * action.plackett_luce_probability;
            if (action.conditional_selection_probability - expected_conditional).abs()
                > super::PROBABILITY_MASS_TOLERANCE
                || action.conditional_log_probability
                    != action.conditional_selection_probability.ln()
            {
                return Err("conditional probability evidence is inconsistent".to_string());
            }
            if !action.conditional_log_probability.is_finite()
                || action.conditional_log_probability > 0.0
            {
                return Err("conditionalLogProbability must be finite and non-positive".to_string());
            }
            if !action.selected_interval_lower_inclusive.is_finite()
                || !action.selected_interval_upper_exclusive.is_finite()
                || action.selected_interval_lower_inclusive < 0.0
                || action.selected_interval_lower_inclusive
                    >= action.selected_interval_upper_exclusive
                || action.selected_interval_upper_exclusive > 1.0
                || action.random_transcript.uniform_draw < action.selected_interval_lower_inclusive
                || action.random_transcript.uniform_draw >= action.selected_interval_upper_exclusive
            {
                return Err("selected interval does not contain the draw".to_string());
            }
            validate_random_transcript(&action.random_transcript, expected_offset)?;
            expected_offset = expected_offset
                .checked_add(
                    u64::try_from(action.random_transcript.raw_words_hex.len() * 8)
                        .map_err(|_| "RNG byte count overflow")?,
                )
                .ok_or_else(|| "RNG byte count overflow".to_string())?;
            actual_rng_words = actual_rng_words
                .checked_add(
                    u64::try_from(action.random_transcript.raw_words_hex.len())
                        .map_err(|_| "RNG word count overflow")?,
                )
                .ok_or_else(|| "RNG word count overflow".to_string())?;
            expected_joint_log += action.conditional_log_probability;
            expected_joint_probability *= action.conditional_selection_probability;
        }
        if self
            .ordered_joint_probability
            .log_joint_conditional_selection_probability
            != expected_joint_log
        {
            return Err("joint log probability is inconsistent".to_string());
        }
        match (
            self.ordered_joint_probability.status,
            self.ordered_joint_probability
                .joint_conditional_selection_probability,
        ) {
            (JointProbabilityStatusV1::FinitePositive, Some(value)) => {
                validate_probability("jointConditionalSelectionProbability", value)?;
                if expected_joint_probability == 0.0 || value != expected_joint_probability {
                    return Err("joint probability product is inconsistent".to_string());
                }
            }
            (JointProbabilityStatusV1::UnderflowLogOnly, None) => {
                if expected_joint_probability != 0.0 {
                    return Err("joint probability underflow status is inconsistent".to_string());
                }
            }
            _ => return Err("joint probability status is inconsistent".to_string()),
        }
        if self.resource_receipt.actual_rng_words != actual_rng_words
            || self.resource_receipt.actual_rng_bytes != expected_offset
            || self.resource_receipt.actual_output_canonical_bytes
                > self.resource_receipt.maximum_output_canonical_bytes
        {
            return Err("resource receipt actuals are inconsistent".to_string());
        }
        validate_resource_receipt(self)?;
        validate_support_and_numerical(self)?;
        Ok(())
    }
}

pub fn derive_development_resource_receipt_v1(
    raw_input_bytes: usize,
    source_canonical_bytes: usize,
    config_canonical_bytes: usize,
    input: &RandomizedSlateDevelopmentInputV2,
    source: &RecommendationDecisionLogV1,
) -> Result<DevelopmentResourceReceiptV1, String> {
    let candidate_count = source.candidate_pool.candidates.len();
    let eligible_count = source
        .candidate_pool
        .candidates
        .iter()
        .filter(|candidate| candidate.eligible)
        .count();
    let mut eligible_identity_bytes = 0_usize;
    let mut maximum_eligible_identity_bytes = 0_usize;
    for candidate in source
        .candidate_pool
        .candidates
        .iter()
        .filter(|candidate| candidate.eligible)
    {
        let identity_bytes = candidate_namespace_wire_tag(candidate.candidate_namespace)
            .len()
            .checked_add(candidate.candidate_id.len())
            .ok_or_else(|| "eligible identity byte count overflow".to_string())?;
        eligible_identity_bytes = eligible_identity_bytes
            .checked_add(identity_bytes)
            .ok_or_else(|| "eligible identity byte count overflow".to_string())?;
        maximum_eligible_identity_bytes = maximum_eligible_identity_bytes.max(identity_bytes);
    }
    let slate_size = usize::try_from(input.config.slate_size.get())
        .map_err(|_| "slate size overflow".to_string())?;
    if raw_input_bytes > DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES
        || candidate_count > super::MAX_CANDIDATE_POOL_SIZE
        || slate_size > super::MAX_SLATE_SIZE
        || eligible_count > candidate_count
        || slate_size > eligible_count
    {
        return Err("development resource shape exceeds limits".to_string());
    }
    let e = u64::try_from(eligible_count).map_err(|_| "eligible count overflow")?;
    let k = u64::try_from(slate_size).map_err(|_| "slate size overflow")?;
    let evaluations = k
        .checked_mul(e)
        .and_then(|value| value.checked_sub(k.checked_mul(k.saturating_sub(1))? / 2))
        .ok_or_else(|| "distribution evaluation count overflow".to_string())?;
    let removal_shifts = evaluations
        .checked_sub(k)
        .ok_or_else(|| "removal shift count overflow".to_string())?;
    let baseline_sort_comparisons = e
        .checked_mul(e)
        .ok_or_else(|| "baseline sort comparison count overflow".to_string())?;
    let work = baseline_sort_comparisons
        .checked_add(
            evaluations
                .checked_mul(2)
                .ok_or_else(|| "candidate work count overflow".to_string())?,
        )
        .and_then(|value| value.checked_add(removal_shifts))
        .ok_or_else(|| "candidate work count overflow".to_string())?;
    let source_bytes = u64::try_from(source_canonical_bytes)
        .map_err(|_| "source canonical byte count overflow")?;
    let config_bytes = u64::try_from(config_canonical_bytes)
        .map_err(|_| "config canonical byte count overflow")?;
    let raw_bytes = u64::try_from(raw_input_bytes).map_err(|_| "raw input byte count overflow")?;
    let identity_bytes =
        u64::try_from(eligible_identity_bytes).map_err(|_| "identity byte count overflow")?;
    let maximum_identity_bytes = u64::try_from(maximum_eligible_identity_bytes)
        .map_err(|_| "maximum identity byte count overflow")?;
    let epoch_bytes =
        u64::try_from(input.epoch_id.len()).map_err(|_| "epoch byte count overflow")?;
    let maximum_output_bytes = u64::try_from(DEVELOPMENT_V2_MAX_OUTPUT_CANONICAL_BYTES)
        .map_err(|_| "output byte limit overflow")?;
    let escaped_action_identity_bytes = identity_bytes
        .checked_add(
            k.checked_mul(maximum_identity_bytes)
                .ok_or_else(|| "repeated identity byte count overflow".to_string())?,
        )
        .and_then(|value| value.checked_mul(JSON_STRING_BYTE_EXPANSION_UPPER_BOUND))
        .ok_or_else(|| "escaped identity byte count overflow".to_string())?;
    let escaped_epoch_bytes = epoch_bytes
        .checked_mul(JSON_STRING_BYTE_EXPANSION_UPPER_BOUND)
        .ok_or_else(|| "escaped epoch byte count overflow".to_string())?;
    let planned_output_bytes = DEVELOPMENT_V2_RECEIPT_FIXED_BYTES_UPPER_BOUND
        .checked_add(config_bytes)
        .and_then(|value| value.checked_add(escaped_epoch_bytes))
        .and_then(|value| value.checked_add(escaped_action_identity_bytes))
        .and_then(|value| {
            value.checked_add(k.checked_mul(DEVELOPMENT_V2_RECEIPT_PER_ACTION_BYTES_UPPER_BOUND)?)
        })
        .ok_or_else(|| "output byte count overflow".to_string())?;
    let planned_hash_bytes = source_bytes
        .checked_mul(
            k.checked_mul(3)
                .and_then(|value| value.checked_add(8))
                .ok_or_else(|| "hash byte count overflow".to_string())?,
        )
        .and_then(|value| value.checked_add(config_bytes.checked_mul(4)?))
        .and_then(|value| value.checked_add(raw_bytes))
        .and_then(|value| value.checked_add(planned_output_bytes.checked_mul(12)?))
        .ok_or_else(|| "hash byte count overflow".to_string())?;
    let per_candidate_working_bytes = u64::try_from(
        size_of::<&DecisionCandidate>()
            + size_of::<f64>()
            + size_of::<(f64, f64)>()
            + size_of::<DistributionDigestRow<'static>>(),
    )
    .map_err(|_| "candidate allocation size overflow")?;
    let per_action_working_bytes = u64::try_from(
        size_of::<DecisionActionKey>()
            + size_of::<RandomizedSlateDevelopmentActionV2>()
            + size_of::<NumericalDiagnosticsStep>(),
    )
    .map_err(|_| "action allocation size overflow")?;
    let planned_allocation_bytes = source_bytes
        .checked_add(config_bytes)
        .and_then(|value| value.checked_add(planned_output_bytes))
        .and_then(|value| value.checked_add(e.checked_mul(per_candidate_working_bytes)?))
        .and_then(|value| value.checked_add(k.checked_mul(per_action_working_bytes)?))
        .ok_or_else(|| "algorithm allocation byte count overflow".to_string())?;
    if work > DEVELOPMENT_V2_MAX_CANDIDATE_WORK_UNITS
        || planned_output_bytes > maximum_output_bytes
        || planned_hash_bytes > DEVELOPMENT_V2_MAX_HASH_BYTES
        || planned_allocation_bytes > DEVELOPMENT_V2_MAX_ALGORITHM_ALLOCATION_BYTES
    {
        return Err("development resource plan exceeds limits".to_string());
    }
    let maximum_rng_words = k
        .checked_mul(
            u64::try_from(OPEN53_MAX_WORDS_PER_DRAW_V1).map_err(|_| "RNG word limit overflow")?,
        )
        .ok_or_else(|| "RNG word limit overflow".to_string())?;
    let maximum_rng_bytes = maximum_rng_words
        .checked_mul(u64::try_from(OPEN53_WORD_BYTES_V1).map_err(|_| "RNG byte limit overflow")?)
        .ok_or_else(|| "RNG byte limit overflow".to_string())?;

    Ok(DevelopmentResourceReceiptV1 {
        limits_version: DevelopmentResourceLimitsVersionV1::V1,
        raw_input_admission: DevelopmentRawInputAdmissionV1::AdmittedBeforeParseV1,
        algorithm_admission: DevelopmentAlgorithmAdmissionV1::AdmittedBeforeRngAndPolicyV1,
        maximum_raw_input_bytes: u64::try_from(DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES)
            .map_err(|_| "raw input limit overflow")?,
        maximum_output_canonical_bytes: maximum_output_bytes,
        maximum_hash_bytes: DEVELOPMENT_V2_MAX_HASH_BYTES,
        maximum_algorithm_allocation_bytes: DEVELOPMENT_V2_MAX_ALGORITHM_ALLOCATION_BYTES,
        maximum_candidate_work_units: DEVELOPMENT_V2_MAX_CANDIDATE_WORK_UNITS,
        raw_input_bytes: raw_bytes,
        source_decision_canonical_bytes: source_bytes,
        policy_config_canonical_bytes: config_bytes,
        candidate_count: u32::try_from(candidate_count).map_err(|_| "candidate count overflow")?,
        eligible_candidate_count: u32::try_from(eligible_count)
            .map_err(|_| "eligible candidate count overflow")?,
        slate_size: u32::try_from(slate_size).map_err(|_| "slate size overflow")?,
        baseline_sort_passes: 1,
        baseline_sort_items: u32::try_from(eligible_count)
            .map_err(|_| "baseline sort item count overflow")?,
        baseline_sort_comparison_upper_bound: baseline_sort_comparisons,
        distribution_entry_evaluations: evaluations,
        selection_comparison_upper_bound: evaluations,
        removal_shift_upper_bound: removal_shifts,
        candidate_work_units: work,
        maximum_rng_words,
        maximum_rng_bytes,
        planned_output_canonical_bytes_upper_bound: planned_output_bytes,
        planned_hash_bytes_upper_bound: planned_hash_bytes,
        planned_algorithm_allocation_bytes_upper_bound: planned_allocation_bytes,
        actual_rng_words: 0,
        actual_rng_bytes: 0,
        actual_output_canonical_bytes: 0,
    })
}

fn validate_algorithm_replay(
    receipt: &RandomizedSlateDevelopmentReceiptV2,
    input: &RandomizedSlateDevelopmentInputV2,
    source: &RecommendationDecisionLogV1,
    source_sha: &[u8; 32],
    pool_sha: &[u8; 32],
    config_sha: &[u8; 32],
) -> Result<(), String> {
    if source.behavior_policy_kind != BehaviorPolicyKind::DeterministicTopK
        || !matches!(
            source.candidate_pool.support_evidence,
            CandidateSupportEvidence::Complete
        )
        || source.candidate_pool.truncated
        || usize::try_from(source.candidate_pool.total_count).ok()
            != Some(source.candidate_pool.candidates.len())
    {
        return Err("source is not a complete deterministic development pool".to_string());
    }
    let mut remaining = source
        .candidate_pool
        .candidates
        .iter()
        .filter(|candidate| candidate.eligible)
        .collect::<Vec<_>>();
    if remaining
        .iter()
        .any(|candidate| candidate.score.is_none_or(|score| !score.is_finite()))
    {
        return Err("eligible source scores must be finite".to_string());
    }
    remaining.sort_unstable_by(|left, right| compare_decision_pool_baseline(left, right));
    let seed = input.revealed_seed()?;
    let mut rng = DeterministicOpen53Rng::from_seed_and_context(
        &seed,
        input.epoch_id.as_bytes(),
        source.decision_id.as_bytes(),
        source_sha,
        pool_sha,
        config_sha,
    )
    .map_err(|error| format!("construct development RNG: {error:?}"))?;
    let mut prefix = Vec::<DecisionActionKey>::with_capacity(receipt.ordered_actions.len());

    for (index, (action, numerical)) in receipt
        .ordered_actions
        .iter()
        .zip(&receipt.numerical_diagnostics.steps)
        .enumerate()
    {
        let position = u32::try_from(index + 1).map_err(|_| "action position overflow")?;
        let prefix_sha256 = digest_serializable(&prefix)?;
        let remaining_support_sha256 = digest_serializable(&remaining)?;
        let logits = remaining
            .iter()
            .map(|candidate| {
                candidate
                    .score
                    .ok_or_else(|| "eligible source score is unavailable".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let distribution =
            compute_full_distribution(&logits, input.config.epsilon, input.config.temperature)
                .map_err(|error| format!("recompute development distribution: {error:?}"))?;
        let draw = rng
            .next_open53()
            .map_err(|error| format!("replay development RNG: {error:?}"))?;
        let mut lower = 0.0_f64;
        let mut selected = None;
        let mut distribution_rows = Vec::with_capacity(remaining.len());
        for (candidate_index, (pl_probability, conditional_probability)) in
            distribution.probabilities.iter().copied().enumerate()
        {
            let upper = if candidate_index + 1 == distribution.probabilities.len() {
                1.0
            } else {
                lower + conditional_probability
            };
            let candidate = remaining[candidate_index];
            distribution_rows.push(DistributionDigestRow {
                candidate_namespace: candidate_namespace_wire_tag(candidate.candidate_namespace),
                candidate_id: candidate.candidate_id.as_str(),
                plackett_luce_probability: pl_probability,
                conditional_selection_probability: conditional_probability,
                interval_lower_inclusive: lower,
                interval_upper_exclusive: upper,
            });
            if selected.is_none() && draw.uniform_draw < upper {
                selected = Some((candidate_index, lower, upper));
            }
            lower = upper;
        }
        let (selected_index, selected_lower, selected_upper) =
            selected.ok_or_else(|| "replayed draw did not select a candidate".to_string())?;
        let selected_candidate = remaining[selected_index];
        let deterministic_top = remaining[0];
        let expected_probability = distribution.probabilities[selected_index];
        let expected_action_key = DecisionActionKey {
            candidate_namespace: selected_candidate.candidate_namespace,
            candidate_id: selected_candidate.candidate_id.clone(),
            served_position: std::num::NonZeroU32::new(position)
                .expect("one-based development position is non-zero"),
        };
        let expected_top_key = DecisionActionKey {
            candidate_namespace: deterministic_top.candidate_namespace,
            candidate_id: deterministic_top.candidate_id.clone(),
            served_position: expected_action_key.served_position,
        };
        let expected_raw_words = draw
            .raw_words
            .iter()
            .map(|word| format!("{word:016x}"))
            .collect::<Vec<_>>();
        if action.action_key != expected_action_key
            || action.deterministic_top_action_key != expected_top_key
            || action.selected_was_deterministic_top != (selected_index == 0)
            || action.prefix_sha256 != prefix_sha256
            || action.remaining_support_sha256 != remaining_support_sha256
            || action.remaining_candidate_count
                != u32::try_from(remaining.len()).map_err(|_| "remaining count overflow")?
            || action.distribution_sha256 != digest_serializable(&distribution_rows)?
            || action.plackett_luce_probability != expected_probability.0
            || action.conditional_selection_probability != expected_probability.1
            || action.conditional_log_probability != expected_probability.1.ln()
            || action.selected_interval_lower_inclusive != selected_lower
            || action.selected_interval_upper_exclusive != selected_upper
            || action.random_transcript.start_byte_offset != draw.start_byte_offset
            || action.random_transcript.raw_words_hex != expected_raw_words
            || action.random_transcript.accepted_unsigned_53
                != draw.accepted_unsigned_53.to_string()
            || action.random_transcript.uniform_draw != draw.uniform_draw
        {
            return Err("development action transcript does not replay".to_string());
        }
        let expected_error = distribution
            .diagnostics
            .plackett_luce_mass_error
            .max(distribution.diagnostics.mixed_mass_error);
        if numerical.served_position != expected_action_key.served_position
            || numerical.remaining_candidate_count != action.remaining_candidate_count
            || numerical.plackett_luce_probability_mass
                != distribution.diagnostics.plackett_luce_mass
            || numerical.mixed_probability_mass != distribution.diagnostics.mixed_mass
            || numerical.probability_mass_error != expected_error
        {
            return Err("development numerical transcript does not replay".to_string());
        }
        prefix.push(expected_action_key);
        remaining.remove(selected_index);
    }
    Ok(())
}

fn validate_resource_against_input(
    receipt: &RandomizedSlateDevelopmentReceiptV2,
    raw_input: &[u8],
    input: &RandomizedSlateDevelopmentInputV2,
    source: &RecommendationDecisionLogV1,
) -> Result<(), String> {
    let source_canonical = canonical_json(&input.source_decision_log)
        .map_err(|error| format!("canonicalize sourceDecisionLog: {error}"))?;
    let config_value = serde_json::to_value(&input.config)
        .map_err(|error| format!("serialize randomized slate config: {error}"))?;
    let config_canonical = canonical_json(&config_value)
        .map_err(|error| format!("canonicalize randomized slate config: {error}"))?;
    let mut expected = derive_development_resource_receipt_v1(
        raw_input.len(),
        source_canonical.len(),
        config_canonical.len(),
        input,
        source,
    )?;
    expected.actual_rng_words = receipt.resource_receipt.actual_rng_words;
    expected.actual_rng_bytes = receipt.resource_receipt.actual_rng_bytes;
    expected.actual_output_canonical_bytes = receipt.resource_receipt.actual_output_canonical_bytes;
    if receipt.resource_receipt != expected {
        return Err("resource receipt does not match admitted input".to_string());
    }
    Ok(())
}

pub fn policy_config_sha256_v1(config: &RandomizedSlateConfigV1) -> Result<String, String> {
    let value = serde_json::to_value(config)
        .map_err(|error| format!("serialize randomized slate config: {error}"))?;
    Ok(sha256_hex(&canonical_json(&value).map_err(|error| {
        format!("canonicalize randomized slate config: {error}")
    })?))
}

pub fn compute_development_transcript_sha256_v2(
    receipt: &RandomizedSlateDevelopmentReceiptV2,
) -> Result<String, String> {
    receipt.validate_hash_preimage()?;
    let mut value = serde_json::to_value(receipt)
        .map_err(|error| format!("serialize development receipt: {error}"))?;
    value
        .as_object_mut()
        .expect("development receipt serializes as an object")
        .remove("transcriptSha256");
    Ok(sha256_hex(&canonical_json(&value).map_err(|error| {
        format!("canonicalize development receipt: {error}")
    })?))
}

pub fn decode_hex_32(name: &str, value: &str) -> Result<[u8; 32], String> {
    require_sha256(name, value)?;
    let mut output = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = hex_nibble(pair[0]).ok_or_else(|| format!("{name} must be lowercase hex"))?;
        let low = hex_nibble(pair[1]).ok_or_else(|| format!("{name} must be lowercase hex"))?;
        output[index] = (high << 4) | low;
    }
    Ok(output)
}

pub fn hex_32(value: &[u8; 32]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validate_random_transcript(
    transcript: &DevelopmentRandomTranscriptV1,
    expected_offset: u64,
) -> Result<(), String> {
    if transcript.start_byte_offset != expected_offset
        || transcript.raw_words_hex.is_empty()
        || transcript.raw_words_hex.len() > OPEN53_MAX_WORDS_PER_DRAW_V1
    {
        return Err("random transcript word range is invalid".to_string());
    }
    let mut words = Vec::with_capacity(transcript.raw_words_hex.len());
    for word in &transcript.raw_words_hex {
        if word.len() != 16
            || !word
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("random transcript words must be 16 lowercase hex digits".to_string());
        }
        words.push(u64::from_str_radix(word, 16).map_err(|_| "invalid random transcript word")?);
    }
    if words[..words.len() - 1]
        .iter()
        .any(|word| word & OPEN53_MASK != 0)
    {
        return Err("random transcript retries must map to zero".to_string());
    }
    let accepted = words[words.len() - 1] & OPEN53_MASK;
    let declared = transcript
        .accepted_unsigned_53
        .parse::<u64>()
        .map_err(|_| "acceptedUnsigned53 must be a decimal u64")?;
    if accepted == 0
        || accepted != declared
        || transcript.uniform_draw != accepted as f64 / OPEN53_DENOMINATOR
    {
        return Err("random transcript open53 mapping is inconsistent".to_string());
    }
    Ok(())
}

fn validate_resource_receipt(receipt: &RandomizedSlateDevelopmentReceiptV2) -> Result<(), String> {
    let resource = &receipt.resource_receipt;
    let expected_raw_limit = u64::try_from(DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES)
        .map_err(|_| "raw input limit overflow")?;
    let expected_output_limit = u64::try_from(DEVELOPMENT_V2_MAX_OUTPUT_CANONICAL_BYTES)
        .map_err(|_| "output limit overflow")?;
    if resource.maximum_raw_input_bytes != expected_raw_limit
        || resource.maximum_output_canonical_bytes != expected_output_limit
        || resource.maximum_hash_bytes != DEVELOPMENT_V2_MAX_HASH_BYTES
        || resource.maximum_algorithm_allocation_bytes
            != DEVELOPMENT_V2_MAX_ALGORITHM_ALLOCATION_BYTES
        || resource.maximum_candidate_work_units != DEVELOPMENT_V2_MAX_CANDIDATE_WORK_UNITS
        || resource.raw_input_bytes > expected_raw_limit
        || resource.actual_output_canonical_bytes > expected_output_limit
        || resource.actual_output_canonical_bytes
            > resource.planned_output_canonical_bytes_upper_bound
        || resource.planned_output_canonical_bytes_upper_bound > expected_output_limit
        || resource.planned_hash_bytes_upper_bound > DEVELOPMENT_V2_MAX_HASH_BYTES
        || resource.planned_algorithm_allocation_bytes_upper_bound
            > DEVELOPMENT_V2_MAX_ALGORITHM_ALLOCATION_BYTES
        || resource.candidate_work_units > DEVELOPMENT_V2_MAX_CANDIDATE_WORK_UNITS
        || resource.baseline_sort_passes != 1
        || resource.baseline_sort_items != resource.eligible_candidate_count
    {
        return Err("resource receipt limits are inconsistent".to_string());
    }
    let e = u64::from(resource.eligible_candidate_count);
    let k = u64::from(resource.slate_size);
    let evaluations = k
        .checked_mul(e)
        .and_then(|value| value.checked_sub(k.checked_mul(k.saturating_sub(1))? / 2))
        .ok_or_else(|| "resource evaluation count overflow".to_string())?;
    let shifts = evaluations
        .checked_sub(k)
        .ok_or_else(|| "resource removal count overflow".to_string())?;
    let sort_comparisons = e
        .checked_mul(e)
        .ok_or_else(|| "resource sort comparison count overflow".to_string())?;
    let work = sort_comparisons
        .checked_add(
            evaluations
                .checked_mul(2)
                .ok_or_else(|| "resource work count overflow".to_string())?,
        )
        .and_then(|value| value.checked_add(shifts))
        .ok_or_else(|| "resource work count overflow".to_string())?;
    let maximum_rng_words = k
        .checked_mul(
            u64::try_from(OPEN53_MAX_WORDS_PER_DRAW_V1).map_err(|_| "RNG word limit overflow")?,
        )
        .ok_or_else(|| "RNG word limit overflow".to_string())?;
    if resource.distribution_entry_evaluations != evaluations
        || resource.baseline_sort_comparison_upper_bound != sort_comparisons
        || resource.selection_comparison_upper_bound != evaluations
        || resource.removal_shift_upper_bound != shifts
        || resource.candidate_work_units != work
        || resource.maximum_rng_words != maximum_rng_words
        || resource.maximum_rng_bytes
            != maximum_rng_words
                .checked_mul(
                    u64::try_from(OPEN53_WORD_BYTES_V1).map_err(|_| "RNG byte limit overflow")?,
                )
                .ok_or_else(|| "RNG byte limit overflow".to_string())?
    {
        return Err("resource receipt work model is inconsistent".to_string());
    }
    Ok(())
}

fn validate_support_and_numerical(
    receipt: &RandomizedSlateDevelopmentReceiptV2,
) -> Result<(), String> {
    let support = &receipt.support_diagnostics;
    let resource = &receipt.resource_receipt;
    if !support.without_replacement
        || support.source_candidate_count != resource.candidate_count
        || support.eligible_candidate_count != resource.eligible_candidate_count
        || support.sampled_count != resource.slate_size
        || support
            .eligible_candidate_count
            .checked_add(support.excluded_ineligible_candidate_count)
            != Some(support.source_candidate_count)
    {
        return Err("support diagnostics are inconsistent".to_string());
    }
    let numerical = &receipt.numerical_diagnostics;
    if numerical.probability_mass_tolerance != super::PROBABILITY_MASS_TOLERANCE {
        return Err("numerical tolerance is inconsistent".to_string());
    }
    let mut expected_max = 0.0_f64;
    for (index, step) in numerical.steps.iter().enumerate() {
        let position = u32::try_from(index + 1).map_err(|_| "numerical position overflow")?;
        let expected_remaining = support
            .eligible_candidate_count
            .checked_sub(u32::try_from(index).map_err(|_| "numerical remaining count overflow")?)
            .ok_or_else(|| "numerical remaining count underflow".to_string())?;
        let expected_error = (step.plackett_luce_probability_mass - 1.0)
            .abs()
            .max((step.mixed_probability_mass - 1.0).abs());
        if step.served_position.get() != position
            || step.remaining_candidate_count != expected_remaining
            || step.probability_mass_error != expected_error
            || expected_error > numerical.probability_mass_tolerance
        {
            return Err("numerical diagnostics are inconsistent".to_string());
        }
        expected_max = expected_max.max(expected_error);
    }
    if numerical.max_probability_mass_error != expected_max {
        return Err("maximum probability mass error is inconsistent".to_string());
    }
    Ok(())
}

fn digest_serializable<T: Serialize>(value: &T) -> Result<String, String> {
    let value = serde_json::to_value(value)
        .map_err(|error| format!("serialize development digest input: {error}"))?;
    let canonical = canonical_json(&value)
        .map_err(|error| format!("canonicalize development digest input: {error}"))?;
    Ok(sha256_hex(&canonical))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DistributionDigestRow<'a> {
    candidate_namespace: &'static str,
    candidate_id: &'a str,
    plackett_luce_probability: f64,
    conditional_selection_probability: f64,
    interval_lower_inclusive: f64,
    interval_upper_exclusive: f64,
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

fn validate_probability(name: &str, value: f64) -> Result<(), String> {
    if value.is_finite() && value > 0.0 && value <= 1.0 {
        Ok(())
    } else {
        Err(format!("{name} must be finite and in (0, 1]"))
    }
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}
