use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::pipeline::local::scorers::run_local_scorers;
use crate::selectors::top_k::select_candidates;

use super::contracts::{
    REPLAY_FIXTURE_VERSION, RecommendationReplayFixturePayload, RecommendationReplayScenarioPayload,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEvaluationResult {
    pub scenario_name: String,
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
    let scoring = run_local_scorers(&scenario.query, scenario.candidates.clone());
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
    let selected_id_set = selected_post_ids.iter().collect::<HashSet<_>>();
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

    ReplayEvaluationResult {
        scenario_name: scenario.name.clone(),
        selected_post_ids,
        violations,
    }
}
