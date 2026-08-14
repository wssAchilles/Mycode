use std::num::NonZeroU32;

#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use serde::Serialize;
use telegram_randomized_policy_primitives::{
    DETERMINISTIC_RNG_SUITE_V1, DeterministicOpen53Rng, OPEN53_WORD_BYTES_V1,
    compute_development_rng_context_sha256_v1, compute_full_distribution,
};
use telegram_recommendation_contracts::{
    BaselineOrderVersion, BehaviorPolicyKind, CandidatePoolFingerprint, CandidateSupportEvidence,
    DEVELOPMENT_V2_MAX_OUTPUT_CANONICAL_BYTES, DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES,
    DEVELOPMENT_V2_POLICY_ARITHMETIC_VERSION, DecisionActionKey, DecisionFingerprint,
    DevelopmentCommitmentPurposeV1, DevelopmentEvidenceKindV1, DevelopmentRandomTranscriptV1,
    JointProbabilityStatusV1, NumericalDiagnostics, NumericalDiagnosticsStep,
    OrderedJointProbabilityV1, PROBABILITY_MASS_TOLERANCE, ProbabilitySemantics,
    RandomizedSlateDevelopmentActionV2, RandomizedSlateDevelopmentInputV2,
    RandomizedSlateDevelopmentReceiptContractVersionV2, RandomizedSlateDevelopmentReceiptV2,
    SupportDiagnostics, candidate_namespace_wire_tag, canonical_json,
    compare_decision_pool_baseline, compute_development_transcript_sha256_v2, decode_hex_32,
    derive_development_resource_receipt_v1, hex_32, policy_config_sha256_v1, sha256_hex,
};

#[cfg(test)]
static RNG_CONSTRUCTION_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DevelopmentV2Blocker {
    ResourceLimitExceeded,
    ContractInvalid,
    SourceInvalid,
    CommitmentInvalid,
    ArithmeticInvalid,
    RandomnessUnavailable,
    OutputInvalid,
}

