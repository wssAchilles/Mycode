use std::{
    collections::HashSet,
    io::{BufRead, Cursor, Write},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use telegram_randomized_policy_primitives::{EpsilonPlackettLuceError, compute_full_distribution};
use telegram_recommendation_contracts::{
    BaselineOrderVersion, CandidatePoolFingerprint, CandidateSupportEvidence, DecisionAction,
    DecisionFingerprint, MAX_TARGET_DISTRIBUTION_AGGREGATE_BYTES,
    MAX_TARGET_DISTRIBUTION_CANDIDATES, MAX_TARGET_DISTRIBUTION_DECISIONS,
    MAX_TARGET_DISTRIBUTION_FILE_BYTES, MAX_TARGET_DISTRIBUTION_LINE_BYTES,
    MAX_TARGET_DISTRIBUTION_PHYSICAL_RECORDS, MAX_TARGET_DISTRIBUTION_POSITIONS,
    ProbabilitySemantics, RandomizedSlateConfigV1, RecommendationDecisionLogV1,
    TargetPolicyActionProbabilityV1, TargetPolicyDistributionContractVersion,
    TargetPolicyDistributionDecisionEndV1, TargetPolicyDistributionDecisionStartV1,
    TargetPolicyDistributionEvidenceKind, TargetPolicyDistributionManifestContractVersion,
    TargetPolicyDistributionManifestV1, TargetPolicyDistributionProducerVersion,
    TargetPolicyDistributionRecordV1, TargetPolicyDistributionSourceDatasetManifestV1,
    TargetPolicyDistributionStepStartV1, candidate_pool_sha256, canonical_json,
    canonical_wire_json, compare_decision_pool_baseline, sha256_hex,
};

use super::{TargetDistributionError, stream_io::BoundedNdjsonReader};

#[derive(Debug, Clone)]
pub struct BuiltTargetDistribution {
    pub ndjson: Vec<u8>,
    pub manifest: TargetPolicyDistributionManifestV1,
}

#[derive(Default)]
struct Counts {
    decisions: u64,
    steps: u64,
    actions: u64,
    physical: u64,
}

struct RecordEmission<F> {
    emit: F,
    raw_hasher: Sha256,
    byte_len: u64,
    aggregate_base_bytes: u64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct BuildStreamDiagnostics {
    pub(crate) max_source_line_bytes: u64,
    pub(crate) max_candidate_count: u32,
}

pub(crate) struct BuildStreamOutcome {
    pub(crate) manifest: TargetPolicyDistributionManifestV1,
    pub(crate) diagnostics: BuildStreamDiagnostics,
}

impl<F> RecordEmission<F>
where
    F: FnMut(&[u8]) -> Result<(), TargetDistributionError>,
{
    fn new(emit: F, aggregate_base_bytes: u64) -> Self {
        Self {
            emit,
            raw_hasher: Sha256::new(),
            byte_len: 0,
            aggregate_base_bytes,
        }
    }

    fn emit_line(
        &mut self,
        line: &[u8],
        counts: &mut Counts,
    ) -> Result<(), TargetDistributionError> {
        let line_bytes = u64::try_from(line.len())
            .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?;
        if line_bytes > MAX_TARGET_DISTRIBUTION_LINE_BYTES
            || self
                .byte_len
                .checked_add(line_bytes)
                .is_none_or(|len| len > MAX_TARGET_DISTRIBUTION_FILE_BYTES)
            || self
                .aggregate_base_bytes
                .checked_add(self.byte_len)
                .and_then(|bytes| bytes.checked_add(line_bytes))
                .is_none_or(|bytes| bytes > MAX_TARGET_DISTRIBUTION_AGGREGATE_BYTES)
        {
            return Err(TargetDistributionError::ResourceLimitExceeded);
        }
        counts.physical = counts
            .physical
            .checked_add(1)
            .ok_or(TargetDistributionError::ResourceLimitExceeded)?;
        if counts.physical > MAX_TARGET_DISTRIBUTION_PHYSICAL_RECORDS {
            return Err(TargetDistributionError::ResourceLimitExceeded);
        }
        (self.emit)(line)?;
        self.raw_hasher.update(line);
        self.byte_len += line_bytes;
        Ok(())
    }

    fn sha256_hex(&self) -> String {
        format!("{:x}", self.raw_hasher.clone().finalize())
    }

    fn add_input_bytes(&mut self, bytes: u64) -> Result<(), TargetDistributionError> {
        self.aggregate_base_bytes = self
            .aggregate_base_bytes
            .checked_add(bytes)
            .filter(|base| {
                base.checked_add(self.byte_len)
                    .is_some_and(|total| total <= MAX_TARGET_DISTRIBUTION_AGGREGATE_BYTES)
            })
            .ok_or(TargetDistributionError::ResourceLimitExceeded)?;
        Ok(())
    }

    fn ensure_additional_bytes(&self, bytes: u64) -> Result<(), TargetDistributionError> {
        self.aggregate_base_bytes
            .checked_add(self.byte_len)
            .and_then(|total| total.checked_add(bytes))
            .filter(|total| *total <= MAX_TARGET_DISTRIBUTION_AGGREGATE_BYTES)
            .map(|_| ())
            .ok_or(TargetDistributionError::ResourceLimitExceeded)
    }
}

pub fn build_target_distribution_stream(
    source_decision_ndjson: &[u8],
    source_dataset_manifest: &[u8],
    policy_config: &[u8],
) -> Result<BuiltTargetDistribution, TargetDistributionError> {
    let mut output = Vec::new();
    let outcome = build_target_distribution_reader_emitting(
        Cursor::new(source_decision_ndjson),
        source_dataset_manifest,
        policy_config,
        |line| {
            output.extend_from_slice(line);
            Ok(())
        },
    )?;
    Ok(BuiltTargetDistribution {
        ndjson: output,
        manifest: outcome.manifest,
    })
}

pub fn build_target_distribution_to_writer<W>(
    source_decision_ndjson: &[u8],
    source_dataset_manifest: &[u8],
    policy_config: &[u8],
    writer: &mut W,
) -> Result<TargetPolicyDistributionManifestV1, TargetDistributionError>
where
    W: Write,
{
    build_target_distribution_from_reader(
        Cursor::new(source_decision_ndjson),
        source_dataset_manifest,
        policy_config,
        writer,
    )
}

pub fn build_target_distribution_from_reader<R, W>(
    source_decision_ndjson: R,
    source_dataset_manifest: &[u8],
    policy_config: &[u8],
    writer: &mut W,
) -> Result<TargetPolicyDistributionManifestV1, TargetDistributionError>
where
    R: BufRead,
    W: Write,
{
    let mut output = Vec::new();
    build_target_distribution_reader_emitting(
        source_decision_ndjson,
        source_dataset_manifest,
        policy_config,
        |line| {
            output
                .try_reserve(line.len())
                .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?;
            output.extend_from_slice(line);
            Ok(())
        },
    )
    .and_then(|outcome| {
        writer
            .write_all(&output)
            .map_err(|_| TargetDistributionError::OutputWriteFailed)?;
        Ok(outcome.manifest)
    })
}

pub(crate) fn build_target_distribution_reader_emitting<R, F>(
    source_decision_ndjson: R,
    source_dataset_manifest: &[u8],
    policy_config: &[u8],
    emit: F,
) -> Result<BuildStreamOutcome, TargetDistributionError>
where
    R: BufRead,
    F: FnMut(&[u8]) -> Result<(), TargetDistributionError>,
{
    let aggregate_base_bytes = validate_small_inputs(source_dataset_manifest, policy_config)?;
    let source_manifest: TargetPolicyDistributionSourceDatasetManifestV1 =
        serde_json::from_slice(source_dataset_manifest)
            .map_err(|_| TargetDistributionError::InvalidManifest)?;
    source_manifest
        .validate()
        .map_err(|_| TargetDistributionError::InvalidManifest)?;
    let config: RandomizedSlateConfigV1 = serde_json::from_slice(policy_config)
        .map_err(|_| TargetDistributionError::InvalidConfig)?;
    config
        .validate()
        .map_err(|_| TargetDistributionError::InvalidConfig)?;
    if usize::try_from(config.slate_size.get()).unwrap_or(usize::MAX)
        > MAX_TARGET_DISTRIBUTION_POSITIONS
    {
        return Err(TargetDistributionError::ResourceLimitExceeded);
    }

    let mut emission = RecordEmission::new(emit, aggregate_base_bytes);
    let mut counts = Counts::default();
    let mut previous_decision_id: Option<String> = None;
    let mut source = BoundedNdjsonReader::new(source_decision_ndjson);
    let mut max_candidate_count = 0_u32;
    while let Some(line) = source.read_line(TargetDistributionError::InvalidSource)? {
        emission.add_input_bytes(
            u64::try_from(line.len() + 1)
                .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?,
        )?;
        counts.decisions = counts
            .decisions
            .checked_add(1)
            .ok_or(TargetDistributionError::ResourceLimitExceeded)?;
        if counts.decisions > MAX_TARGET_DISTRIBUTION_DECISIONS {
            return Err(TargetDistributionError::ResourceLimitExceeded);
        }
        let source_value: serde_json::Value =
            serde_json::from_slice(&line).map_err(|_| TargetDistributionError::InvalidSource)?;
        let decision = RecommendationDecisionLogV1::deserialize(&source_value)
            .map_err(|_| TargetDistributionError::InvalidSource)?;
        validate_decision(&decision, &config)?;
        max_candidate_count = max_candidate_count.max(
            u32::try_from(decision.candidate_pool.candidates.len())
                .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?,
        );
        if previous_decision_id
            .as_ref()
            .is_some_and(|previous| previous.as_bytes() >= decision.decision_id.as_bytes())
        {
            return Err(TargetDistributionError::InvalidSource);
        }
        previous_decision_id = Some(decision.decision_id.clone());
        build_decision_records(
            &source_value,
            &decision,
            &config,
            &mut emission,
            &mut counts,
        )?;
    }
    if counts.decisions == 0 {
        return Err(TargetDistributionError::InvalidSource);
    }
    if counts.decisions != source_manifest.decision_count {
        return Err(TargetDistributionError::CountMismatch);
    }
    if source.sha256_hex() != source_manifest.source_decision_ndjson_sha256 {
        return Err(TargetDistributionError::DigestMismatch);
    }

    let manifest = TargetPolicyDistributionManifestV1 {
        contract_version: TargetPolicyDistributionManifestContractVersion::V1,
        producer_version: TargetPolicyDistributionProducerVersion::V1,
        dataset_version: source_manifest.dataset_version,
        source_decision_ndjson_sha256: source.sha256_hex(),
        source_dataset_manifest_sha256: sha256_hex(source_dataset_manifest),
        policy_config_sha256: sha256_hex(
            canonical_json(&config).map_err(|_| TargetDistributionError::InvalidConfig)?,
        ),
        decision_count: counts.decisions,
        step_count: counts.steps,
        action_probability_count: counts.actions,
        physical_record_count: counts.physical,
        distribution_ndjson_sha256: emission.sha256_hex(),
        created_from_immutable_inputs: true,
        servable: false,
    };
    manifest
        .validate()
        .map_err(|_| TargetDistributionError::InvalidManifest)?;
    let manifest_bytes =
        telegram_recommendation_contracts::target_distribution_manifest_bytes(&manifest)
            .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?;
    emission.ensure_additional_bytes(
        u64::try_from(manifest_bytes.len())
            .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?,
    )?;
    Ok(BuildStreamOutcome {
        manifest,
        diagnostics: BuildStreamDiagnostics {
            max_source_line_bytes: source.max_line_bytes(),
            max_candidate_count,
        },
    })
}

fn build_decision_records<F>(
    source_value: &serde_json::Value,
    decision: &RecommendationDecisionLogV1,
    config: &RandomizedSlateConfigV1,
    emission: &mut RecordEmission<F>,
    counts: &mut Counts,
) -> Result<(), TargetDistributionError>
where
    F: FnMut(&[u8]) -> Result<(), TargetDistributionError>,
{
    let mut decision_hasher = Sha256::new();
    let start =
        TargetPolicyDistributionRecordV1::DecisionStart(TargetPolicyDistributionDecisionStartV1 {
            contract_version: TargetPolicyDistributionContractVersion::V1,
            decision_id: decision.decision_id.clone(),
            decision_fingerprint: DecisionFingerprint {
                decision_id: decision.decision_id.clone(),
                sha256: sha256_hex(
                    canonical_json(source_value)
                        .map_err(|_| TargetDistributionError::InvalidSource)?,
                ),
            },
            candidate_pool_fingerprint: CandidatePoolFingerprint {
                sha256: decision.candidate_pool.candidate_pool_sha256.clone(),
            },
            policy: config.clone(),
            baseline_order_version: BaselineOrderVersion::DecisionPoolRankThenIdentityV1,
            probability_semantics: ProbabilitySemantics::ConditionalOnPriorSlatePrefixV1,
            evidence_kind: TargetPolicyDistributionEvidenceKind::SimulatedTargetDistribution,
            servable: false,
        });
    append_pre_end_record(&start, emission, counts, &mut decision_hasher)?;

    let mut logged_actions = decision.actions.iter().collect::<Vec<_>>();
    logged_actions.sort_unstable_by_key(|action| action.action_key.served_position);
    let mut remaining = decision
        .candidate_pool
        .candidates
        .iter()
        .filter(|candidate| candidate.eligible)
        .collect::<Vec<_>>();
    let mut prefix = Vec::with_capacity(logged_actions.len().saturating_sub(1));
    let mut decision_action_count = 0_u64;

    for logged_action in logged_actions {
        remaining.sort_unstable_by(|left, right| compare_decision_pool_baseline(left, right));
        let logits = remaining
            .iter()
            .map(|candidate| {
                candidate
                    .score
                    .ok_or(TargetDistributionError::EligibleCandidateLogitMissing)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let distribution = compute_full_distribution(&logits, config.epsilon, config.temperature)
            .map_err(map_numerical_error)?;
        let served_position = logged_action.action_key.served_position;
        let step =
            TargetPolicyDistributionRecordV1::StepStart(TargetPolicyDistributionStepStartV1 {
                decision_id: decision.decision_id.clone(),
                served_position,
                prefix_action_keys: prefix.clone(),
                expected_action_count: u32::try_from(remaining.len())
                    .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?,
                plackett_luce_probability_mass: distribution.diagnostics.plackett_luce_mass,
                plackett_luce_mass_error: distribution.diagnostics.plackett_luce_mass_error,
                mixed_probability_mass: distribution.diagnostics.mixed_mass,
                mixed_mass_error: distribution.diagnostics.mixed_mass_error,
            });
        append_pre_end_record(&step, emission, counts, &mut decision_hasher)?;
        counts.steps = counts
            .steps
            .checked_add(1)
            .ok_or(TargetDistributionError::ResourceLimitExceeded)?;

        for (index, (candidate, probabilities)) in remaining
            .iter()
            .zip(distribution.probabilities.iter())
            .enumerate()
        {
            let record = TargetPolicyDistributionRecordV1::ActionProbability(
                TargetPolicyActionProbabilityV1 {
                    decision_id: decision.decision_id.clone(),
                    action_key: telegram_recommendation_contracts::DecisionActionKey {
                        candidate_namespace: candidate.candidate_namespace,
                        candidate_id: candidate.candidate_id.clone(),
                        served_position,
                    },
                    deterministic_top: index == 0,
                    plackett_luce_probability: probabilities.0,
                    conditional_selection_probability: probabilities.1,
                },
            );
            append_pre_end_record(&record, emission, counts, &mut decision_hasher)?;
            counts.actions = counts
                .actions
                .checked_add(1)
                .ok_or(TargetDistributionError::ResourceLimitExceeded)?;
            decision_action_count = decision_action_count
                .checked_add(1)
                .ok_or(TargetDistributionError::ResourceLimitExceeded)?;
        }

        let logged_index = remaining
            .iter()
            .position(|candidate| action_matches_candidate(logged_action, candidate))
            .ok_or(TargetDistributionError::LoggedActionNotEligible)?;
        remaining.remove(logged_index);
        prefix.push(logged_action.action_key.clone());
    }

    let end =
        TargetPolicyDistributionRecordV1::DecisionEnd(TargetPolicyDistributionDecisionEndV1 {
            decision_id: decision.decision_id.clone(),
            step_count: u32::try_from(prefix.len())
                .map_err(|_| TargetDistributionError::ResourceLimitExceeded)?,
            action_probability_count: decision_action_count,
            decision_records_sha256: format!("{:x}", decision_hasher.finalize()),
        });
    append_raw_record(&end, emission, counts)
}

fn append_pre_end_record<F>(
    record: &TargetPolicyDistributionRecordV1,
    emission: &mut RecordEmission<F>,
    counts: &mut Counts,
    decision_hasher: &mut Sha256,
) -> Result<(), TargetDistributionError>
where
    F: FnMut(&[u8]) -> Result<(), TargetDistributionError>,
{
    record
        .validate()
        .map_err(|_| TargetDistributionError::GrammarViolation)?;
    let line = serialize_record_line(record)?;
    let parsed: TargetPolicyDistributionRecordV1 = serde_json::from_slice(&line[..line.len() - 1])
        .map_err(|_| TargetDistributionError::GrammarViolation)?;
    decision_hasher
        .update(canonical_json(&parsed).map_err(|_| TargetDistributionError::GrammarViolation)?);
    decision_hasher.update(b"\n");
    emission.emit_line(&line, counts)
}

fn append_raw_record<F>(
    record: &TargetPolicyDistributionRecordV1,
    emission: &mut RecordEmission<F>,
    counts: &mut Counts,
) -> Result<(), TargetDistributionError>
where
    F: FnMut(&[u8]) -> Result<(), TargetDistributionError>,
{
    emission.emit_line(&serialize_record_line(record)?, counts)
}

fn serialize_record_line(
    record: &TargetPolicyDistributionRecordV1,
) -> Result<Vec<u8>, TargetDistributionError> {
    let mut line = canonical_wire_json(record)
        .map_err(|_| TargetDistributionError::GrammarViolation)?
        .into_bytes();
    line.push(b'\n');
    Ok(line)
}

fn validate_decision(
    decision: &RecommendationDecisionLogV1,
    config: &RandomizedSlateConfigV1,
) -> Result<(), TargetDistributionError> {
    decision
        .validate()
        .map_err(|_| TargetDistributionError::InvalidSource)?;
    if decision.actions.len() > MAX_TARGET_DISTRIBUTION_POSITIONS
        || decision.candidate_pool.candidates.len() > MAX_TARGET_DISTRIBUTION_CANDIDATES
    {
        return Err(TargetDistributionError::ResourceLimitExceeded);
    }
    if decision
        .decision_id
        .bytes()
        .any(|byte| byte.is_ascii_uppercase())
        || decision.actions.is_empty()
        || decision.actions.len() > usize::try_from(config.slate_size.get()).unwrap_or(usize::MAX)
    {
        return Err(TargetDistributionError::InvalidSource);
    }
    if !matches!(
        decision.candidate_pool.support_evidence,
        CandidateSupportEvidence::Complete
    ) {
        return Err(TargetDistributionError::SupportIncomplete);
    }
    if decision.candidate_pool.truncated {
        return Err(TargetDistributionError::CandidatePoolTruncated);
    }
    if usize::try_from(decision.candidate_pool.total_count).ok()
        != Some(decision.candidate_pool.candidates.len())
    {
        return Err(TargetDistributionError::CandidateCountMismatch);
    }
    if candidate_pool_sha256(&decision.candidate_pool.candidates)
        .map_err(|_| TargetDistributionError::InvalidSource)?
        != decision.candidate_pool.candidate_pool_sha256
    {
        return Err(TargetDistributionError::DigestMismatch);
    }

    let mut identities = HashSet::with_capacity(decision.candidate_pool.candidates.len());
    let mut eligible_count = 0_usize;
    for candidate in &decision.candidate_pool.candidates {
        if !identities.insert((
            candidate.candidate_namespace,
            candidate.candidate_id.as_str(),
        )) {
            return Err(TargetDistributionError::DuplicateCandidateIdentity);
        }
        if candidate.eligible {
            eligible_count += 1;
            if candidate.score.is_none_or(|score| !score.is_finite()) {
                return Err(TargetDistributionError::EligibleCandidateLogitMissing);
            }
        }
    }
    if eligible_count < decision.actions.len() {
        return Err(TargetDistributionError::LoggedActionNotEligible);
    }
    let mut actions = decision.actions.iter().collect::<Vec<_>>();
    actions.sort_unstable_by_key(|action| action.action_key.served_position);
    for (index, action) in actions.iter().enumerate() {
        if usize::try_from(action.action_key.served_position.get()).ok() != Some(index + 1) {
            return Err(TargetDistributionError::PrefixDrift);
        }
    }
    Ok(())
}

fn action_matches_candidate(
    action: &DecisionAction,
    candidate: &telegram_recommendation_contracts::DecisionCandidate,
) -> bool {
    action.action_key.candidate_namespace == candidate.candidate_namespace
        && action.action_key.candidate_id == candidate.candidate_id
}

fn validate_small_inputs(
    source_manifest: &[u8],
    config: &[u8],
) -> Result<u64, TargetDistributionError> {
    if u64::try_from(source_manifest.len()).unwrap_or(u64::MAX) > MAX_TARGET_DISTRIBUTION_LINE_BYTES
        || u64::try_from(config.len()).unwrap_or(u64::MAX) > MAX_TARGET_DISTRIBUTION_LINE_BYTES
    {
        return Err(TargetDistributionError::ResourceLimitExceeded);
    }
    u64::try_from(source_manifest.len())
        .ok()
        .and_then(|manifest| manifest.checked_add(u64::try_from(config.len()).unwrap_or(u64::MAX)))
        .filter(|bytes| *bytes <= MAX_TARGET_DISTRIBUTION_AGGREGATE_BYTES)
        .ok_or(TargetDistributionError::ResourceLimitExceeded)
}

fn map_numerical_error(error: EpsilonPlackettLuceError) -> TargetDistributionError {
    match error {
        EpsilonPlackettLuceError::InvalidEpsilon | EpsilonPlackettLuceError::InvalidTemperature => {
            TargetDistributionError::InvalidConfig
        }
        EpsilonPlackettLuceError::EmptySupport => TargetDistributionError::LoggedActionNotEligible,
        EpsilonPlackettLuceError::NonFiniteLogit => {
            TargetDistributionError::EligibleCandidateLogitMissing
        }
        EpsilonPlackettLuceError::NonFiniteArithmetic
        | EpsilonPlackettLuceError::ProbabilityUnderflow
        | EpsilonPlackettLuceError::ProbabilityMassMismatch => {
            TargetDistributionError::NumericalFailure
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use telegram_recommendation_contracts::MAX_TARGET_DISTRIBUTION_AGGREGATE_BYTES;

    use super::{Counts, RecordEmission, TargetDistributionError};

    #[test]
    fn aggregate_limit_fails_before_writer_callback() {
        let called = Cell::new(false);
        let mut emission = RecordEmission::new(
            |_| {
                called.set(true);
                Ok(())
            },
            MAX_TARGET_DISTRIBUTION_AGGREGATE_BYTES - 2,
        );
        let mut counts = Counts::default();

        assert_eq!(
            emission.emit_line(b"{}\n", &mut counts),
            Err(TargetDistributionError::ResourceLimitExceeded)
        );
        assert!(!called.get());
        assert_eq!(counts.physical, 0);
    }
}
