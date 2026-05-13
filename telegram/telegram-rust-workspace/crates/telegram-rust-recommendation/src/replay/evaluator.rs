use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde_json::Value;
use telegram_recommendation_fixtures::replay_assertions::{
    score_range_violations, stage_detail_violations,
};

use crate::contracts::{RecommendationCandidatePayload, RecommendationStagePayload};
use crate::pipeline::local::filters::run_pre_score_filters;
use crate::pipeline::local::scorers::{local_ranking_ladder_specs, run_local_scorers};
use crate::selectors::top_k::{
    SelectorStageInput, build_selector_stage, select_candidates_with_report,
};

use super::contracts::{
    REPLAY_FIXTURE_VERSION, RecommendationReplayFixturePayload,
    RecommendationReplayScenarioPayload, ReplayEvaluationResultPayload,
};
use super::stage_contracts::replay_stage_contract_violations;

pub type ReplayEvaluationResult = ReplayEvaluationResultPayload;

pub fn evaluate_replay_fixture(
    fixture: &RecommendationReplayFixturePayload,
) -> Result<Vec<ReplayEvaluationResult>, String> {
    if fixture.replay_version != REPLAY_FIXTURE_VERSION {
        return Err(format!(
            "replay_fixture_version_mismatch: expected {} got {}",
            REPLAY_FIXTURE_VERSION, fixture.replay_version
        ));
    }

    Ok(fixture.scenarios.iter().map(evaluate_scenario).collect())
}

