use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::contracts::RecommendationCandidatePayload;
use crate::pipeline::local::filters::run_pre_score_filters;
use crate::pipeline::local::scorers::run_local_scorers;
use crate::selectors::top_k::select_candidates;

use super::contracts::{
    REPLAY_FIXTURE_VERSION, RecommendationReplayFixturePayload, RecommendationReplayScenarioPayload,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEvaluationResult {
    pub scenario_name: String,
    pub filter_drop_counts: HashMap<String, usize>,
    pub filtered_post_ids: Vec<String>,
    pub selected_source_counts: HashMap<String, usize>,
    pub selected_post_ids: Vec<String>,
    pub violations: Vec<String>,
}

impl ReplayEvaluationResult {
    pub fn passed(&self) -> bool {
        self.violations.is_empty()
    }
}

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
    let selected = select_candidates(
        &scenario.query,
        &scoring.candidates,
        scenario.expected.oversample_factor.unwrap_or(1),
        scenario.expected.max_selector_size.unwrap_or(200),
        scenario.expected.author_soft_cap.unwrap_or(2),
    );
    let selected_post_ids = selected
        .iter()
        .map(|candidate| candidate.post_id.clone())
        .collect::<Vec<_>>();
    let selected_source_counts = source_counts(&selected);
    let selected_id_set = selected_post_ids.iter().collect::<HashSet<_>>();
    let filtered_id_set = filtered_post_ids.iter().collect::<HashSet<_>>();
    let mut violations = Vec::new();

    if let Some(top_post_id) = scenario.expected.top_post_id.as_deref() {
        if selected_post_ids.first().map(String::as_str) != Some(top_post_id) {
            violations.push(format!(
                "top_post_id_mismatch: expected {} got {:?}",
                top_post_id,
                selected_post_ids.first()
            ));
        }
    }

    if !scenario.expected.selected_post_ids.is_empty()
        && selected_post_ids != scenario.expected.selected_post_ids
    {
        violations.push(format!(
            "selected_post_ids_mismatch: expected {:?} got {:?}",
            scenario.expected.selected_post_ids, selected_post_ids
        ));
    }

    if let Some(min_selected_count) = scenario.expected.min_selected_count {
        if selected_post_ids.len() < min_selected_count {
            violations.push(format!(
                "min_selected_count_mismatch: expected_at_least={} got={}",
                min_selected_count,
                selected_post_ids.len()
            ));
        }
    }

    if let Some(max_selected_count) = scenario.expected.max_selected_count {
        if selected_post_ids.len() > max_selected_count {
            violations.push(format!(
                "max_selected_count_mismatch: expected_at_most={} got={}",
                max_selected_count,
                selected_post_ids.len()
            ));
        }
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
            if let Some(external_id) = candidate_external_id(candidate) {
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

    ReplayEvaluationResult {
        scenario_name: scenario.name.clone(),
        filter_drop_counts: pre_filter.drop_counts,
        filtered_post_ids,
        selected_source_counts,
        selected_post_ids,
        violations,
    }
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

fn candidate_external_id(candidate: &RecommendationCandidatePayload) -> Option<String> {
    candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| trimmed_external_id(metadata.external_id.as_ref(), candidate))
        .or_else(|| trimmed_external_id(candidate.model_post_id.as_ref(), candidate))
}

fn trimmed_external_id(
    value: Option<&String>,
    candidate: &RecommendationCandidatePayload,
) -> Option<String> {
    value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && *value != candidate.post_id)
        .map(ToOwned::to_owned)
}
