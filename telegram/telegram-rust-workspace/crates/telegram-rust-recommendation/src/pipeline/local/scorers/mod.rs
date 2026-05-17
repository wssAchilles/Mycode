mod affinity;
mod calibration;
mod diversity;
mod exploration;
mod fused_adjustments;
mod heuristic_rescoring;
mod helpers;
mod listwise_reranking;
mod metadata;
mod ownership;
mod phoenix;
mod runner;
mod stage_detail;
mod suppression;
mod trends;
mod weighted;

use telegram_pipeline_primitives::PIPELINE_LOCAL_SCORER_EXECUTION_MODE;

use affinity::{author_affinity_scorer, cold_start_interest_scorer, interest_decay_scorer};
use calibration::{content_quality_scorer, recency_scorer, score_calibration_scorer};
use diversity::{author_diversity_scorer, intra_request_diversity_scorer};
use exploration::{bandit_exploration_scorer, exploration_scorer};
use fused_adjustments::{
    run_fused_foundation_adjustment_group, run_fused_interest_exploration_group,
    run_fused_suppression_adjustment_group, run_fused_trend_adjustment_group,
};
use metadata::{oon_scorer, score_contract_scorer};
use phoenix::lightweight_phoenix_scorer;
use suppression::{fatigue_scorer, session_suppression_scorer};
use trends::{news_trend_link_scorer, trend_affinity_scorer, trend_personalization_scorer};
use weighted::weighted_scorer;

#[allow(unused_imports)]
pub use runner::{
    LocalScoringExecution, local_ranking_adjustment_group_specs, local_ranking_ladder_plan,
    local_ranking_ladder_specs, local_scorer_stage_names, run_local_scorers,
    validate_local_ranking_adjustment_registry, validate_local_ranking_ladder,
};

const LOCAL_EXECUTION_MODE: &str = PIPELINE_LOCAL_SCORER_EXECUTION_MODE;
const MIN_VIDEO_DURATION_SEC: f64 = 5.0;
const OON_WEIGHT_FACTOR: f64 = 0.7;

#[derive(Debug, Clone, Copy, Default)]
struct ContentQualitySummary {
    score: f64,
    quality_prior: f64,
    engagement_prior: f64,
    low_quality_penalty: f64,
}

#[derive(Debug, Clone, Copy, Default)]
struct NegativeFeedbackSummary {
    strength: f64,
    multiplier: f64,
}

#[cfg(test)]
mod tests;
