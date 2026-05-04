use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use crate::pipeline::local::ranking::{RankingStageKind, RankingStageSpec};
use serde_json::Value;

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
            "LightweightPhoenixScorer",
            ModelScores,
            false,
            false,
            true,
            lightweight_phoenix_scorer,
        ),
        step(
            "WeightedScorer",
            WeightedScore,
            true,
            false,
            false,
            weighted_scorer,
        ),
        step(
            "ScoreCalibrationScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            score_calibration_scorer,
        ),
        step(
            "ContentQualityScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            content_quality_scorer,
        ),
        step(
            "AuthorAffinityScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            author_affinity_scorer,
        ),
        step(
            "RecencyScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            recency_scorer,
        ),
        step(
            "ColdStartInterestScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            cold_start_interest_scorer,
        ),
        step(
            "TrendAffinityScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            trend_affinity_scorer,
        ),
        step(
            "TrendPersonalizationScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            trend_personalization_scorer,
        ),
        step(
            "NewsTrendLinkScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            news_trend_link_scorer,
        ),
        step(
            "InterestDecayScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            interest_decay_scorer,
        ),
        step(
            "ExplorationScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            exploration_scorer,
        ),
        step(
            "BanditExplorationScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            bandit_exploration_scorer,
        ),
        step(
            "FatigueScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            fatigue_scorer,
        ),
        step(
            "SessionSuppressionScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            session_suppression_scorer,
        ),
        step(
            "OutOfNetworkScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            oon_scorer,
        ),
        step(
            "IntraRequestDiversityScorer",
            ScoreAdjustment,
            true,
            false,
            false,
            intra_request_diversity_scorer,
        ),
        step(
            "AuthorDiversityScorer",
            FinalScore,
            false,
            true,
            false,
            author_diversity_scorer,
        ),
        step(
            "ScoreContractScorer",
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
    detail.insert(
        "rankingStageName".to_string(),
        Value::String(spec.stage_name.to_string()),
    );
    detail.insert(
        "rankingStageKind".to_string(),
        Value::String(spec.kind.as_str().to_string()),
    );
    detail.insert(
        "rankingScoreRole".to_string(),
        Value::String(spec.score_role().as_str().to_string()),
    );
    detail.insert(
        "rankingWritesWeightedScore".to_string(),
        Value::Bool(spec.writes_weighted_score),
    );
    detail.insert(
        "rankingWritesFinalScore".to_string(),
        Value::Bool(spec.writes_final_score),
    );
    detail.insert(
        "rankingFallbackModelScorer".to_string(),
        Value::Bool(spec.fallback_model_scorer),
    );
}
