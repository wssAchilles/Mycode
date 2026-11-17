//! 排序阶段明细字段常量及阶段执行详情注解/审计校验逻辑。

use std::collections::HashMap;

use serde_json::Value;

use super::types::RankingStageSpec;

pub const RANKING_STAGE_NAME_FIELD: &str = "rankingStageName";
pub const RANKING_STAGE_KIND_FIELD: &str = "rankingStageKind";
pub const RANKING_SCORE_ROLE_FIELD: &str = "rankingScoreRole";
pub const RANKING_WRITES_WEIGHTED_SCORE_FIELD: &str = "rankingWritesWeightedScore";
pub const RANKING_WRITES_FINAL_SCORE_FIELD: &str = "rankingWritesFinalScore";
pub const RANKING_FALLBACK_MODEL_SCORER_FIELD: &str = "rankingFallbackModelScorer";
pub const RANKING_MODEL_MODE_FIELD: &str = "rankingModelMode";
pub const RANKING_MODEL_MODE_REMOTE_PREDICTION: &str = "remote_prediction";
pub const RANKING_MODEL_MODE_HEURISTIC_FALLBACK: &str = "heuristic_fallback";
pub const RANKING_MODEL_MODE_SCORE_COMPOSITION: &str = "score_composition";
pub const RANKING_MODEL_MISSING_TARGETS_FIELD: &str = "rankingMissingModelTargets";
pub const RANKING_MODEL_TARGETS_FIELD: &str = "rankingModelTargets";
pub const RANKING_CANDIDATE_FIELD_WRITES_FIELD: &str = "rankingCandidateFieldWrites";
pub const RANKING_FUSED_GROUP_FIELD: &str = "rankingFusedGroup";
pub const RANKING_FUSED_GROUP_STAGES_FIELD: &str = "rankingFusedGroupStages";
pub const RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD: &str = "rankingFusedStageAppliedCount";
pub const RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD: &str = "rankingFusedStageSkippedReason";

/// 排序阶段明细契约标准字段集合。
pub const RANKING_STAGE_DETAIL_FIELDS: &[&str] = &[
    RANKING_STAGE_NAME_FIELD,
    RANKING_STAGE_KIND_FIELD,
    RANKING_SCORE_ROLE_FIELD,
    RANKING_WRITES_WEIGHTED_SCORE_FIELD,
    RANKING_WRITES_FINAL_SCORE_FIELD,
    RANKING_FALLBACK_MODEL_SCORER_FIELD,
    RANKING_MODEL_MODE_FIELD,
    RANKING_MODEL_MISSING_TARGETS_FIELD,
    RANKING_MODEL_TARGETS_FIELD,
    RANKING_CANDIDATE_FIELD_WRITES_FIELD,
    RANKING_FUSED_GROUP_FIELD,
    RANKING_FUSED_GROUP_STAGES_FIELD,
    RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD,
    RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD,
];

/// 为阶段明细字典注入阶段名称、类别、分数角色及读写权审计字段。
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

/// 检查阶段明细字典是否与阶段契约规格一致，返回所有违规描述列表。
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
