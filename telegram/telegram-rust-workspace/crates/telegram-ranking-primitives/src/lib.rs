use std::collections::HashMap;

use serde_json::Value;

pub mod breakdown_fields;
pub mod policy_keys;
pub mod weighted;
pub use breakdown_fields::*;
pub use policy_keys::*;
pub use weighted::*;

pub const RANKING_LADDER_VERSION: &str = "rust_ranking_ladder_v1";
pub const RANKING_SCORE_ROLE_VERSION: &str = "ranking_score_role_v1";

pub const RANKING_STAGE_NAME_FIELD: &str = "rankingStageName";
pub const RANKING_STAGE_KIND_FIELD: &str = "rankingStageKind";
pub const RANKING_SCORE_ROLE_FIELD: &str = "rankingScoreRole";
pub const RANKING_WRITES_WEIGHTED_SCORE_FIELD: &str = "rankingWritesWeightedScore";
pub const RANKING_WRITES_FINAL_SCORE_FIELD: &str = "rankingWritesFinalScore";
pub const RANKING_FALLBACK_MODEL_SCORER_FIELD: &str = "rankingFallbackModelScorer";
pub const RANKING_CANDIDATE_FIELD_WRITES_FIELD: &str = "rankingCandidateFieldWrites";
pub const RANKING_FUSED_GROUP_FIELD: &str = "rankingFusedGroup";
pub const RANKING_FUSED_GROUP_STAGES_FIELD: &str = "rankingFusedGroupStages";
pub const RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD: &str = "rankingFusedStageAppliedCount";
pub const RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD: &str = "rankingFusedStageSkippedReason";
pub const RANKING_STAGE_DETAIL_FIELDS: &[&str] = &[
    RANKING_STAGE_NAME_FIELD,
    RANKING_STAGE_KIND_FIELD,
    RANKING_SCORE_ROLE_FIELD,
    RANKING_WRITES_WEIGHTED_SCORE_FIELD,
    RANKING_WRITES_FINAL_SCORE_FIELD,
    RANKING_FALLBACK_MODEL_SCORER_FIELD,
    RANKING_CANDIDATE_FIELD_WRITES_FIELD,
    RANKING_FUSED_GROUP_FIELD,
    RANKING_FUSED_GROUP_STAGES_FIELD,
    RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD,
    RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD,
];
pub const SCORE_BREAKDOWN_INITIAL_CAPACITY: usize = 16;

pub fn new_score_breakdown_map() -> HashMap<String, f64> {
    HashMap::with_capacity(SCORE_BREAKDOWN_INITIAL_CAPACITY)
}

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingLadderPlan {
    pub version: &'static str,
    pub specs: Vec<RankingStageSpec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RankingAdjustmentGroupSpec {
    pub group_name: &'static str,
    pub stage_names: &'static [&'static str],
}

