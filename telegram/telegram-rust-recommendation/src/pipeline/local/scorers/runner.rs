use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::{
    author_affinity_scorer, author_diversity_scorer, bandit_exploration_scorer,
    cold_start_interest_scorer, content_quality_scorer, exploration_scorer, fatigue_scorer,
    interest_decay_scorer, intra_request_diversity_scorer, lightweight_phoenix_scorer,
    news_trend_link_scorer, oon_scorer, recency_scorer, score_calibration_scorer,
    score_contract_scorer, session_suppression_scorer, trend_affinity_scorer,
    trend_personalization_scorer, weighted_scorer,
};

pub struct LocalScoringExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

pub fn run_local_scorers(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalScoringExecution {
    let mut current = candidates;
    let mut stages = Vec::new();

    for scorer in [
        lightweight_phoenix_scorer as ScorerFn,
        weighted_scorer as ScorerFn,
        score_calibration_scorer,
        content_quality_scorer,
        author_affinity_scorer,
        recency_scorer,
        cold_start_interest_scorer,
        trend_affinity_scorer,
        trend_personalization_scorer,
        news_trend_link_scorer,
        interest_decay_scorer,
        exploration_scorer,
        bandit_exploration_scorer,
        fatigue_scorer,
        session_suppression_scorer,
        intra_request_diversity_scorer,
        author_diversity_scorer,
        oon_scorer,
        score_contract_scorer,
    ] {
        let (next, stage) = scorer(query, current);
        current = next;
        stages.push(stage);
    }

    LocalScoringExecution {
        candidates: current,
        stages,
    }
}

type ScorerFn = fn(
    &RecommendationQueryPayload,
    Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
);
