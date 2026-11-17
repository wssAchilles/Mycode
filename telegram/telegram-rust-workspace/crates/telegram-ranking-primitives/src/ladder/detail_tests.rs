//! 排序阶段明细字段与审计契约单元测试。

use super::{
    RANKING_CANDIDATE_FIELD_WRITES_FIELD, RANKING_FALLBACK_MODEL_SCORER_FIELD,
    RANKING_FUSED_GROUP_FIELD, RANKING_FUSED_GROUP_STAGES_FIELD,
    RANKING_FUSED_STAGE_APPLIED_COUNT_FIELD, RANKING_FUSED_STAGE_SKIPPED_REASON_FIELD,
    RANKING_LADDER_VERSION, RANKING_SCORE_ROLE_FIELD, RANKING_SCORE_ROLE_VERSION,
    RANKING_STAGE_DETAIL_FIELDS, RANKING_STAGE_KIND_FIELD, RANKING_STAGE_NAME_FIELD,
    RANKING_WRITES_FINAL_SCORE_FIELD, RANKING_WRITES_WEIGHTED_SCORE_FIELD, RankingStageKind,
    RankingStageSpec, annotate_ranking_stage_detail, ranking_stage_detail_contract_violations,
};

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
