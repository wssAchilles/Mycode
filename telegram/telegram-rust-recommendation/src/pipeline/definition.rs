#[derive(Debug, Clone)]
pub struct RecommendationPipelineDefinition {
    pub pipeline_version: String,
    pub owner: String,
    pub fallback_mode: String,
    pub query_hydrator_execution_mode: String,
    pub source_execution_mode: String,
    pub query_hydrator_concurrency: usize,
    pub source_concurrency: usize,
    pub query_hydrators: Vec<String>,
    pub sources: Vec<String>,
    pub candidate_hydrators: Vec<String>,
    pub filters: Vec<String>,
    pub scorers: Vec<String>,
    pub selectors: Vec<String>,
    pub post_selection_hydrators: Vec<String>,
    pub post_selection_filters: Vec<String>,
    pub side_effects: Vec<String>,
}