impl RankingAdjustmentGroupSpec {
    pub const fn new(group_name: &'static str, stage_names: &'static [&'static str]) -> Self {
        Self {
            group_name,
            stage_names,
        }
    }
}

impl RankingLadderPlan {
    pub fn new(specs: Vec<RankingStageSpec>) -> Self {
        Self {
            version: RANKING_LADDER_VERSION,
            specs,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        validate_ranking_ladder(&self.specs)
    }

    pub fn stage_names(&self) -> Vec<String> {
        self.specs
            .iter()
            .map(|spec| spec.stage_name.to_string())
            .collect()
    }
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

pub fn validate_ranking_adjustment_registry(
    groups: &[RankingAdjustmentGroupSpec],
    specs: &[RankingStageSpec],
) -> Result<(), String> {
    let mut seen_group_names = Vec::new();
    let mut seen_stage_names = Vec::new();

    for group in groups {
        if group.group_name.is_empty() {
            return Err("ranking_adjustment_group_name_empty".to_string());
        }
        if group.stage_names.is_empty() {
            return Err(format!(
                "ranking_adjustment_group_empty: group={}",
                group.group_name
            ));
        }
        if seen_group_names.contains(&group.group_name) {
            return Err(format!(
                "ranking_adjustment_group_duplicate: group={}",
                group.group_name
            ));
        }
        seen_group_names.push(group.group_name);

        let mut group_indices = Vec::new();
        for stage_name in group.stage_names {
            if seen_stage_names.contains(stage_name) {
                return Err(format!(
                    "ranking_adjustment_stage_duplicate: stage={}",
                    stage_name
                ));
            }
            seen_stage_names.push(*stage_name);

            let Some((index, spec)) = specs
                .iter()
                .enumerate()
                .find(|(_, spec)| spec.stage_name == *stage_name)
            else {
                return Err(format!(
                    "ranking_adjustment_stage_unknown: group={} stage={}",
                    group.group_name, stage_name
                ));
            };

            if spec.kind != RankingStageKind::ScoreAdjustment {
                return Err(format!(
                    "ranking_adjustment_stage_must_be_score_adjustment: group={} stage={}",
                    group.group_name, stage_name
                ));
            }
            if !spec.writes_weighted_score || spec.writes_final_score {
                return Err(format!(
                    "ranking_adjustment_stage_invalid_score_write: group={} stage={} writes_weighted={} writes_final={}",
                    group.group_name,
                    stage_name,
                    spec.writes_weighted_score,
                    spec.writes_final_score
                ));
            }
            group_indices.push(index);
        }

        let min_index = group_indices.iter().copied().min().unwrap_or_default();
        for (offset, index) in group_indices.iter().copied().enumerate() {
            if index != min_index + offset {
                return Err(format!(
                    "ranking_adjustment_group_must_be_contiguous: group={}",
                    group.group_name
                ));
            }
        }
    }

    Ok(())
}

pub fn annotate_ranking_stage_detail(detail: &mut HashMap<String, Value>, spec: RankingStageSpec) {
    detail.insert(
        RANKING_STAGE_NAME_FIELD.to_string(),
        Value::String(spec.stage_name.to_string()),
    );
    detail.insert(
        RANKING_STAGE_KIND_FIELD.to_string(),
        Value::String(spec.kind.as_str().to_string()),
    );
    detail.insert(
        RANKING_SCORE_ROLE_FIELD.to_string(),
        Value::String(spec.score_role().as_str().to_string()),
    );
    detail.insert(
        RANKING_WRITES_WEIGHTED_SCORE_FIELD.to_string(),
        Value::Bool(spec.writes_weighted_score),
    );
    detail.insert(
        RANKING_WRITES_FINAL_SCORE_FIELD.to_string(),
        Value::Bool(spec.writes_final_score),
    );
    detail.insert(
        RANKING_FALLBACK_MODEL_SCORER_FIELD.to_string(),
        Value::Bool(spec.fallback_model_scorer),
    );
}

pub fn ranking_stage_detail_contract_violations(
    spec: RankingStageSpec,
    detail: Option<&HashMap<String, Value>>,
) -> Vec<String> {
    let Some(detail) = detail else {
        return vec![format!(
            "ranking_stage_detail_missing: stage={}",
            spec.stage_name
        )];
    };

    [
        (
            RANKING_STAGE_NAME_FIELD,
            Value::String(spec.stage_name.to_string()),
        ),
        (
            RANKING_STAGE_KIND_FIELD,
            Value::String(spec.kind.as_str().to_string()),
        ),
        (
            RANKING_SCORE_ROLE_FIELD,
            Value::String(spec.score_role().as_str().to_string()),
        ),
        (
            RANKING_WRITES_WEIGHTED_SCORE_FIELD,
            Value::Bool(spec.writes_weighted_score),
        ),
        (
            RANKING_WRITES_FINAL_SCORE_FIELD,
            Value::Bool(spec.writes_final_score),
        ),
        (
            RANKING_FALLBACK_MODEL_SCORER_FIELD,
            Value::Bool(spec.fallback_model_scorer),
        ),
    ]
    .into_iter()
    .filter_map(|(field, expected)| {
        let actual = detail.get(field);
        (actual != Some(&expected)).then(|| {
            format!(
                "ranking_stage_detail_mismatch: stage={} field={} expected={} got={:?}",
                spec.stage_name, field, expected, actual
            )
        })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        RANKING_CANDIDATE_FIELD_WRITES_FIELD, RANKING_FALLBACK_MODEL_SCORER_FIELD,
        RANKING_FUSED_GROUP_FIELD, RANKING_FUSED_GROUP_STAGES_FIELD,
        RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD, RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD,
        RANKING_LADDER_VERSION, RANKING_SCORE_ROLE_FIELD, RANKING_SCORE_ROLE_VERSION,
        RANKING_STAGE_DETAIL_FIELDS, RANKING_STAGE_KIND_FIELD, RANKING_STAGE_NAME_FIELD,
        RANKING_WRITES_FINAL_SCORE_FIELD, RANKING_WRITES_WEIGHTED_SCORE_FIELD,
        RankingAdjustmentGroupSpec, RankingLadderPlan, RankingStageKind, RankingStageSpec,
        annotate_ranking_stage_detail, ranking_stage_detail_contract_violations,
        validate_ranking_adjustment_registry, validate_ranking_ladder,
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

    #[test]
    fn exports_stable_ranking_contract_versions() {
        assert_eq!(RANKING_LADDER_VERSION, "rust_ranking_ladder_v1");
        assert_eq!(RANKING_SCORE_ROLE_VERSION, "ranking_score_role_v1");
        assert_eq!(
            RANKING_CANDIDATE_FIELD_WRITES_FIELD,
            "rankingCandidateFieldWrites"
        );
        assert_eq!(RANKING_FUSED_GROUP_FIELD, "rankingFusedGroup");
        assert_eq!(RANKING_FUSED_GROUP_STAGES_FIELD, "rankingFusedGroupStages");
        assert_eq!(
            RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD,
            "rankingFusedStageAppliedCount"
        );
        assert_eq!(
            RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD,
            "rankingFusedStageSkippedReason"
        );
        assert!(RANKING_STAGE_DETAIL_FIELDS.contains(&RANKING_STAGE_NAME_FIELD));
        assert!(RANKING_STAGE_DETAIL_FIELDS.contains(&RANKING_CANDIDATE_FIELD_WRITES_FIELD));
        assert!(RANKING_STAGE_DETAIL_FIELDS.contains(&RANKING_FUSED_GROUP_FIELD));
    }

    #[test]
    fn annotates_ranking_stage_detail_contract() {
        let spec = RankingStageSpec::new(
            "WeightedScorer",
            RankingStageKind::WeightedScore,
            true,
            false,
            false,
        );
        let mut detail = std::collections::HashMap::new();

        annotate_ranking_stage_detail(&mut detail, spec);

        assert_eq!(
            detail.get(RANKING_STAGE_NAME_FIELD),
            Some(&serde_json::json!("WeightedScorer"))
        );
        assert_eq!(
            detail.get(RANKING_STAGE_KIND_FIELD),
            Some(&serde_json::json!("weighted_score"))
        );
        assert_eq!(
            detail.get(RANKING_SCORE_ROLE_FIELD),
            Some(&serde_json::json!("weighted_score_creation"))
        );
        assert_eq!(
            detail.get(RANKING_WRITES_WEIGHTED_SCORE_FIELD),
            Some(&serde_json::json!(true))
        );
        assert_eq!(
            detail.get(RANKING_WRITES_FINAL_SCORE_FIELD),
            Some(&serde_json::json!(false))
        );
        assert_eq!(
            detail.get(RANKING_FALLBACK_MODEL_SCORER_FIELD),
            Some(&serde_json::json!(false))
        );
        assert!(ranking_stage_detail_contract_violations(spec, Some(&detail)).is_empty());

        detail.insert(
            RANKING_WRITES_FINAL_SCORE_FIELD.to_string(),
            serde_json::json!(true),
        );
        assert_eq!(
            ranking_stage_detail_contract_violations(spec, Some(&detail)),
            vec![
                "ranking_stage_detail_mismatch: stage=WeightedScorer field=rankingWritesFinalScore expected=false got=Some(Bool(true))"
            ]
        );
    }
}
