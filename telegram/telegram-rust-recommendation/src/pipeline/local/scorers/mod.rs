mod affinity;
mod calibration;
mod diversity;
mod exploration;
mod helpers;
mod metadata;
mod phoenix;
mod runner;
mod suppression;
mod trends;
mod weighted;

use affinity::{author_affinity_scorer, cold_start_interest_scorer, interest_decay_scorer};
use calibration::{content_quality_scorer, recency_scorer, score_calibration_scorer};
use diversity::{author_diversity_scorer, intra_request_diversity_scorer};
use exploration::{bandit_exploration_scorer, exploration_scorer};
use metadata::{oon_scorer, score_contract_scorer};
use phoenix::lightweight_phoenix_scorer;
use suppression::{fatigue_scorer, session_suppression_scorer};
use trends::{news_trend_link_scorer, trend_affinity_scorer, trend_personalization_scorer};
use weighted::weighted_scorer;

#[allow(unused_imports)]
pub use runner::{LocalScoringExecution, run_local_scorers};

const LOCAL_EXECUTION_MODE: &str = "rust_local_scorers_v1";
const MIN_VIDEO_DURATION_SEC: f64 = 5.0;
const OON_WEIGHT_FACTOR: f64 = 0.7;
const POSITIVE_WEIGHT_SUM: f64 = 30.15;
const NEGATIVE_WEIGHT_SUM: f64 = 27.0;
const NEGATIVE_SCORES_OFFSET: f64 = 0.1;

struct WeightedScoreSummary {
    raw_score: f64,
    base_raw_score: f64,
    positive_score: f64,
    negative_score: f64,
    evidence_score: f64,
    action_scores_used: bool,
    heuristic_fallback_used: bool,
}

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