pub fn evaluate_scenario(scenario: &RecommendationReplayScenarioPayload) -> ReplayEvaluationResult {
    let scenario = normalize_replay_clock(scenario);
    let pre_filter = run_pre_score_filters(&scenario.query, scenario.candidates.clone());
    let kept_post_ids = pre_filter
        .candidates
        .iter()
        .map(|candidate| candidate.post_id.as_str())
        .collect::<HashSet<_>>();
    let filtered_post_ids = scenario
        .candidates
        .iter()
        .filter(|candidate| !kept_post_ids.contains(candidate.post_id.as_str()))
        .map(|candidate| candidate.post_id.clone())
        .collect::<Vec<_>>();

    let scoring = run_local_scorers(&scenario.query, pre_filter.candidates);
    let mut stage_names = pre_filter
        .stages
        .iter()
        .chain(scoring.stages.iter())
        .map(|stage| stage.name.clone())
        .collect::<Vec<_>>();
    let mut stage_details =
        stage_detail_index(pre_filter.stages.iter().chain(scoring.stages.iter()));
    let oversample_factor = scenario.expected.oversample_factor.unwrap_or(1);
    let max_selector_size = scenario.expected.max_selector_size.unwrap_or(200);
    let author_soft_cap = scenario.expected.author_soft_cap.unwrap_or(2);
    let selector_output = select_candidates_with_report(
        &scenario.query,
        &scoring.candidates,
        oversample_factor,
        max_selector_size,
        author_soft_cap,
    );
    let selector_stage = build_selector_stage(SelectorStageInput {
        duration_ms: 0,
        input_count: scoring.candidates.len(),
        selected: &selector_output.candidates,
        report: &selector_output.report,
        oversample_factor,
        max_selector_size,
        author_soft_cap,
    });
    if let Some(detail) = selector_stage.detail {
        stage_details.insert(selector_stage.name.clone(), detail);
    }
    stage_names.push(selector_stage.name);
    let selected = selector_output.candidates;
    let selected_post_ids = selected
        .iter()
        .map(|candidate| candidate.post_id.clone())
        .collect::<Vec<_>>();
    let selected_source_counts = source_counts(&selected);
    let selected_lane_counts = lane_counts(&selected);
    let selector_deferred_reason_counts = selector_output.report.deferred_reason_counts.clone();
    let selected_id_set = selected_post_ids.iter().collect::<HashSet<_>>();
    let filtered_id_set = filtered_post_ids.iter().collect::<HashSet<_>>();
    let stage_name_set = stage_names.iter().collect::<HashSet<_>>();
    let scored_candidate_by_id = scoring
        .candidates
        .iter()
        .map(|candidate| (candidate.post_id.as_str(), candidate))
        .collect::<HashMap<_, _>>();
    let mut violations = Vec::new();

    if !scenario.expected.stage_order.is_empty()
        && stage_names.as_slice() != scenario.expected.stage_order.as_slice()
    {
        violations.push(format!(
            "stage_order_mismatch: expected {:?} got {:?}",
            scenario.expected.stage_order, stage_names
        ));
    }

    for stage_name in &scenario.expected.must_have_stages {
        if !stage_name_set.contains(stage_name) {
            violations.push(format!("must_have_stage_missing: {stage_name}"));
        }
    }

    for stage_name in &scenario.expected.must_not_have_stages {
        if stage_name_set.contains(stage_name) {
            violations.push(format!("must_not_have_stage_present: {stage_name}"));
        }
    }

    if let Some(top_post_id) = scenario.expected.top_post_id.as_deref()
        && selected_post_ids.first().map(String::as_str) != Some(top_post_id)
    {
        violations.push(format!(
            "top_post_id_mismatch: expected {} got {:?}",
            top_post_id,
            selected_post_ids.first()
        ));
    }

    if !scenario.expected.selected_post_ids.is_empty()
        && selected_post_ids != scenario.expected.selected_post_ids
    {
        violations.push(format!(
            "selected_post_ids_mismatch: expected {:?} got {:?}",
            scenario.expected.selected_post_ids, selected_post_ids
        ));
    }

    if let Some(min_selected_count) = scenario.expected.min_selected_count
        && selected_post_ids.len() < min_selected_count
    {
        violations.push(format!(
            "min_selected_count_mismatch: expected_at_least={} got={}",
            min_selected_count,
            selected_post_ids.len()
        ));
    }

    if let Some(max_selected_count) = scenario.expected.max_selected_count
        && selected_post_ids.len() > max_selected_count
    {
        violations.push(format!(
            "max_selected_count_mismatch: expected_at_most={} got={}",
            max_selected_count,
            selected_post_ids.len()
        ));
    }

    for post_id in &scenario.expected.must_select_post_ids {
        if !selected_id_set.contains(post_id) {
            violations.push(format!("must_select_missing: {post_id}"));
        }
    }

    for post_id in &scenario.expected.must_not_select_post_ids {
        if selected_id_set.contains(post_id) {
            violations.push(format!("must_not_select_present: {post_id}"));
        }
    }

    for post_id in &scenario.expected.must_filter_post_ids {
        if !filtered_id_set.contains(post_id) {
            violations.push(format!("must_filter_missing: {post_id}"));
        }
    }

    for post_id in &scenario.expected.must_not_filter_post_ids {
        if filtered_id_set.contains(post_id) {
            violations.push(format!("must_not_filter_present: {post_id}"));
        }
    }

    let selected_position = selected_post_ids
        .iter()
        .enumerate()
        .map(|(index, post_id)| (post_id.as_str(), index))
        .collect::<HashMap<_, _>>();
    for assertion in &scenario.expected.must_rank_before {
        let before_position = selected_position.get(assertion.before_post_id.as_str());
        let after_position = selected_position.get(assertion.after_post_id.as_str());
        match (before_position, after_position) {
            (None, _) => violations.push(format!(
                "must_rank_before_missing_before: before={} after={}",
                assertion.before_post_id, assertion.after_post_id
            )),
            (Some(before), Some(after)) if before >= after => violations.push(format!(
                "must_rank_before_order_mismatch: before={} after={}",
                assertion.before_post_id, assertion.after_post_id
            )),
            _ => {}
        }
    }

    for assertion in &scenario.expected.score_ranges {
        let Some(candidate) = scored_candidate_by_id.get(assertion.post_id.as_str()) else {
            violations.push(format!(
                "score_range_missing_candidate: {}",
                assertion.post_id
            ));
            continue;
        };
        violations.extend(score_range_violations(
            "score",
            &assertion.post_id,
            candidate.score,
            assertion.min_score,
            assertion.max_score,
        ));
        violations.extend(score_range_violations(
            "weighted_score",
            &assertion.post_id,
            candidate.weighted_score,
            assertion.min_weighted_score,
            assertion.max_weighted_score,
        ));
    }

    for assertion in &scenario.expected.candidate_breakdown_ranges {
        let Some(candidate) = scored_candidate_by_id.get(assertion.post_id.as_str()) else {
            violations.push(format!(
                "candidate_breakdown_missing_candidate: {}",
                assertion.post_id
            ));
            continue;
        };
        let actual = candidate
            .score_breakdown
            .as_ref()
            .and_then(|breakdown| breakdown.get(assertion.key.as_str()))
            .copied();
        violations.extend(score_range_violations(
            assertion.key.as_str(),
            &assertion.post_id,
            actual,
            assertion.min_value,
            assertion.max_value,
        ));
    }

    for (stage_name, expected_kind) in &scenario.expected.ranking_stage_kinds {
        let actual_kind = stage_details
            .get(stage_name.as_str())
            .and_then(|detail| detail.get("rankingStageKind"))
            .and_then(Value::as_str);
        if actual_kind != Some(expected_kind.as_str()) {
            violations.push(format!(
                "ranking_stage_kind_mismatch: stage={} expected={} got={:?}",
                stage_name, expected_kind, actual_kind
            ));
        }
    }

    for (filter_name, expected_count) in &scenario.expected.filter_drop_counts {
        let actual_count = pre_filter
            .drop_counts
            .get(filter_name)
            .copied()
            .unwrap_or_default();
        if actual_count != *expected_count {
            violations.push(format!(
                "filter_drop_count_mismatch: filter={} expected={} got={}",
                filter_name, expected_count, actual_count
            ));
        }
    }

    for (source, expected_count) in &scenario.expected.selected_source_counts {
        let actual_count = selected_source_counts
            .get(source)
            .copied()
            .unwrap_or_default();
        if actual_count != *expected_count {
            violations.push(format!(
                "selected_source_count_mismatch: source={} expected={} got={}",
                source, expected_count, actual_count
            ));
        }
    }

    for (lane, expected_count) in &scenario.expected.selected_lane_counts {
        let actual_count = selected_lane_counts.get(lane).copied().unwrap_or_default();
        if actual_count != *expected_count {
            violations.push(format!(
                "selected_lane_count_mismatch: lane={} expected={} got={}",
                lane, expected_count, actual_count
            ));
        }
    }

    for (source, min_count) in &scenario.expected.min_selected_source_counts {
        let actual_count = selected_source_counts
            .get(source)
            .copied()
            .unwrap_or_default();
        if actual_count < *min_count {
            violations.push(format!(
                "min_selected_source_count_mismatch: source={} expected_at_least={} got={}",
                source, min_count, actual_count
            ));
        }
    }

    for (source, max_count) in &scenario.expected.max_selected_source_counts {
        let actual_count = selected_source_counts
            .get(source)
            .copied()
            .unwrap_or_default();
        if actual_count > *max_count {
            violations.push(format!(
                "max_selected_source_count_mismatch: source={} expected_at_most={} got={}",
                source, max_count, actual_count
            ));
        }
    }

    for (reason, expected_count) in &scenario.expected.selector_deferred_reason_counts {
        let actual_count = selector_deferred_reason_counts
            .get(reason)
            .copied()
            .unwrap_or_default();
        if actual_count != *expected_count {
            violations.push(format!(
                "selector_deferred_reason_count_mismatch: reason={} expected={} got={}",
                reason, expected_count, actual_count
            ));
        }
    }

    if let Some(max_repeated_author) = scenario.expected.max_repeated_author {
        let mut author_counts = HashMap::<String, usize>::new();
        for candidate in &selected {
            *author_counts
                .entry(candidate.author_id.clone())
                .or_insert(0) += 1;
        }
        for (author_id, count) in author_counts {
            if count > max_repeated_author {
                violations.push(format!(
                    "max_repeated_author_exceeded: author={} count={} max={}",
                    author_id, count, max_repeated_author
                ));
            }
        }
    }

    if let Some(max_selected_per_external_id) = scenario.expected.max_selected_per_external_id {
        let mut external_id_counts = HashMap::<String, usize>::new();
        for candidate in &selected {
            if let Some(external_id) = candidate.canonical_external_id() {
                *external_id_counts.entry(external_id).or_insert(0) += 1;
            }
        }
        for (external_id, count) in external_id_counts {
            if count > max_selected_per_external_id {
                violations.push(format!(
                    "max_selected_per_external_id_exceeded: external_id={} count={} max={}",
                    external_id, count, max_selected_per_external_id
                ));
            }
        }
    }

    for assertion in &scenario.expected.stage_details {
        violations.extend(stage_detail_violations(
            &assertion.stage_name,
            stage_details.get(assertion.stage_name.as_str()),
            &assertion.expected,
        ));
    }
    let ranking_specs = local_ranking_ladder_specs();
    violations.extend(replay_stage_contract_violations(
        &ranking_specs,
        &stage_details,
    ));

    ReplayEvaluationResult {
        scenario_name: scenario.name.clone(),
        stage_names,
        filter_drop_counts: pre_filter.drop_counts,
        filtered_post_ids,
        selected_lane_counts,
        selected_source_counts,
        selector_deferred_reason_counts,
        selected_post_ids,
        violations,
    }
}

