use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::ranking::{
    RankingStageKind, RankingStageSpec, annotate_ranking_stage_detail,
};
use telegram_component_primitives::scorers::{
    AUTHOR_AFFINITY_SCORER, AUTHOR_DIVERSITY_SCORER, BANDIT_EXPLORATION_SCORER,
    COLD_START_INTEREST_SCORER, CONTENT_QUALITY_SCORER, EXPLORATION_SCORER, FATIGUE_SCORER,
    INTEREST_DECAY_SCORER, INTRA_REQUEST_DIVERSITY_SCORER, LIGHTWEIGHT_PHOENIX_SCORER,
    NEWS_TREND_LINK_SCORER, OUT_OF_NETWORK_SCORER, RECENCY_SCORER, SCORE_CALIBRATION_SCORER,
    SCORE_CONTRACT_SCORER, SESSION_SUPPRESSION_SCORER, TREND_AFFINITY_SCORER,
    TREND_PERSONALIZATION_SCORER, WEIGHTED_SCORER,
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

    for step in local_scorer_steps() {
        let (next, mut stage) = (step.scorer)(query, current);
        attach_ranking_stage_detail(&mut stage, step.spec);
        current = next;
        stages.push(stage);
    }

    LocalScoringExecution {
        candidates: current,
        stages,
    }
}

pub fn local_scorer_stage_names() -> Vec<String> {
    local_scorer_steps()
        .iter()
        .map(|step| step.spec.stage_name.to_string())
        .collect()
}

#[cfg(test)]
pub fn local_ranking_ladder_specs() -> Vec<RankingStageSpec> {
    local_scorer_steps().iter().map(|step| step.spec).collect()
}

type ScorerFn = fn(
    &RecommendationQueryPayload,
    Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
);

#[derive(Clone, Copy)]
struct LocalScorerStep {
    scorer: ScorerFn,
    spec: RankingStageSpec,
}

fn local_scorer_steps() -> [LocalScorerStep; 19] {
    use RankingStageKind::{FinalScore, Metadata, ModelScores, ScoreAdjustment, WeightedScore};

    [
        step(
            LIGHTWEIGHT_PHOENIX_SCORER,
            ModelScores,
            false,
            false,
            true,
            lightweight_phoenix_scorer,
        ),
        step(
            WEIGHTED_SCORER,
            WeightedScore,
            true,
            false,
            false,
            weighted_scorer,
        ),
        step(
            SCORE_CALIBRATION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            score_calibration_scorer,
        ),
        step(
            CONTENT_QUALITY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            content_quality_scorer,
        ),
        step(
            AUTHOR_AFFINITY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            author_affinity_scorer,
        ),
        step(
            RECENCY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            recency_scorer,
        ),
        step(
            COLD_START_INTEREST_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            cold_start_interest_scorer,
        ),
        step(
            TREND_AFFINITY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            trend_affinity_scorer,
        ),
        step(
            TREND_PERSONALIZATION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            trend_personalization_scorer,
        ),
        step(
            NEWS_TREND_LINK_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            news_trend_link_scorer,
        ),
        step(
            INTEREST_DECAY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            interest_decay_scorer,
        ),
        step(
            EXPLORATION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            exploration_scorer,
        ),
        step(
            BANDIT_EXPLORATION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            bandit_exploration_scorer,
        ),
        step(
            FATIGUE_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            fatigue_scorer,
        ),
        step(
            SESSION_SUPPRESSION_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            session_suppression_scorer,
        ),
        step(
            OUT_OF_NETWORK_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            oon_scorer,
        ),
        step(
            INTRA_REQUEST_DIVERSITY_SCORER,
            ScoreAdjustment,
            true,
            false,
            false,
            intra_request_diversity_scorer,
        ),
        step(
            AUTHOR_DIVERSITY_SCORER,
            FinalScore,
            false,
            true,
            false,
            author_diversity_scorer,
        ),
        step(
            SCORE_CONTRACT_SCORER,
            Metadata,
            false,
            false,
            false,
            score_contract_scorer,
        ),
    ]
}

fn step(
    stage_name: &'static str,
    kind: RankingStageKind,
    writes_weighted_score: bool,
    writes_final_score: bool,
    fallback_model_scorer: bool,
    scorer: ScorerFn,
) -> LocalScorerStep {
    LocalScorerStep {
        scorer,
        spec: RankingStageSpec::new(
            stage_name,
            kind,
            writes_weighted_score,
            writes_final_score,
            fallback_model_scorer,
        ),
    }
}

fn attach_ranking_stage_detail(stage: &mut RecommendationStagePayload, spec: RankingStageSpec) {
    let detail = stage.detail.get_or_insert_with(Default::default);
    annotate_ranking_stage_detail(detail, spec);
}