pub(super) fn simulate_development_v2(
    raw_input: &[u8],
) -> Result<RandomizedSlateDevelopmentReceiptV2, DevelopmentV2Blocker> {
    if raw_input.len() > DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES {
        return Err(DevelopmentV2Blocker::ResourceLimitExceeded);
    }
    let input: RandomizedSlateDevelopmentInputV2 =
        serde_json::from_slice(raw_input).map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    let source = input
        .validate()
        .map_err(|_| DevelopmentV2Blocker::CommitmentInvalid)?;
    source
        .validate()
        .map_err(|_| DevelopmentV2Blocker::SourceInvalid)?;
    if source.behavior_policy_kind != BehaviorPolicyKind::DeterministicTopK
        || !matches!(
            source.candidate_pool.support_evidence,
            CandidateSupportEvidence::Complete
        )
        || source.candidate_pool.truncated
        || usize::try_from(source.candidate_pool.total_count).ok()
            != Some(source.candidate_pool.candidates.len())
    {
        return Err(DevelopmentV2Blocker::SourceInvalid);
    }

    let candidates = &source.candidate_pool.candidates;
    let candidate_count = candidates.len();
    let eligible_count = candidates
        .iter()
        .filter(|candidate| candidate.eligible)
        .count();
    let slate_size = usize::try_from(input.config.slate_size.get())
        .map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?;
    if candidates
        .iter()
        .filter(|candidate| candidate.eligible)
        .any(|candidate| candidate.score.is_none_or(|score| !score.is_finite()))
    {
        return Err(DevelopmentV2Blocker::ResourceLimitExceeded);
    }

    let source_canonical = canonical_json(&input.source_decision_log)
        .map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    let config_value =
        serde_json::to_value(&input.config).map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    let config_canonical =
        canonical_json(&config_value).map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    let mut resource_receipt = derive_development_resource_receipt_v1(
        raw_input.len(),
        source_canonical.len(),
        config_canonical.len(),
        &input,
        &source,
    )
    .map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?;

    let mut remaining = candidates
        .iter()
        .filter(|candidate| candidate.eligible)
        .collect::<Vec<_>>();
    remaining.sort_unstable_by(|left, right| compare_decision_pool_baseline(left, right));
    let seed = input
        .revealed_seed()
        .map_err(|_| DevelopmentV2Blocker::CommitmentInvalid)?;
    let source_sha = decode_hex_32("sourceDecisionLogSha256", &input.source_decision_log_sha256)
        .map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    let pool_sha = decode_hex_32(
        "candidatePoolSha256",
        &source.candidate_pool.candidate_pool_sha256,
    )
    .map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    let policy_config_sha256 = policy_config_sha256_v1(&input.config)
        .map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    let config_sha = decode_hex_32("policyConfigSha256", &policy_config_sha256)
        .map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    let rng_context = compute_development_rng_context_sha256_v1(
        input.epoch_id.as_bytes(),
        source.decision_id.as_bytes(),
        &source_sha,
        &pool_sha,
        &config_sha,
    )
    .map_err(|_| DevelopmentV2Blocker::ContractInvalid)?;
    #[cfg(test)]
    RNG_CONSTRUCTION_COUNT.fetch_add(1, AtomicOrdering::SeqCst);
    let mut rng = DeterministicOpen53Rng::from_seed_and_context(
        &seed,
        input.epoch_id.as_bytes(),
        source.decision_id.as_bytes(),
        &source_sha,
        &pool_sha,
        &config_sha,
    )
    .map_err(|_| DevelopmentV2Blocker::RandomnessUnavailable)?;

    let mut prefix = Vec::<DecisionActionKey>::with_capacity(slate_size);
    let mut ordered_actions = Vec::with_capacity(slate_size);
    let mut numerical_steps = Vec::with_capacity(slate_size);
    let mut max_probability_mass_error = 0.0_f64;
    let mut joint_probability = 1.0_f64;
    let mut joint_log_probability = 0.0_f64;
    let mut actual_rng_words = 0_u64;

    for index in 0..slate_size {
        let position = NonZeroU32::new(
            u32::try_from(index + 1).map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?,
        )
        .expect("one-based development position is non-zero");
        let prefix_sha256 = digest_serializable(&prefix)?;
        let remaining_support_sha256 = digest_serializable(&remaining)?;
        let logits = remaining
            .iter()
            .map(|candidate| candidate.score.ok_or(DevelopmentV2Blocker::SourceInvalid))
            .collect::<Result<Vec<_>, _>>()?;
        let distribution =
            compute_full_distribution(&logits, input.config.epsilon, input.config.temperature)
                .map_err(|_| DevelopmentV2Blocker::ArithmeticInvalid)?;
        let probability_mass_error = distribution
            .diagnostics
            .plackett_luce_mass_error
            .max(distribution.diagnostics.mixed_mass_error);
        if probability_mass_error > PROBABILITY_MASS_TOLERANCE {
            return Err(DevelopmentV2Blocker::ArithmeticInvalid);
        }
        max_probability_mass_error = max_probability_mass_error.max(probability_mass_error);

        let draw = rng
            .next_open53()
            .map_err(|_| DevelopmentV2Blocker::RandomnessUnavailable)?;
        actual_rng_words = actual_rng_words
            .checked_add(
                u64::try_from(draw.raw_words.len())
                    .map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?,
            )
            .ok_or(DevelopmentV2Blocker::ResourceLimitExceeded)?;

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
            selected.ok_or(DevelopmentV2Blocker::ArithmeticInvalid)?;
        let selected_candidate = remaining[selected_index];
        let selected_probability = distribution.probabilities[selected_index];
        let conditional_log_probability = selected_probability.1.ln();
        if !conditional_log_probability.is_finite() {
            return Err(DevelopmentV2Blocker::ArithmeticInvalid);
        }
        joint_probability *= selected_probability.1;
        joint_log_probability += conditional_log_probability;
        let action_key = DecisionActionKey {
            candidate_namespace: selected_candidate.candidate_namespace,
            candidate_id: selected_candidate.candidate_id.clone(),
            served_position: position,
        };
        let deterministic_top = remaining[0];
        ordered_actions.push(RandomizedSlateDevelopmentActionV2 {
            action_key: action_key.clone(),
            deterministic_top_action_key: DecisionActionKey {
                candidate_namespace: deterministic_top.candidate_namespace,
                candidate_id: deterministic_top.candidate_id.clone(),
                served_position: position,
            },
            selected_was_deterministic_top: selected_index == 0,
            prefix_sha256,
            remaining_support_sha256,
            remaining_candidate_count: u32::try_from(remaining.len())
                .map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?,
            distribution_sha256: digest_serializable(&distribution_rows)?,
            plackett_luce_probability: selected_probability.0,
            conditional_selection_probability: selected_probability.1,
            conditional_log_probability,
            selected_interval_lower_inclusive: selected_lower,
            selected_interval_upper_exclusive: selected_upper,
            random_transcript: DevelopmentRandomTranscriptV1 {
                start_byte_offset: draw.start_byte_offset,
                raw_words_hex: draw
                    .raw_words
                    .iter()
                    .map(|word| format!("{word:016x}"))
                    .collect(),
                accepted_unsigned_53: draw.accepted_unsigned_53.to_string(),
                uniform_draw: draw.uniform_draw,
            },
        });
        numerical_steps.push(NumericalDiagnosticsStep {
            served_position: position,
            remaining_candidate_count: u32::try_from(remaining.len())
                .map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?,
            plackett_luce_probability_mass: distribution.diagnostics.plackett_luce_mass,
            mixed_probability_mass: distribution.diagnostics.mixed_mass,
            probability_mass_error,
        });
        prefix.push(action_key);
        remaining.remove(selected_index);
    }

    resource_receipt.actual_rng_words = actual_rng_words;
    resource_receipt.actual_rng_bytes = actual_rng_words
        .checked_mul(
            u64::try_from(OPEN53_WORD_BYTES_V1)
                .map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?,
        )
        .ok_or(DevelopmentV2Blocker::ResourceLimitExceeded)?;
    let (joint_status, joint_value) = if joint_probability > 0.0 {
        (
            JointProbabilityStatusV1::FinitePositive,
            Some(joint_probability),
        )
    } else {
        (JointProbabilityStatusV1::UnderflowLogOnly, None)
    };
    let source_candidate_count =
        u32::try_from(candidate_count).map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?;
    let eligible_candidate_count =
        u32::try_from(eligible_count).map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?;
    let mut receipt = RandomizedSlateDevelopmentReceiptV2 {
        contract_version: RandomizedSlateDevelopmentReceiptContractVersionV2::V2,
        status: "simulated".to_string(),
        policy: input.config.clone(),
        policy_config_sha256,
        policy_arithmetic_version: DEVELOPMENT_V2_POLICY_ARITHMETIC_VERSION.to_string(),
        baseline_order_version: BaselineOrderVersion::DecisionPoolRankThenIdentityV1,
        probability_semantics: ProbabilitySemantics::ConditionalOnPriorSlatePrefixV1,
        rng_protocol: DETERMINISTIC_RNG_SUITE_V1.to_string(),
        commitment_purpose: DevelopmentCommitmentPurposeV1::DevelopmentRevealConsistencyOnlyV1,
        epoch_id: input.epoch_id.clone(),
        revealed_development_seed_hex: input.revealed_development_seed_hex.clone(),
        seed_commitment_sha256: input.seed_commitment_sha256.clone(),
        rng_context_sha256: hex_32(&rng_context),
        decision_fingerprint: DecisionFingerprint {
            decision_id: source.decision_id,
            sha256: input.source_decision_log_sha256.clone(),
        },
        candidate_pool_fingerprint: CandidatePoolFingerprint {
            sha256: source.candidate_pool.candidate_pool_sha256,
        },
        ordered_actions,
        ordered_joint_probability: OrderedJointProbabilityV1 {
            status: joint_status,
            log_joint_conditional_selection_probability: joint_log_probability,
            joint_conditional_selection_probability: joint_value,
        },
        support_diagnostics: SupportDiagnostics {
            source_candidate_count,
            eligible_candidate_count,
            excluded_ineligible_candidate_count: source_candidate_count - eligible_candidate_count,
            sampled_count: input.config.slate_size.get(),
            without_replacement: true,
        },
        numerical_diagnostics: NumericalDiagnostics {
            probability_mass_tolerance: PROBABILITY_MASS_TOLERANCE,
            max_probability_mass_error,
            steps: numerical_steps,
        },
        resource_receipt,
        evidence_kind: DevelopmentEvidenceKindV1::SimulatedPropensity,
        servable: false,
        real_dataset_eligible: false,
        transcript_sha256: "0".repeat(64),
    };
    finalize_receipt(&mut receipt)?;
    receipt
        .validate_against_raw(raw_input)
        .map_err(|_| DevelopmentV2Blocker::OutputInvalid)?;
    Ok(receipt)
}

