use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use telegram_recommendation_contracts::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload,
};

pub const REPLAY_FIXTURE_VERSION: &str = "recommendation_replay_v1";
pub const REPLAY_SCENARIO_MANIFEST_VERSION: &str = "recommendation_replay_manifest_v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationReplayFixturePayload {
    pub replay_version: String,
    pub scenarios: Vec<RecommendationReplayScenarioPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationReplayScenarioManifestPayload {
    pub manifest_version: String,
    pub scenarios: Vec<ReplayScenarioManifestEntryPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayScenarioManifestEntryPayload {
    pub name: String,
    pub category: String,
    pub description: String,
    pub parity_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationReplayScenarioPayload {
    pub name: String,
    pub query: RecommendationQueryPayload,
    pub candidates: Vec<RecommendationCandidatePayload>,
    #[serde(default)]
    pub expected: ReplayExpectedPropertiesPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEvaluationResultPayload {
    pub scenario_name: String,
    pub stage_names: Vec<String>,
    pub filter_drop_counts: HashMap<String, usize>,
    pub filtered_post_ids: Vec<String>,
    pub selected_lane_counts: HashMap<String, usize>,
    pub selected_source_counts: HashMap<String, usize>,
    pub selector_deferred_reason_counts: HashMap<String, usize>,
    pub selected_post_ids: Vec<String>,
    pub violations: Vec<String>,
}

impl ReplayEvaluationResultPayload {
    pub fn passed(&self) -> bool {
        self.violations.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ReplayExpectedPropertiesPayload {
    pub top_post_id: Option<String>,
    pub selected_post_ids: Vec<String>,
    pub min_selected_count: Option<usize>,
    pub max_selected_count: Option<usize>,
    pub stage_order: Vec<String>,
    pub must_have_stages: Vec<String>,
    pub must_not_have_stages: Vec<String>,
    pub must_select_post_ids: Vec<String>,
    pub must_not_select_post_ids: Vec<String>,
    pub must_filter_post_ids: Vec<String>,
    pub must_not_filter_post_ids: Vec<String>,
    pub must_rank_before: Vec<ReplayRankAssertionPayload>,
    pub score_ranges: Vec<ReplayScoreRangeAssertionPayload>,
    pub candidate_breakdown_ranges: Vec<ReplayCandidateBreakdownRangeAssertionPayload>,
    pub ranking_stage_kinds: HashMap<String, String>,
    pub filter_drop_counts: HashMap<String, usize>,
    pub selected_source_counts: HashMap<String, usize>,
    pub selected_lane_counts: HashMap<String, usize>,
    pub min_selected_source_counts: HashMap<String, usize>,
    pub max_selected_source_counts: HashMap<String, usize>,
    pub selector_deferred_reason_counts: HashMap<String, usize>,
    pub max_repeated_author: Option<usize>,
    pub max_selected_per_external_id: Option<usize>,
    pub stage_details: Vec<ReplayStageDetailAssertionPayload>,
    pub oversample_factor: Option<usize>,
    pub max_selector_size: Option<usize>,
    pub author_soft_cap: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRankAssertionPayload {
    pub before_post_id: String,
    pub after_post_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayScoreRangeAssertionPayload {
    pub post_id: String,
    pub min_score: Option<f64>,
    pub max_score: Option<f64>,
    pub min_weighted_score: Option<f64>,
    pub max_weighted_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayCandidateBreakdownRangeAssertionPayload {
    pub post_id: String,
    pub key: String,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayStageDetailAssertionPayload {
    pub stage_name: String,
    pub expected: HashMap<String, Value>,
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        REPLAY_FIXTURE_VERSION, REPLAY_SCENARIO_MANIFEST_VERSION,
        RecommendationReplayFixturePayload, RecommendationReplayScenarioManifestPayload,
        ReplayEvaluationResultPayload,
    };
    use crate::{REPLAY_SCENARIOS, REPLAY_WARM_USER};

    #[test]
    fn parses_replay_fixture_schema() {
        let fixture: RecommendationReplayFixturePayload =
            serde_json::from_str(REPLAY_WARM_USER).expect("parse replay fixture");

        assert_eq!(fixture.replay_version, REPLAY_FIXTURE_VERSION);
        assert!(
            fixture
                .scenarios
                .iter()
                .any(|scenario| scenario.name == "warm_user_mock_phoenix_top_k")
        );
    }

    #[test]
    fn parses_replay_manifest_schema() {
        let manifest: RecommendationReplayScenarioManifestPayload =
            serde_json::from_str(REPLAY_SCENARIOS).expect("parse replay manifest");

        assert_eq!(manifest.manifest_version, REPLAY_SCENARIO_MANIFEST_VERSION);
        assert!(!manifest.scenarios.is_empty());
    }

    #[test]
    fn replay_evaluation_result_preserves_passed_contract() {
        let result = ReplayEvaluationResultPayload {
            scenario_name: "warm_user".to_string(),
            stage_names: vec!["RustWeightedScorer".to_string()],
            filter_drop_counts: HashMap::new(),
            filtered_post_ids: Vec::new(),
            selected_lane_counts: HashMap::new(),
            selected_source_counts: HashMap::new(),
            selector_deferred_reason_counts: HashMap::new(),
            selected_post_ids: vec!["post-1".to_string()],
            violations: Vec::new(),
        };

        assert!(result.passed());
    }
}
