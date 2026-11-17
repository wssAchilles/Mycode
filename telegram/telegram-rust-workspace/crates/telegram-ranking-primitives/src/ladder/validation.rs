//! 排序阶梯顺序不变量与融合调整组注册表校验。

use super::types::{RankingAdjustmentGroupSpec, RankingStageKind, RankingStageSpec};

/// 校验排序阶段列表是否严格符合 ModelScores -> WeightedScore -> ScoreAdjustment* -> FinalScore -> Metadata* 契约。
pub fn validate_ranking_ladder(specs: &[RankingStageSpec]) -> Result<(), String> {
    if specs.is_empty() {
        return Err("ranking_ladder_empty".to_string());
    }

    if specs[0].kind != RankingStageKind::ModelScores {
        return Err("ranking_ladder_must_start_with_model_scores".to_string());
    }

    let model_score_indices = specs
        .iter()
        .enumerate()
        .filter_map(|(index, spec)| (spec.kind == RankingStageKind::ModelScores).then_some(index))
        .collect::<Vec<_>>();
    if model_score_indices.len() != 1 || model_score_indices[0] != 0 {
        return Err("ranking_ladder_requires_one_leading_model_score_stage".to_string());
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
    let weighted_score_index = weighted_score_indices[0];

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

    for (index, spec) in specs.iter().enumerate() {
        validate_stage_write_contract(index, spec, weighted_score_index, final_score_index)?;
    }

    Ok(())
}

/// 校验单个阶段的写分权限与所在位置窗口是否合法。
fn validate_stage_write_contract(
    index: usize,
    spec: &RankingStageSpec,
    weighted_score_index: usize,
    final_score_index: usize,
) -> Result<(), String> {
    match spec.kind {
        RankingStageKind::ModelScores => {
            if spec.writes_weighted_score || spec.writes_final_score {
                return Err(format!(
                    "ranking_ladder_model_stage_must_not_write_rank_scores: stage={}",
                    spec.stage_name
                ));
            }
        }
        RankingStageKind::WeightedScore => {
            if !spec.writes_weighted_score || spec.writes_final_score {
                return Err(format!(
                    "ranking_ladder_weighted_stage_must_only_write_weighted_score: stage={}",
                    spec.stage_name
                ));
            }
        }
        RankingStageKind::ScoreAdjustment => {
            if index <= weighted_score_index || index >= final_score_index {
                return Err(format!(
                    "ranking_ladder_adjustment_must_be_between_weighted_and_final: stage={}",
                    spec.stage_name
                ));
            }
            if !spec.writes_weighted_score || spec.writes_final_score {
                return Err(format!(
                    "ranking_ladder_adjustment_must_only_write_weighted_score: stage={}",
                    spec.stage_name
                ));
            }
        }
        RankingStageKind::FinalScore => {
            if spec.writes_weighted_score || !spec.writes_final_score {
                return Err(format!(
                    "ranking_ladder_final_stage_must_only_write_final_score: stage={}",
                    spec.stage_name
                ));
            }
        }
        RankingStageKind::Metadata => {
            if spec.writes_weighted_score || spec.writes_final_score {
                return Err(format!(
                    "ranking_ladder_metadata_stage_must_not_write_scores: stage={}",
                    spec.stage_name
                ));
            }
        }
    }
    Ok(())
}

/// 校验融合调整组注册表：组名非空、不重名、阶段不重复、均属于 `ScoreAdjustment` 且在阶梯中连续排列。
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
