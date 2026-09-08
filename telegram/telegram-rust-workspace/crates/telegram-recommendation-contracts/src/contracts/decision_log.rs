use std::{collections::HashSet, num::NonZeroU32};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, de};

use super::canonical::candidate_pool_sha256;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RecommendationDecisionLogContractVersion {
    #[serde(rename = "recommendation_decision_log_v1")]
    V1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PositionContractVersion {
    #[serde(rename = "served_position_1_based_v1")]
    ServedPosition1BasedV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecommendationDecisionLogV1 {
    pub contract_version: RecommendationDecisionLogContractVersion,
    pub position_contract_version: PositionContractVersion,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_request_id: Option<String>,
    pub decision_id: String,
    pub decision_at: DateTime<Utc>,
    pub serving_owner: ServingOwner,
    pub fallback_reason: Option<String>,
    pub behavior_policy_kind: BehaviorPolicyKind,
    pub behavior_policy: BehaviorPolicyEvidence,
    pub versions: DecisionVersionEvidence,
    pub candidate_pool: DecisionCandidatePool,
    pub actions: Vec<DecisionAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BehaviorPolicyEvidence {
    pub policy_id: String,
    pub policy_version: VersionEvidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionVersionEvidence {
    pub pipeline: VersionEvidence,
    pub strategy: VersionEvidence,
    pub policy: VersionEvidence,
    pub graph: VersionEvidence,
    pub model: VersionEvidence,
    pub artifact: VersionEvidence,
    pub index: VersionEvidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum VersionEvidence {
    Bound { version: String },
    Unavailable { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum ObjectiveEvidence {
    Available {
        objective: String,
        prediction: f64,
        #[serde(rename = "artifactVersion")]
        artifact_version: String,
    },
    Unavailable {
        objective: String,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionCandidatePool {
    pub support_evidence: CandidateSupportEvidence,
    pub total_count: u32,
    pub truncated: bool,
    pub candidates: Vec<DecisionCandidate>,
    pub candidate_pool_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CandidateSupportEvidence {
    Complete,
    Incomplete { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionCandidate {
    pub candidate_namespace: CandidateNamespace,
    pub candidate_id: String,
    pub pool_rank: NonZeroU32,
    pub eligible: bool,
    pub score: Option<f64>,
    pub selected: bool,
    pub selection_rank: Option<NonZeroU32>,
    pub served: bool,
    pub served_position: Option<NonZeroU32>,
    pub objective_evidence: Vec<ObjectiveEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionAction {
    pub action_key: DecisionActionKey,
    pub selection_rank: NonZeroU32,
    pub behavior_propensity: PropensityEvidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionActionKey {
    pub candidate_namespace: CandidateNamespace,
    pub candidate_id: String,
    pub served_position: NonZeroU32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum PropensityEvidence {
    LoggedRandomized {
        #[serde(
            rename = "selectionProbability",
            deserialize_with = "deserialize_selection_probability"
        )]
        selection_probability: f64,
    },
    NotEvaluableDeterministic {
        reason: DeterministicNotEvaluableReason,
    },
    UnknownSupport {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DeterministicNotEvaluableReason {
    #[serde(rename = "deterministic_top_k_no_logged_probability")]
    DeterministicTopKNoLoggedProbability,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CandidateNamespace {
    ServingPostId,
    ModelPostId,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServingOwner {
    Node,
    Rust,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorPolicyKind {
    DeterministicTopK,
    LoggedRandomized,
}

impl RecommendationDecisionLogV1 {
    pub fn validate(&self) -> Result<(), String> {
        require_uuid("requestId", &self.request_id)?;
        require_uuid("decisionId", &self.decision_id)?;
        if let Some(value) = &self.client_request_id {
            require_non_empty("clientRequestId", value)?;
        }
        if let Some(value) = &self.fallback_reason {
            require_non_empty("fallbackReason", value)?;
        }
        require_non_empty("behaviorPolicy.policyId", &self.behavior_policy.policy_id)?;
        validate_version(
            "behaviorPolicy.policyVersion",
            &self.behavior_policy.policy_version,
        )?;
        for (name, version) in [
            ("pipeline", &self.versions.pipeline),
            ("strategy", &self.versions.strategy),
            ("policy", &self.versions.policy),
            ("graph", &self.versions.graph),
            ("model", &self.versions.model),
            ("artifact", &self.versions.artifact),
            ("index", &self.versions.index),
        ] {
            validate_version(name, version)?;
        }

        let candidate_count = self.candidate_pool.candidates.len();
        let total_count = self.candidate_pool.total_count as usize;
        if candidate_count > total_count {
            return Err("candidate count exceeds totalCount".to_string());
        }
        if !self.candidate_pool.truncated && candidate_count != total_count {
            return Err("complete pool count must equal totalCount".to_string());
        }
        if self.candidate_pool.truncated
            && matches!(
                self.candidate_pool.support_evidence,
                CandidateSupportEvidence::Complete
            )
        {
            return Err("truncated pool cannot claim complete support".to_string());
        }
        require_sha256(
            "candidatePoolSha256",
            &self.candidate_pool.candidate_pool_sha256,
        )?;
        let expected_pool_sha256 = candidate_pool_sha256(&self.candidate_pool.candidates)
            .map_err(|error| format!("canonicalize candidate pool: {error}"))?;
        if self.candidate_pool.candidate_pool_sha256 != expected_pool_sha256 {
            return Err("candidatePoolSha256 does not match candidate pool".to_string());
        }
        if let CandidateSupportEvidence::Incomplete { reason } =
            &self.candidate_pool.support_evidence
        {
            require_non_empty("supportEvidence.reason", reason)?;
        }

        let mut candidate_identities = HashSet::with_capacity(candidate_count);
        let mut selection_ranks = HashSet::new();
        let mut served_positions = HashSet::new();
        for candidate in &self.candidate_pool.candidates {
            require_non_empty("candidateId", &candidate.candidate_id)?;
            if !candidate_identities.insert((
                candidate.candidate_namespace,
                candidate.candidate_id.as_str(),
            )) {
                return Err("candidate pool identities must be unique".to_string());
            }
            if candidate.selected != candidate.selection_rank.is_some() {
                return Err("selected must match selectionRank presence".to_string());
            }
            if candidate.served != candidate.served_position.is_some() {
                return Err("served must match servedPosition presence".to_string());
            }
            if candidate.served && !candidate.selected {
                return Err("served candidate must be selected".to_string());
            }
            if candidate.selected && !candidate.eligible {
                return Err("selected candidate must be eligible".to_string());
            }
            if candidate.score.is_some_and(|score| !score.is_finite()) {
                return Err("candidate score must be finite".to_string());
            }
            if candidate
                .selection_rank
                .is_some_and(|rank| !selection_ranks.insert(rank))
            {
                return Err("selection ranks must be unique".to_string());
            }
            if candidate
                .served_position
                .is_some_and(|position| !served_positions.insert(position))
            {
                return Err("served positions must be unique".to_string());
            }
            for evidence in &candidate.objective_evidence {
                validate_objective_evidence(evidence)?;
            }
        }

        require_contiguous_positions("selection ranks", &selection_ranks)?;

        let mut action_keys = std::collections::HashSet::new();
        for action in &self.actions {
            require_non_empty("action.candidateId", &action.action_key.candidate_id)?;
            validate_propensity(&action.behavior_propensity)?;
            match (&self.behavior_policy_kind, &action.behavior_propensity) {
                (
                    BehaviorPolicyKind::DeterministicTopK,
                    PropensityEvidence::NotEvaluableDeterministic { .. },
                )
                | (
                    BehaviorPolicyKind::LoggedRandomized,
                    PropensityEvidence::LoggedRandomized { .. }
                    | PropensityEvidence::UnknownSupport { .. },
                ) => {}
                _ => {
                    return Err("behaviorPolicyKind does not match propensity evidence".to_string());
                }
            }
            let key = (
                action.action_key.candidate_namespace,
                action.action_key.candidate_id.as_str(),
                action.action_key.served_position,
            );
            if !action_keys.insert(key) {
                return Err("action keys must be unique".to_string());
            }
            let matches = self
                .candidate_pool
                .candidates
                .iter()
                .filter(|candidate| {
                    candidate.candidate_namespace == action.action_key.candidate_namespace
                        && candidate.candidate_id == action.action_key.candidate_id
                        && candidate.served_position == Some(action.action_key.served_position)
                })
                .collect::<Vec<_>>();
            if matches.len() != 1 || !matches[0].selected || !matches[0].served {
                return Err("action must reference one selected served candidate".to_string());
            }
            if matches[0].selection_rank != Some(action.selection_rank) {
                return Err("action selectionRank must match candidate".to_string());
            }
        }
        for candidate in self
            .candidate_pool
            .candidates
            .iter()
            .filter(|candidate| candidate.served)
        {
            let count = self
                .actions
                .iter()
                .filter(|action| {
                    action.action_key.candidate_namespace == candidate.candidate_namespace
                        && action.action_key.candidate_id == candidate.candidate_id
                        && Some(action.action_key.served_position) == candidate.served_position
                })
                .count();
            if count != 1 {
                return Err("served candidate must have exactly one action".to_string());
            }
        }
        Ok(())
    }
}

fn require_contiguous_positions(name: &str, positions: &HashSet<NonZeroU32>) -> Result<(), String> {
    for expected in 1..=positions.len() {
        let expected =
            NonZeroU32::new(u32::try_from(expected).map_err(|_| format!("{name} exceed u32"))?)
                .expect("one-based position is non-zero");
        if !positions.contains(&expected) {
            return Err(format!("{name} must be contiguous and 1-based"));
        }
    }
    Ok(())
}

fn validate_version(name: &str, evidence: &VersionEvidence) -> Result<(), String> {
    match evidence {
        VersionEvidence::Bound { version } => require_non_empty(name, version),
        VersionEvidence::Unavailable { reason } => require_non_empty(name, reason),
    }
}

fn validate_objective_evidence(evidence: &ObjectiveEvidence) -> Result<(), String> {
    match evidence {
        ObjectiveEvidence::Available {
            objective,
            prediction,
            artifact_version,
        } => {
            require_non_empty("objective", objective)?;
            require_non_empty("artifactVersion", artifact_version)?;
            if !prediction.is_finite() {
                return Err("objective prediction must be finite".to_string());
            }
        }
        ObjectiveEvidence::Unavailable { objective, reason } => {
            require_non_empty("objective", objective)?;
            require_non_empty("objective.reason", reason)?;
        }
    }
    Ok(())
}

fn validate_propensity(propensity: &PropensityEvidence) -> Result<(), String> {
    match propensity {
        PropensityEvidence::LoggedRandomized {
            selection_probability,
        } if !selection_probability.is_finite()
            || *selection_probability <= 0.0
            || *selection_probability > 1.0 =>
        {
            Err("selectionProbability must be finite and in (0, 1]".to_string())
        }
        PropensityEvidence::UnknownSupport { reason } => {
            require_non_empty("propensity.reason", reason)
        }
        _ => Ok(()),
    }
}

fn require_non_empty(name: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{name} must not be empty"))
    } else {
        Ok(())
    }
}

fn require_uuid(name: &str, value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let valid = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    if valid {
        Ok(())
    } else {
        Err(format!("{name} must be a UUID"))
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

fn deserialize_selection_probability<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let probability = f64::deserialize(deserializer)?;
    if probability.is_finite() && probability > 0.0 && probability <= 1.0 {
        Ok(probability)
    } else {
        Err(de::Error::custom(
            "selectionProbability must be finite and in (0, 1]",
        ))
    }
}
