use std::sync::Arc;

use tokio::sync::Mutex;

use crate::config::RecommendationConfig;
use crate::metrics::RecommendationMetrics;
use crate::pipeline::executor::RecommendationPipeline;
use crate::state::recent_store::RecentHotStore;

#[derive(Clone)]
pub struct AppState {
    pub config: RecommendationConfig,
    pub pipeline: Arc<RecommendationPipeline>,
    pub recent_store: Arc<Mutex<RecentHotStore>>,
    pub metrics: Arc<Mutex<RecommendationMetrics>>,
}
