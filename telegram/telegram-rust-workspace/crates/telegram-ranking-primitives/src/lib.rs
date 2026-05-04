pub const RANKING_LADDER_VERSION: &str = "rust_ranking_ladder_v1";
pub const RANKING_SCORE_ROLE_VERSION: &str = "ranking_score_role_v1";

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
pub enum RankingScoreRole {
    ModelScoreGeneration,
    WeightedScoreCreation,
    WeightedScoreAdjustment,
    FinalScoreCreation,
    MetadataOnly,
}

impl RankingScoreRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ModelScoreGeneration => "model_score_generation",
            Self::WeightedScoreCreation => "weighted_score_creation",
            Self::WeightedScoreAdjustment => "weighted_score_adjustment",
            Self::FinalScoreCreation => "final_score_creation",
            Self::MetadataOnly => "metadata_only",
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

    pub const fn score_role(self) -> RankingScoreRole {
        match self.kind {
            RankingStageKind::ModelScores => RankingScoreRole::ModelScoreGeneration,
            RankingStageKind::WeightedScore => RankingScoreRole::WeightedScoreCreation,
            RankingStageKind::ScoreAdjustment => RankingScoreRole::WeightedScoreAdjustment,
            RankingStageKind::FinalScore => RankingScoreRole::FinalScoreCreation,
            RankingStageKind::Metadata => RankingScoreRole::MetadataOnly,
        }
    }
}

pub fn validate_ranking_ladder(specs: &[RankingStageSpec]) -> Result<(), String> {
    if specs.is_empty() {
        return Err("ranking_ladder_empty".to_string());
    }

    if specs[0].kind != RankingStageKind::ModelScores {
        return Err("ranking_ladder_must_start_with_model_scores".to_string());
    }

    let weighted_score_indices = specs
        .iter()
        .enumerate()
        .filter_map(|(index, spec)| (spec.kind == RankingStageKind::WeightedScore).then_some(index))
        .collect::<Vec<_>>();
    if weighted_score_indices.len() != 1 {
        return Err("ranking_ladder_requires_one_weighted_score_stage".to_string());
    }

    let final_score_indices = specs
        .iter()
        .enumerate()
        .filter_map(|(index, spec)| spec.writes_final_score.then_some(index))
        .collect::<Vec<_>>();
    if final_score_indices.len() != 1 {
        return Err("ranking_ladder_requires_one_final_score_writer".to_string());
    }

    let final_score_index = final_score_indices[0];
    if final_score_index <= weighted_score_indices[0] {
        return Err("ranking_ladder_final_score_must_follow_weighted_score".to_string());
    }

    if specs
        .iter()
        .skip(final_score_index + 1)
        .any(|spec| spec.kind != RankingStageKind::Metadata)
    {
        return Err("ranking_ladder_all_post_final_stages_must_be_metadata".to_string());
    }

    let fallback_model_scorers = specs
        .iter()
        .filter(|spec| spec.fallback_model_scorer)
        .collect::<Vec<_>>();
    if fallback_model_scorers.len() != 1
        || fallback_model_scorers[0].kind != RankingStageKind::ModelScores
    {
        return Err("ranking_ladder_requires_one_model_fallback_scorer".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        RANKING_LADDER_VERSION, RANKING_SCORE_ROLE_VERSION, RankingStageKind, RankingStageSpec,
        validate_ranking_ladder,
    };

    #[test]
    fn validates_canonical_model_weighted_adjust_final_metadata_order() {
        let specs = [
            RankingStageSpec::new("Model", RankingStageKind::ModelScores, false, false, true),
            RankingStageSpec::new(
                "Weighted",
                RankingStageKind::WeightedScore,
                true,
                false,
                false,
            ),
            RankingStageSpec::new(
                "Adjust",
                RankingStageKind::ScoreAdjustment,
                true,
                false,
                false,
            ),
            RankingStageSpec::new("Final", RankingStageKind::FinalScore, false, true, false),
            RankingStageSpec::new("Metadata", RankingStageKind::Metadata, false, false, false),
        ];

        validate_ranking_ladder(&specs).expect("valid ranking ladder");
    }

    #[test]
    fn rejects_weighted_score_after_final_score() {
        let specs = [
            RankingStageSpec::new("Model", RankingStageKind::ModelScores, false, false, true),
            RankingStageSpec::new("Final", RankingStageKind::FinalScore, false, true, false),
            RankingStageSpec::new(
                "Weighted",
                RankingStageKind::WeightedScore,
                true,
                false,
                false,
            ),
        ];

        assert_eq!(
            validate_ranking_ladder(&specs).expect_err("invalid ranking ladder"),
            "ranking_ladder_final_score_must_follow_weighted_score"
        );
    }

    #[test]
    fn exports_stable_ranking_contract_versions() {
        assert_eq!(RANKING_LADDER_VERSION, "rust_ranking_ladder_v1");
        assert_eq!(RANKING_SCORE_ROLE_VERSION, "ranking_score_role_v1");
    }
}