fn normalize_replay_clock(
    scenario: &RecommendationReplayScenarioPayload,
) -> RecommendationReplayScenarioPayload {
    let Some(max_created_at) = scenario
        .candidates
        .iter()
        .map(|candidate| candidate.created_at)
        .max()
    else {
        return scenario.clone();
    };

    let target_anchor = Utc::now() - Duration::hours(48);
    let delta = target_anchor.signed_duration_since(max_created_at);
    let mut normalized = scenario.clone();
    for candidate in &mut normalized.candidates {
        candidate.created_at += delta;
    }
    shift_query_timestamps(&mut normalized.query, delta);
    normalized
}

fn shift_query_timestamps(
    query: &mut crate::contracts::RecommendationQueryPayload,
    delta: Duration,
) {
    if let Some(cursor) = &mut query.cursor {
        *cursor += delta;
    }
    if let Some(features) = &mut query.user_features
        && let Some(account_created_at) = &mut features.account_created_at
    {
        *account_created_at += delta;
    }
    if let Some(embedding_context) = &mut query.embedding_context
        && let Some(computed_at) = &mut embedding_context.computed_at
    {
        *computed_at += delta;
    }
    if let Some(actions) = &mut query.user_action_sequence {
        shift_action_timestamps(actions, delta);
    }
    if let Some(actions) = &mut query.model_user_action_sequence {
        shift_action_timestamps(actions, delta);
    }
}