fn finalize_receipt(
    receipt: &mut RandomizedSlateDevelopmentReceiptV2,
) -> Result<(), DevelopmentV2Blocker> {
    for _ in 0..4 {
        receipt.transcript_sha256 = compute_development_transcript_sha256_v2(receipt)
            .map_err(|_| DevelopmentV2Blocker::OutputInvalid)?;
        let value =
            serde_json::to_value(&*receipt).map_err(|_| DevelopmentV2Blocker::OutputInvalid)?;
        let length = canonical_json(&value)
            .map_err(|_| DevelopmentV2Blocker::OutputInvalid)?
            .len();
        let length =
            u64::try_from(length).map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?;
        if length
            > u64::try_from(DEVELOPMENT_V2_MAX_OUTPUT_CANONICAL_BYTES)
                .map_err(|_| DevelopmentV2Blocker::ResourceLimitExceeded)?
            || length
                > receipt
                    .resource_receipt
                    .planned_output_canonical_bytes_upper_bound
        {
            return Err(DevelopmentV2Blocker::ResourceLimitExceeded);
        }
        if receipt.resource_receipt.actual_output_canonical_bytes == length {
            return Ok(());
        }
        receipt.resource_receipt.actual_output_canonical_bytes = length;
    }
    Err(DevelopmentV2Blocker::OutputInvalid)
}

