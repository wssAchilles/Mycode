//! 排序阶梯与融合组契约单元测试。

use super::{
    RANKING_LADDER_VERSION, RankingAdjustmentGroupSpec, RankingLadderPlan, RankingStageKind,
    RankingStageSpec, validate_ranking_adjustment_registry, validate_ranking_ladder,
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
fn exposes_reusable_ranking_ladder_plan() {
    let plan = RankingLadderPlan::new(vec![
        RankingStageSpec::new("Model", RankingStageKind::ModelScores, false, false, true),
        RankingStageSpec::new(
            "Weighted",
            RankingStageKind::WeightedScore,
            true,
            false,
            false,
        ),
        RankingStageSpec::new("Final", RankingStageKind::FinalScore, false, true, false),
    ]);

    assert_eq!(plan.version, RANKING_LADDER_VERSION);
    assert_eq!(plan.stage_names(), vec!["Model", "Weighted", "Final"]);
    plan.validate().expect("ranking ladder plan is valid");
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
fn rejects_multiple_model_score_stages() {
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
            "SecondModel",
            RankingStageKind::ModelScores,
            false,
            false,
            false,
        ),
        RankingStageSpec::new("Final", RankingStageKind::FinalScore, false, true, false),
    ];

    assert_eq!(
        validate_ranking_ladder(&specs).expect_err("second model stage is invalid"),
        "ranking_ladder_requires_one_leading_model_score_stage"
    );
}

#[test]
fn rejects_adjustments_outside_weighted_to_final_window() {
    let specs = [
        RankingStageSpec::new("Model", RankingStageKind::ModelScores, false, false, true),
        RankingStageSpec::new(
            "AdjustBeforeWeighted",
            RankingStageKind::ScoreAdjustment,
            true,
            false,
            false,
        ),
        RankingStageSpec::new(
            "Weighted",
            RankingStageKind::WeightedScore,
            true,
            false,
            false,
        ),
        RankingStageSpec::new("Final", RankingStageKind::FinalScore, false, true, false),
    ];

    assert_eq!(
        validate_ranking_ladder(&specs).expect_err("pre-weighted adjustment is invalid"),
        "ranking_ladder_adjustment_must_be_between_weighted_and_final: stage=AdjustBeforeWeighted"
    );
}

#[test]
fn rejects_score_write_role_drift() {
    let specs = [
        RankingStageSpec::new("Model", RankingStageKind::ModelScores, true, false, true),
        RankingStageSpec::new(
            "Weighted",
            RankingStageKind::WeightedScore,
            true,
            false,
            false,
        ),
        RankingStageSpec::new("Final", RankingStageKind::FinalScore, false, true, false),
    ];

    assert_eq!(
        validate_ranking_ladder(&specs).expect_err("model stage cannot write weighted score"),
        "ranking_ladder_model_stage_must_not_write_rank_scores: stage=Model"
    );
}

#[test]
fn validates_adjustment_registry_against_ladder_contract() {
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
            "AdjustA",
            RankingStageKind::ScoreAdjustment,
            true,
            false,
            false,
        ),
        RankingStageSpec::new(
            "AdjustB",
            RankingStageKind::ScoreAdjustment,
            true,
            false,
            false,
        ),
        RankingStageSpec::new("Final", RankingStageKind::FinalScore, false, true, false),
        RankingStageSpec::new("Metadata", RankingStageKind::Metadata, false, false, false),
    ];

    validate_ranking_adjustment_registry(
        &[RankingAdjustmentGroupSpec::new(
            "fused_adjustments",
            &["AdjustA", "AdjustB"],
        )],
        &specs,
    )
    .expect("valid adjustment registry");
}

#[test]
fn rejects_adjustment_registry_with_non_adjustment_stage() {
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
    ];

    assert_eq!(
        validate_ranking_adjustment_registry(
            &[RankingAdjustmentGroupSpec::new(
                "bad_group",
                &["Weighted", "Adjust"],
            )],
            &specs,
        )
        .expect_err("invalid adjustment registry"),
        "ranking_adjustment_stage_must_be_score_adjustment: group=bad_group stage=Weighted"
    );
}

#[test]
fn rejects_non_contiguous_adjustment_group() {
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
            "AdjustA",
            RankingStageKind::ScoreAdjustment,
            true,
            false,
            false,
        ),
        RankingStageSpec::new(
            "AdjustB",
            RankingStageKind::ScoreAdjustment,
            true,
            false,
            false,
        ),
        RankingStageSpec::new("Final", RankingStageKind::FinalScore, false, true, false),
    ];

    assert_eq!(
        validate_ranking_adjustment_registry(
            &[RankingAdjustmentGroupSpec::new(
                "bad_group",
                &["AdjustA", "Final"],
            )],
            &specs,
        )
        .expect_err("invalid adjustment registry"),
        "ranking_adjustment_stage_must_be_score_adjustment: group=bad_group stage=Final"
    );
    assert_eq!(
        validate_ranking_adjustment_registry(
            &[RankingAdjustmentGroupSpec::new(
                "bad_group",
                &["AdjustA", "AdjustB"],
            )],
            &[
                specs[0],
                specs[1],
                specs[2],
                RankingStageSpec::new(
                    "OtherAdjust",
                    RankingStageKind::ScoreAdjustment,
                    true,
                    false,
                    false,
                ),
                specs[3],
                specs[4],
            ],
        )
        .expect_err("non-contiguous adjustment registry"),
        "ranking_adjustment_group_must_be_contiguous: group=bad_group"
    );
}
