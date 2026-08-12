use std::{cmp::Ordering, collections::HashSet, num::NonZeroU32};

use serde::{Deserialize, Deserializer, Serialize, de};
use telegram_randomized_policy_primitives::compute_full_distribution;

use super::{
    canonical::{candidate_pool_sha256, canonical_json, sha256_hex},
    decision_log::{
        CandidateNamespace, DecisionActionKey, DecisionCandidate, RecommendationDecisionLogV1,
    },
};

pub const PROBABILITY_MASS_TOLERANCE: f64 = 1e-12;
const MAX_CANDIDATE_POOL_SIZE: usize = 2_048;
const MAX_SLATE_SIZE: usize = 64;

pub const fn candidate_namespace_wire_tag(namespace: CandidateNamespace) -> &'static str {
    match namespace {
        CandidateNamespace::ServingPostId => "serving_post_id",
        CandidateNamespace::ModelPostId => "model_post_id",
    }
}

pub fn compare_decision_pool_baseline(
    left: &DecisionCandidate,
    right: &DecisionCandidate,
) -> Ordering {
    left.pool_rank
        .cmp(&right.pool_rank)
        .then_with(|| {
            candidate_namespace_wire_tag(left.candidate_namespace)
                .as_bytes()
                .cmp(candidate_namespace_wire_tag(right.candidate_namespace).as_bytes())
        })
        .then_with(|| {
            left.candidate_id
                .as_bytes()
                .cmp(right.candidate_id.as_bytes())
        })
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RandomizedSlateSimulationInputContractVersion {
    #[serde(rename = "randomized_slate_simulation_input_v1")]
    V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RandomizedSlateSimulationContractVersion {
    #[serde(rename = "randomized_slate_simulation_v1")]
    V1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RandomizedSlatePolicyId {
    #[serde(rename = "eligible_pool_epsilon_plackett_luce_v1")]
    EligiblePoolEpsilonPlackettLuceV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RandomizedSlateSimulationStatus {
    #[serde(rename = "simulated")]
    Simulated,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum BaselineOrderVersion {
    #[serde(rename = "decision_pool_rank_then_identity_v1")]
    DecisionPoolRankThenIdentityV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProbabilitySemantics {
    #[serde(rename = "conditional_on_prior_slate_prefix_v1")]
    ConditionalOnPriorSlatePrefixV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RandomizedSlateEvidenceKind {
    #[serde(rename = "simulated_propensity")]
    SimulatedPropensity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RandomizedSlateConfigV1 {
    pub policy_id: RandomizedSlatePolicyId,
    pub policy_version: String,
    pub config_version: String,
    #[serde(deserialize_with = "deserialize_epsilon")]
    pub epsilon: f64,
    #[serde(deserialize_with = "deserialize_positive_finite")]
    pub temperature: f64,
    pub slate_size: NonZeroU32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RandomizedSlateSimulationInputV1 {
    pub contract_version: RandomizedSlateSimulationInputContractVersion,
    pub source_decision_log: serde_json::Value,
    pub source_decision_log_sha256: String,
    pub config: RandomizedSlateConfigV1,
    #[serde(deserialize_with = "deserialize_uniform_draws")]
    pub uniform_draws: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionFingerprint {
    pub decision_id: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidatePoolFingerprint {
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RandomizedSlateOrderedAction {
    pub action_key: DecisionActionKey,
    pub selected_was_deterministic_top: bool,
    #[serde(deserialize_with = "deserialize_probability")]
    pub plackett_luce_probability: f64,
    #[serde(deserialize_with = "deserialize_probability")]
    pub conditional_selection_probability: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportDiagnostics {
    pub source_candidate_count: u32,
    pub eligible_candidate_count: u32,
    pub excluded_ineligible_candidate_count: u32,
    pub sampled_count: u32,
    #[serde(deserialize_with = "deserialize_true")]
    pub without_replacement: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NumericalDiagnosticsStep {
    pub served_position: NonZeroU32,
    pub remaining_candidate_count: u32,
    #[serde(deserialize_with = "deserialize_finite")]
    pub plackett_luce_probability_mass: f64,
    #[serde(deserialize_with = "deserialize_finite")]
    pub mixed_probability_mass: f64,
    #[serde(deserialize_with = "deserialize_non_negative_finite")]
    pub probability_mass_error: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NumericalDiagnostics {
    #[serde(deserialize_with = "deserialize_probability_mass_tolerance")]
    pub probability_mass_tolerance: f64,
    #[serde(deserialize_with = "deserialize_non_negative_finite")]
    pub max_probability_mass_error: f64,
    pub steps: Vec<NumericalDiagnosticsStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RandomizedSlateSimulationV1 {
    pub contract_version: RandomizedSlateSimulationContractVersion,
    pub status: RandomizedSlateSimulationStatus,
    pub policy: RandomizedSlateConfigV1,
    pub baseline_order_version: BaselineOrderVersion,
    pub probability_semantics: ProbabilitySemantics,
    pub decision_fingerprint: DecisionFingerprint,
    pub candidate_pool_fingerprint: CandidatePoolFingerprint,
    pub ordered_actions: Vec<RandomizedSlateOrderedAction>,
    pub support_diagnostics: SupportDiagnostics,
    pub numerical_diagnostics: NumericalDiagnostics,
    pub evidence_kind: RandomizedSlateEvidenceKind,
    #[serde(deserialize_with = "deserialize_false")]
    pub servable: bool,
    pub simulation_sha256: String,
}

impl RandomizedSlateConfigV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_non_empty("policyVersion", &self.policy_version)?;
        require_non_empty("configVersion", &self.config_version)?;
        if !self.epsilon.is_finite() || self.epsilon <= 0.0 || self.epsilon > 1.0 {
            return Err("epsilon must be finite and in (0, 1]".to_string());
        }
        if !self.temperature.is_finite() || self.temperature <= 0.0 {
            return Err("temperature must be finite and positive".to_string());
        }
        Ok(())
    }
}

impl RandomizedSlateSimulationInputV1 {
    pub fn parsed_source_decision_log(
        &self,
    ) -> Result<RecommendationDecisionLogV1, serde_json::Error> {
        RecommendationDecisionLogV1::deserialize(&self.source_decision_log)
    }

    pub fn validate(&self) -> Result<(), String> {
        let source_decision_log = self
            .parsed_source_decision_log()
            .map_err(|error| format!("parse sourceDecisionLog: {error}"))?;
        source_decision_log.validate()?;
        if source_decision_log.candidate_pool.candidates.len() > MAX_CANDIDATE_POOL_SIZE {
            return Err("candidate pool exceeds 2048 entries".to_string());
        }
        let mut candidate_identities = HashSet::new();
        for candidate in &source_decision_log.candidate_pool.candidates {
            if !candidate_identities.insert((
                candidate.candidate_namespace,
                candidate.candidate_id.as_str(),
            )) {
                return Err("candidate pool identities must be unique".to_string());
            }
        }
        self.config.validate()?;
        require_sha256("sourceDecisionLogSha256", &self.source_decision_log_sha256)?;

        let expected_decision_sha256 = sha256_hex(
            canonical_json(&self.source_decision_log)
                .map_err(|error| format!("canonicalize sourceDecisionLog: {error}"))?,
        );
        if self.source_decision_log_sha256 != expected_decision_sha256 {
            return Err("sourceDecisionLogSha256 does not match sourceDecisionLog".to_string());
        }
        let expected_pool_sha256 =
            candidate_pool_sha256(&source_decision_log.candidate_pool.candidates)
                .map_err(|error| format!("canonicalize candidate pool: {error}"))?;
        if source_decision_log.candidate_pool.candidate_pool_sha256 != expected_pool_sha256 {
            return Err("candidatePoolSha256 does not match candidate pool".to_string());
        }

        let eligible_count = source_decision_log
            .candidate_pool
            .candidates
            .iter()
            .filter(|candidate| candidate.eligible)
            .count();
        let slate_size = usize::try_from(self.config.slate_size.get())
            .expect("u32 slate size is representable as usize");
        if slate_size > MAX_SLATE_SIZE {
            return Err("slateSize exceeds 64".to_string());
        }
        if eligible_count < slate_size {
            return Err("eligible candidate count must be at least slateSize".to_string());
        }
        if self.uniform_draws.len() != slate_size {
            return Err("uniformDraws length must equal slateSize".to_string());
        }
        if self
            .uniform_draws
            .iter()
            .any(|draw| !draw.is_finite() || *draw <= 0.0 || *draw >= 1.0)
        {
            return Err("uniformDraws values must be finite and in (0, 1)".to_string());
        }
        Ok(())
    }
}

impl RandomizedSlateSimulationV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_sha256("simulationSha256", &self.simulation_sha256)?;
        if !verify_simulation_sha256(self)? {
            return Err("simulationSha256 does not match simulation output".to_string());
        }
        Ok(())
    }

    pub fn validate_against(&self, input: &RandomizedSlateSimulationInputV1) -> Result<(), String> {
        input.validate()?;
        self.validate()?;
        let source_decision_log = input
            .parsed_source_decision_log()
            .map_err(|error| format!("parse sourceDecisionLog: {error}"))?;
        let candidates = &source_decision_log.candidate_pool.candidates;
        let source_candidate_count =
            u32::try_from(candidates.len()).map_err(|_| "source candidate count exceeds u32")?;
        let eligible_candidate_count = u32::try_from(
            candidates
                .iter()
                .filter(|candidate| candidate.eligible)
                .count(),
        )
        .map_err(|_| "eligible candidate count exceeds u32")?;

        if self.policy != input.config {
            return Err("output policy does not match input config".to_string());
        }
        if self.decision_fingerprint.decision_id != source_decision_log.decision_id
            || self.decision_fingerprint.sha256 != input.source_decision_log_sha256
        {
            return Err("decisionFingerprint does not match input decision".to_string());
        }
        if self.candidate_pool_fingerprint.sha256
            != source_decision_log.candidate_pool.candidate_pool_sha256
        {
            return Err("candidatePoolFingerprint does not match input pool".to_string());
        }
        if self.support_diagnostics.source_candidate_count != source_candidate_count
            || self.support_diagnostics.eligible_candidate_count != eligible_candidate_count
            || self.support_diagnostics.excluded_ineligible_candidate_count
                != source_candidate_count - eligible_candidate_count
            || self.support_diagnostics.sampled_count != input.config.slate_size.get()
        {
            return Err("supportDiagnostics does not match input pool".to_string());
        }

        let mut remaining = candidates
            .iter()
            .filter(|candidate| candidate.eligible)
            .collect::<Vec<_>>();
        for ((action, step), draw) in self
            .ordered_actions
            .iter()
            .zip(&self.numerical_diagnostics.steps)
            .zip(&input.uniform_draws)
        {
            remaining.sort_unstable_by(|left, right| compare_decision_pool_baseline(left, right));
            let logits = remaining
                .iter()
                .map(|candidate| {
                    candidate
                        .score
                        .ok_or_else(|| "eligible candidate score is unavailable".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            let distribution =
                compute_full_distribution(&logits, input.config.epsilon, input.config.temperature)
                    .map_err(|error| format!("recompute probability distribution: {error:?}"))?;
            let selected_index = remaining
                .iter()
                .position(|candidate| {
                    candidate.candidate_namespace == action.action_key.candidate_namespace
                        && candidate.candidate_id == action.action_key.candidate_id
                })
                .ok_or_else(|| {
                    "ordered action does not match a remaining eligible candidate".to_string()
                })?;
            let expected_probability = distribution.probabilities[selected_index];
            if action.selected_was_deterministic_top != (selected_index == 0) {
                return Err("selectedWasDeterministicTop does not match baseline order".to_string());
            }
            if action.plackett_luce_probability != expected_probability.0
                || action.conditional_selection_probability != expected_probability.1
                || step.plackett_luce_probability_mass
                    != distribution.diagnostics.plackett_luce_mass
                || step.mixed_probability_mass != distribution.diagnostics.mixed_mass
                || step.probability_mass_error
                    != distribution
                        .diagnostics
                        .plackett_luce_mass_error
                        .max(distribution.diagnostics.mixed_mass_error)
            {
                return Err("simulation probabilities do not match input scores".to_string());
            }
            let expected_selected_index = distribution
                .probabilities
                .iter()
                .scan(0.0, |cumulative, probability| {
                    *cumulative += probability.1;
                    Some(*cumulative)
                })
                .position(|cumulative| *draw < cumulative)
                .unwrap_or(distribution.probabilities.len() - 1);
            if selected_index != expected_selected_index {
                return Err("ordered action does not match uniform draw".to_string());
            }
            remaining.remove(selected_index);
        }
        Ok(())
    }

    fn validate_hash_preimage(&self) -> Result<(), String> {
        self.policy.validate()?;
        require_non_empty(
            "decisionFingerprint.decisionId",
            &self.decision_fingerprint.decision_id,
        )?;
        require_sha256(
            "decisionFingerprint.sha256",
            &self.decision_fingerprint.sha256,
        )?;
        require_sha256(
            "candidatePoolFingerprint.sha256",
            &self.candidate_pool_fingerprint.sha256,
        )?;
        if self.servable {
            return Err("servable must be false".to_string());
        }

        let support = &self.support_diagnostics;
        if !support.without_replacement {
            return Err("withoutReplacement must be true".to_string());
        }
        if support
            .eligible_candidate_count
            .checked_add(support.excluded_ineligible_candidate_count)
            != Some(support.source_candidate_count)
        {
            return Err("support candidate counts are inconsistent".to_string());
        }
        if support.eligible_candidate_count < self.policy.slate_size.get() {
            return Err("eligibleCandidateCount must be at least slateSize".to_string());
        }
        if support.sampled_count != self.policy.slate_size.get() {
            return Err("sampledCount must equal slateSize".to_string());
        }
        let slate_size = usize::try_from(self.policy.slate_size.get())
            .expect("u32 slate size is representable as usize");
        if self.ordered_actions.len() != slate_size
            || self.numerical_diagnostics.steps.len() != slate_size
        {
            return Err("actions and numerical steps must match slateSize".to_string());
        }

        let mut identities = HashSet::new();
        for (index, action) in self.ordered_actions.iter().enumerate() {
            let expected_position = u32::try_from(index + 1).expect("sample count is u32");
            if action.action_key.served_position.get() != expected_position {
                return Err("ordered action positions must be contiguous and 1-based".to_string());
            }
            if !identities.insert((
                action.action_key.candidate_namespace,
                action.action_key.candidate_id.as_str(),
            )) {
                return Err("ordered action candidate identities must be unique".to_string());
            }
            require_non_empty(
                "orderedActions.actionKey.candidateId",
                &action.action_key.candidate_id,
            )?;
            validate_probability("plackettLuceProbability", action.plackett_luce_probability)?;
            validate_probability(
                "conditionalSelectionProbability",
                action.conditional_selection_probability,
            )?;
            let deterministic_mass = f64::from(action.selected_was_deterministic_top);
            let expected_probability = (1.0 - self.policy.epsilon) * deterministic_mass
                + self.policy.epsilon * action.plackett_luce_probability;
            if (action.conditional_selection_probability - expected_probability).abs()
                > PROBABILITY_MASS_TOLERANCE
            {
                return Err(
                    "conditionalSelectionProbability does not match epsilon mixture".to_string(),
                );
            }
        }

        let numerical = &self.numerical_diagnostics;
        if numerical.probability_mass_tolerance != PROBABILITY_MASS_TOLERANCE {
            return Err("probabilityMassTolerance must be 1e-12".to_string());
        }
        let mut expected_max_error = 0.0_f64;
        for (index, step) in numerical.steps.iter().enumerate() {
            let expected_position = u32::try_from(index + 1).expect("sample count is u32");
            if step.served_position.get() != expected_position {
                return Err("numerical step positions must be contiguous and 1-based".to_string());
            }
            if step.remaining_candidate_count
                != support.eligible_candidate_count
                    - u32::try_from(index).expect("sample count is u32")
            {
                return Err("remainingCandidateCount is inconsistent".to_string());
            }
            if !step.plackett_luce_probability_mass.is_finite()
                || !step.mixed_probability_mass.is_finite()
                || !step.probability_mass_error.is_finite()
                || step.probability_mass_error < 0.0
            {
                return Err("numerical diagnostics must be finite and non-negative".to_string());
            }
            let expected_error = (step.plackett_luce_probability_mass - 1.0)
                .abs()
                .max((step.mixed_probability_mass - 1.0).abs());
            if step.probability_mass_error != expected_error {
                return Err("probabilityMassError is inconsistent".to_string());
            }
            expected_max_error = expected_max_error.max(expected_error);
        }
        if numerical.max_probability_mass_error != expected_max_error {
            return Err("maxProbabilityMassError is inconsistent".to_string());
        }
        if numerical.max_probability_mass_error > numerical.probability_mass_tolerance {
            return Err("probability mass error exceeds tolerance".to_string());
        }
        Ok(())
    }
}

pub fn compute_simulation_sha256(output: &RandomizedSlateSimulationV1) -> Result<String, String> {
    output.validate_hash_preimage()?;
    let mut value = serde_json::to_value(output)
        .map_err(|error| format!("serialize simulation output: {error}"))?;
    value
        .as_object_mut()
        .expect("simulation output serializes as an object")
        .remove("simulationSha256");
    Ok(sha256_hex(canonical_json(&value).map_err(|error| {
        format!("canonicalize simulation output: {error}")
    })?))
}

pub fn verify_simulation_sha256(output: &RandomizedSlateSimulationV1) -> Result<bool, String> {
    Ok(output.simulation_sha256 == compute_simulation_sha256(output)?)
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

fn validate_probability(name: &str, value: f64) -> Result<(), String> {
    if value.is_finite() && value > 0.0 && value <= 1.0 {
        Ok(())
    } else {
        Err(format!("{name} must be finite and in (0, 1]"))
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

fn deserialize_positive_finite<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = deserialize_finite(deserializer)?;
    if value > 0.0 {
        Ok(value)
    } else {
        Err(de::Error::custom("value must be positive"))
    }
}

fn deserialize_epsilon<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = deserialize_finite(deserializer)?;
    if value > 0.0 && value <= 1.0 {
        Ok(value)
    } else {
        Err(de::Error::custom("epsilon must be in (0, 1]"))
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

fn deserialize_uniform_draws<'de, D>(deserializer: D) -> Result<Vec<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    let values = Vec::<f64>::deserialize(deserializer)?;
    if values
        .iter()
        .all(|value| value.is_finite() && *value > 0.0 && *value < 1.0)
    {
        Ok(values)
    } else {
        Err(de::Error::custom(
            "uniformDraws values must be finite and in (0, 1)",
        ))
    }
}

fn deserialize_probability_mass_tolerance<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = deserialize_finite(deserializer)?;
    if value == PROBABILITY_MASS_TOLERANCE {
        Ok(value)
    } else {
        Err(de::Error::custom("probabilityMassTolerance must be 1e-12"))
    }
}

fn deserialize_true<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    match bool::deserialize(deserializer)? {
        true => Ok(true),
        false => Err(de::Error::custom("withoutReplacement must be true")),
    }
}

fn deserialize_false<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    match bool::deserialize(deserializer)? {
        false => Ok(false),
        true => Err(de::Error::custom("servable must be false")),
    }
}