fn shift_action_timestamps(actions: &mut [HashMap<String, Value>], delta: Duration) {
    for action in actions {
        for key in ["timestamp", "createdAt", "created_at"] {
            let Some(Value::String(timestamp)) = action.get_mut(key) else {
                continue;
            };
            let Ok(parsed) = DateTime::parse_from_rfc3339(timestamp) else {
                continue;
            };
            *timestamp =
                (parsed.with_timezone(&Utc) + delta).to_rfc3339_opts(SecondsFormat::Millis, true);
        }
    }
}

fn stage_detail_index<'a>(
    stages: impl Iterator<Item = &'a RecommendationStagePayload>,
) -> HashMap<String, HashMap<String, Value>> {
    stages
        .filter_map(|stage| {
            stage
                .detail
                .as_ref()
                .map(|detail| (stage.name.clone(), detail.clone()))
        })
        .collect()
}

fn source_counts(candidates: &[RecommendationCandidatePayload]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for candidate in candidates {
        let source = candidate
            .recall_source
            .as_deref()
            .or(candidate.retrieval_lane.as_deref())
            .unwrap_or("unknown")
            .to_string();
        *counts.entry(source).or_insert(0) += 1;
    }
    counts
}

fn lane_counts(candidates: &[RecommendationCandidatePayload]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for candidate in candidates {
        let lane = candidate
            .retrieval_lane
            .as_deref()
            .or(candidate.selection_pool.as_deref())
            .unwrap_or("unknown")
            .to_string();
        *counts.entry(lane).or_insert(0) += 1;
    }
    counts
}