fn digest_serializable<T: Serialize>(value: &T) -> Result<String, DevelopmentV2Blocker> {
    let value = serde_json::to_value(value).map_err(|_| DevelopmentV2Blocker::OutputInvalid)?;
    let canonical = canonical_json(&value).map_err(|_| DevelopmentV2Blocker::OutputInvalid)?;
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

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_json::Value;
    use std::sync::Mutex;
    use telegram_randomized_policy_primitives::compute_development_seed_commitment_sha256_v1;
    use telegram_recommendation_contracts::{
        DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES, DecisionCandidate,
        RandomizedSlateDevelopmentInputContractVersionV2, RandomizedSlateDevelopmentInputV2,
        RandomizedSlateDevelopmentReceiptV2, RandomizedSlateSimulationInputV1,
        candidate_pool_sha256, canonical_json, canonical_wire_json, decode_hex_32, hex_32,
        sha256_hex,
    };

    use super::{
        AtomicOrdering, DevelopmentV2Blocker, RNG_CONSTRUCTION_COUNT, finalize_receipt,
        simulate_development_v2,
    };

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SourceFixture {
        input: RandomizedSlateSimulationInputV1,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct DevelopmentFixture {
        fixture_version: String,
        source_fixture_path: String,
        source_fixture_sha256: String,
        input_sha256: String,
        epoch_id: String,
        revealed_development_seed_hex: String,
        seed_commitment_sha256: String,
        expected: RandomizedSlateDevelopmentReceiptV2,
    }

    fn development_fixture() -> DevelopmentFixture {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../telegram-recommendation-fixtures/fixtures/randomized_slate_development_v2.json"
        )))
        .unwrap()
    }

    fn raw_input() -> Vec<u8> {
        let fixture = development_fixture();
        assert_eq!(
            fixture.fixture_version,
            "randomized_slate_development_fixture_v2"
        );
        assert_eq!(
            fixture.source_fixture_path,
            "randomized_slate_simulation_v1.json"
        );
        let source_raw = include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../telegram-recommendation-fixtures/fixtures/randomized_slate_simulation_v1.json"
        ));
        assert_eq!(sha256_hex(source_raw), fixture.source_fixture_sha256);
        let source_fixture: SourceFixture = serde_json::from_slice(source_raw).unwrap();
        let seed = decode_hex_32(
            "revealedDevelopmentSeedHex",
            &fixture.revealed_development_seed_hex,
        )
        .unwrap();
        let commitment =
            compute_development_seed_commitment_sha256_v1(fixture.epoch_id.as_bytes(), &seed)
                .unwrap();
        assert_eq!(hex_32(&commitment), fixture.seed_commitment_sha256);
        let input = RandomizedSlateDevelopmentInputV2 {
            contract_version: RandomizedSlateDevelopmentInputContractVersionV2::V2,
            source_decision_log: source_fixture.input.source_decision_log,
            source_decision_log_sha256: source_fixture.input.source_decision_log_sha256,
            config: source_fixture.input.config,
            epoch_id: fixture.epoch_id,
            revealed_development_seed_hex: fixture.revealed_development_seed_hex,
            seed_commitment_sha256: hex_32(&commitment),
        };
        let raw = canonical_wire_json(&serde_json::to_value(input).unwrap())
            .unwrap()
            .into_bytes();
        assert_eq!(sha256_hex(&raw), fixture.input_sha256);
        raw
    }

    #[test]
    fn development_receipt_is_replayable_and_resource_bound() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let raw = raw_input();
        let first = simulate_development_v2(&raw).unwrap();
        let second = simulate_development_v2(&raw).unwrap();

        assert_eq!(first, second);
        assert_eq!(first.ordered_actions.len(), 3);
        assert_eq!(first.resource_receipt.distribution_entry_evaluations, 6);
        assert_eq!(first.resource_receipt.candidate_work_units, 24);
        assert_eq!(first.resource_receipt.baseline_sort_passes, 1);
        assert!(!first.servable);
        assert!(!first.real_dataset_eligible);
        let fixture = development_fixture();
        let expected = fixture.expected;
        assert_eq!(first, expected);
        expected.validate_against_raw(&raw).unwrap();
    }

    #[test]
    fn raw_resource_rejection_happens_before_rng_construction() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        RNG_CONSTRUCTION_COUNT.store(0, AtomicOrdering::SeqCst);
        let oversized =
            vec![b' '; telegram_recommendation_contracts::DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES + 1];

        assert_eq!(
            simulate_development_v2(&oversized),
            Err(DevelopmentV2Blocker::ResourceLimitExceeded)
        );
        assert_eq!(RNG_CONSTRUCTION_COUNT.load(AtomicOrdering::SeqCst), 0);
    }

    #[test]
    fn commitment_drift_is_rejected() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut value: Value = serde_json::from_slice(&raw_input()).unwrap();
        value["seedCommitmentSha256"] = Value::String("0".repeat(64));

        assert_eq!(
            simulate_development_v2(&serde_json::to_vec(&value).unwrap()),
            Err(DevelopmentV2Blocker::CommitmentInvalid)
        );
    }

    #[test]
    fn receipt_replay_rejects_resigned_rng_distribution_and_resource_drift() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let raw = raw_input();
        let receipt = simulate_development_v2(&raw).unwrap();

        let mut distribution_drift = receipt.clone();
        distribution_drift.ordered_actions[0].distribution_sha256 = "f".repeat(64);
        finalize_receipt(&mut distribution_drift).unwrap();
        assert!(distribution_drift.validate_against_raw(&raw).is_err());

        let mut rng_drift = receipt.clone();
        let word = u64::from_str_radix(
            &rng_drift.ordered_actions[0].random_transcript.raw_words_hex[0],
            16,
        )
        .unwrap()
            + 1;
        let accepted = word & ((1_u64 << 53) - 1);
        rng_drift.ordered_actions[0].random_transcript.raw_words_hex[0] = format!("{word:016x}");
        rng_drift.ordered_actions[0]
            .random_transcript
            .accepted_unsigned_53 = accepted.to_string();
        rng_drift.ordered_actions[0].random_transcript.uniform_draw =
            accepted as f64 / 9_007_199_254_740_992.0;
        finalize_receipt(&mut rng_drift).unwrap();
        assert!(rng_drift.validate_against_raw(&raw).is_err());

        let mut resource_drift = receipt.clone();
        resource_drift.resource_receipt.raw_input_bytes += 1;
        finalize_receipt(&mut resource_drift).unwrap();
        assert!(resource_drift.validate_against_raw(&raw).is_err());
    }

    #[test]
    fn hostile_support_counts_fail_closed_without_panicking() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let raw = raw_input();
        let mut receipt = simulate_development_v2(&raw).unwrap();
        receipt.support_diagnostics.eligible_candidate_count = 0;

        let result = std::panic::catch_unwind(|| receipt.validate_against_raw(&raw));
        assert!(result.is_ok());
        assert!(result.unwrap().is_err());
    }

    #[test]
    fn output_resource_rejection_happens_before_rng_construction() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut value: Value = serde_json::from_slice(&raw_input()).unwrap();
        value["sourceDecisionLog"]["candidatePool"]["candidates"][1]["candidateId"] =
            Value::String("x".repeat(16 * 1024 * 1024));
        let candidates: Vec<DecisionCandidate> = serde_json::from_value(
            value["sourceDecisionLog"]["candidatePool"]["candidates"].clone(),
        )
        .unwrap();
        value["sourceDecisionLog"]["candidatePool"]["candidatePoolSha256"] =
            Value::String(candidate_pool_sha256(&candidates).unwrap());
        value["sourceDecisionLogSha256"] = Value::String(sha256_hex(
            canonical_json(&value["sourceDecisionLog"]).unwrap(),
        ));
        let oversized_output_input = canonical_wire_json(&value).unwrap().into_bytes();
        assert!(oversized_output_input.len() < DEVELOPMENT_V2_MAX_RAW_INPUT_BYTES);

        RNG_CONSTRUCTION_COUNT.store(0, AtomicOrdering::SeqCst);
        assert_eq!(
            simulate_development_v2(&oversized_output_input),
            Err(DevelopmentV2Blocker::ResourceLimitExceeded)
        );
        assert_eq!(RNG_CONSTRUCTION_COUNT.load(AtomicOrdering::SeqCst), 0);
    }
}
