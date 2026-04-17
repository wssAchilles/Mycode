#[derive(Debug, Clone)]
pub struct RecommendationPipelineDefinition {
    pub pipeline_version: String,
    pub owner: String,
    pub fallback_mode: String,
    pub query_hydrators: Vec<String>,
    pub sources: Vec<String>,
    pub candidate_hydrators: Vec<String>,
    pub filters: Vec<String>,
    pub scorers: Vec<String>,
    pub selectors: Vec<String>,
    pub side_effects: Vec<String>,
}
