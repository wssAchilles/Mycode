pub const RANKING_LADDER_VERSION: &str = "rust_ranking_ladder_v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RankingStageKind {
    ModelScores,
    WeightedScore,
    ScoreAdjustment,
    FinalScore,
    Metadata,
}

impl RankingStageKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ModelScores => "model_scores",
            Self::WeightedScore => "weighted_score",
            Self::ScoreAdjustment => "score_adjustment",
            Self::FinalScore => "final_score",
            Self::Metadata => "metadata",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RankingStageSpec {
    pub stage_name: &'static str,
    pub kind: RankingStageKind,
    pub writes_weighted_score: bool,
    pub writes_final_score: bool,
    pub fallback_model_scorer: bool,
}

impl RankingStageSpec {
    pub const fn new(
        stage_name: &'static str,
        kind: RankingStageKind,
        writes_weighted_score: bool,
        writes_final_score: bool,
        fallback_model_scorer: bool,
    ) -> Self {
        Self {
            stage_name,
            kind,
            writes_weighted_score,
            writes_final_score,
            fallback_model_scorer,
        }
    }
}
