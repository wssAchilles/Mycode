use std::sync::Arc;

use crate::config::RecommendationConfig;
use crate::metrics::RecommendationMetrics;
use crate::news_trends::state::NewsTrendsCache;
use crate::pipeline::executor::RecommendationPipeline;
use crate::state::recent_store::RecentHotStore;

#[derive(Clone)]
pub struct AppState {
    pub config: RecommendationConfig,
    pub pipeline: Arc<RecommendationPipeline>,
    pub recent_store: Arc<RecentHotStore>,
    pub metrics: Arc<tokio::sync::Mutex<RecommendationMetrics>>,
    pub news_trends_cache: NewsTrendsCache,
}
