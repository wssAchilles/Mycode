use serde::{Deserialize, Serialize};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ReplayExpectedPropertiesPayload {
    pub top_post_id: Option<String>,
    pub selected_post_ids: Vec<String>,
    pub min_selected_count: Option<usize>,
    pub max_selected_count: Option<usize>,
    pub must_select_post_ids: Vec<String>,
    pub must_not_select_post_ids: Vec<String>,
    pub must_filter_post_ids: Vec<String>,
    pub must_not_filter_post_ids: Vec<String>,
    pub must_rank_before: Vec<ReplayRankAssertionPayload>,
    pub max_repeated_author: Option<usize>,
    pub max_selected_per_external_id: Option<usize>,
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
