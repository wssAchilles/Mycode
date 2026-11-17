//! V3 条件期望价值融合、分段保序负分压缩与单层作者多样性衰减计算。

use std::cmp::Ordering;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::weights::{
    V3CandidateScoringInputs, V3ValueModelWeights, sanitize_abs, sanitize_finite,
};

/// V3 价值模型打分拆解明细（便于特征诊断与可观测上报）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct V3ScoreBreakdown {
    /// 10 个正向概率头基础加权分。
    pub positive_score: f64,
    /// 4 个负向反馈概率头惩罚幅值（非负数）。
    pub negative_score: f64,
    /// 连续停留项贡献（`cont_dwell_time`）。
    pub cont_dwell_score: f64,
    /// 两项条件期望乘积贡献（`video_view * expected_dwell_sec` + `click * expected_dwell_sec`）。
    pub conditional_expectation_score: f64,
    /// 互关作者回复加成贡献。
    pub mutual_follow_reply_boost_score: f64,
    /// 未经过偏移压缩前的原始组合净分。
    pub combined_score: f64,
    /// 经过 `offset_score_v3` 分段压缩偏移后的得分。
    pub offset_score: f64,
}

/// 计算单候选 V3 价值模型的各部分明细及 `offset_score_v3` 分数。
pub fn compute_v3_score_breakdown(
    weights: &V3ValueModelWeights,
    candidate: &V3CandidateScoringInputs,
) -> V3ScoreBreakdown {
    let p = &candidate.predictions;
    let vqv_weight = weights.vqv_weight_for(candidate);

    let positive_score = sanitize_finite(
        sanitize_finite(p.click) * sanitize_finite(weights.click)
            + sanitize_finite(p.like) * sanitize_finite(weights.like)
            + sanitize_finite(p.reply) * sanitize_finite(weights.reply)
            + sanitize_finite(p.repost) * sanitize_finite(weights.repost)
            + sanitize_finite(p.quote) * sanitize_finite(weights.quote)
            + sanitize_finite(p.share) * sanitize_finite(weights.share)
            + sanitize_finite(p.dwell) * sanitize_finite(weights.dwell)
            + sanitize_finite(p.video_view) * sanitize_finite(weights.video_view)
            + sanitize_finite(p.video_quality_view) * vqv_weight
            + sanitize_finite(p.follow_author) * sanitize_finite(weights.follow_author),
    );

    // 负向权重兼容负数（-10.0）与正幅度（10.0），统一按惩罚扣减
    let negative_score = sanitize_finite(
        sanitize_finite(p.not_interested) * sanitize_abs(weights.not_interested)
            + sanitize_finite(p.block_author) * sanitize_abs(weights.block_author)
            + sanitize_finite(p.mute_author) * sanitize_abs(weights.mute_author)
            + sanitize_finite(p.report) * sanitize_abs(weights.report),
    );

    let cont_dwell_score = sanitize_finite(
        sanitize_finite(p.cont_dwell_time) * sanitize_finite(weights.cont_dwell_time),
    );

    let expected_dwell = sanitize_finite(p.expected_dwell_sec).max(0.0);
    let video_cond_term = sanitize_finite(p.video_view)
        * expected_dwell
        * sanitize_finite(weights.video_view_expected_dwell_sec);
    let click_cond_term = sanitize_finite(p.click)
        * expected_dwell
        * sanitize_finite(weights.click_expected_dwell_sec);
    let conditional_expectation_score = sanitize_finite(video_cond_term + click_cond_term);

    let mutual_follow_reply_boost_score = if candidate.mutual_reply_boost_eligible() {
        sanitize_finite(
            sanitize_finite(p.reply) * sanitize_finite(weights.mutual_follow_reply_boost),
        )
    } else {
        0.0
    };

    let combined_score = sanitize_finite(
        positive_score - negative_score
            + cont_dwell_score
            + conditional_expectation_score
            + mutual_follow_reply_boost_score,
    );
    let offset_score = offset_score_v3(combined_score, weights);

    V3ScoreBreakdown {
        positive_score,
        negative_score,
        cont_dwell_score,
        conditional_expectation_score,
        mutual_follow_reply_boost_score,
        combined_score,
        offset_score,
    }
}

/// 仅计算 V3 未偏移原始组合净分 `combined_score`。
pub fn compute_v3_combined_score(
    weights: &V3ValueModelWeights,
    candidate: &V3CandidateScoringInputs,
) -> f64 {
    compute_v3_score_breakdown(weights, candidate).combined_score
}

/// 计算单个候选经过 V3 价值融合与精确分段偏移压缩后的加权分。
pub fn compute_v3_value_score(
    weights: &V3ValueModelWeights,
    candidate: &V3CandidateScoringInputs,
) -> f64 {
    compute_v3_score_breakdown(weights, candidate).offset_score
}

/// 对标 `xai-value-model/scoring.rs` 的精确分段保序负分压缩。
///
/// - 当 `combined_score < 0.0` 时，使用总权重和 `total_sum = pos_sum + neg_sum` 作为分母，
///   映射至 `((combined_score + neg_sum) / total_sum * offset).max(0.0)`，严格落于 `[0.0, offset)`；
/// - 当 `combined_score >= 0.0` 时，返回 `combined_score + offset`，严格落于 `[offset, +∞)`；
/// - 当 `total_sum <= 0.0` 或 `offset <= 0.0` 时，回退为 `combined_score.max(0.0)`。
pub fn offset_score_v3(combined_score: f64, weights: &V3ValueModelWeights) -> f64 {
    let combined_score = sanitize_finite(combined_score);
    let total_sum = weights.total_sum();
    let offset = weights.effective_offset();
    if total_sum <= 0.0 || offset <= 0.0 {
        return combined_score.max(0.0);
    }
    if combined_score < 0.0 {
        let neg_sum = weights.negative_sum();
        ((combined_score + neg_sum) / total_sum * offset).max(0.0)
    } else {
        combined_score + offset
    }
}

/// `offset_score_v3` 的严格可逆逆变换，将偏移后分数还原为净分空间以支持探索加成叠加。
pub fn unoffset_score_v3(weighted_score: f64, weights: &V3ValueModelWeights) -> f64 {
    if !weighted_score.is_finite() {
        return 0.0;
    }
    let total_sum = weights.total_sum();
    let offset = weights.effective_offset();
    if total_sum <= 0.0 || offset <= 0.0 {
        return weighted_score;
    }
    if weighted_score < offset {
        let neg_sum = weights.negative_sum();
        weighted_score / offset * total_sum - neg_sum
    } else {
        weighted_score - offset
    }
}

/// 在 `unoffset` 净分空间叠加探索奖励后重新执行 `offset_score_v3` 压缩。
pub fn apply_exploration_bonus_v3(
    weighted_score: f64,
    bonus: f64,
    weights: &V3ValueModelWeights,
) -> f64 {
    let bonus = sanitize_finite(bonus);
    if bonus == 0.0 {
        return sanitize_finite(weighted_score);
    }
    offset_score_v3(unoffset_score_v3(weighted_score, weights) + bonus, weights)
}

/// 计算单层作者多样性衰减乘数：`((1.0 - floor) * decay.powi(k as i32) + floor)`。
///
/// 替代旧版五重叠加作者惩罚；当同一作者在按分数降序池中第 `k` 次出现（`k` 从 0 开始）时，
/// 第 0 条恒为 `1.0`，后续按几何级数平滑衰减并渐近趋近 `floor`。
pub fn author_diversity_multiplier(decay: f64, floor: f64, k: u32) -> f64 {
    let decay = if decay.is_finite() {
        decay.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let floor = if floor.is_finite() {
        floor.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let exponent = k.min(i32::MAX as u32) as i32;
    ((1.0 - floor) * decay.powi(exponent) + floor).clamp(0.0, 1.0)
}

/// V3 批量打分结果（与输入候选顺序一一对应）。
#[derive(Debug, Clone, PartialEq)]
pub struct V3BatchScores {
    /// 融合及探索加成后的基础偏移分数（`author_diversity` 乘数前）。
    pub weighted: Vec<f64>,
    /// 叠加单层作者多样性衰减与 OON 乘数后的最终精排分。
    pub scores: Vec<f64>,
}

/// 执行批量 V3 价值模型打分，含探索加成、单层作者多样性衰减与 OON 调节。
pub fn compute_v3_batch_scores<S: AsRef<str>>(
    weights: &V3ValueModelWeights,
    candidates: &[(S, V3CandidateScoringInputs)],
) -> V3BatchScores {
    let weighted: Vec<f64> = candidates
        .iter()
        .map(|(_, input)| {
            let base = compute_v3_value_score(weights, input);
            apply_exploration_bonus_v3(base, input.author_exploration_bonus, weights)
        })
        .collect();

    let mut indexed: Vec<(usize, f64)> = weighted.iter().copied().enumerate().collect();
    indexed.sort_by(|(_, a), (_, b)| b.partial_cmp(a).unwrap_or(Ordering::Equal));

    let mut author_positions = vec![0u32; candidates.len()];
    let mut author_counts: HashMap<&str, u32> = HashMap::new();
    for (idx, _) in indexed {
        let author = candidates[idx].0.as_ref();
        let k = author_counts.get(author).copied().unwrap_or(0);
        author_positions[idx] = k;
        author_counts.insert(author, k + 1);
    }

    let oon_factor = if weights.oon_weight_factor.is_finite() && weights.oon_weight_factor >= 0.0 {
        weights.oon_weight_factor
    } else {
        1.0
    };

    let scores = weighted
        .iter()
        .zip(candidates)
        .zip(author_positions)
        .map(|((&w, (_, input)), k)| {
            let diversity = if weights.enable_author_diversity {
                author_diversity_multiplier(
                    weights.author_diversity_decay,
                    weights.author_diversity_floor,
                    k,
                )
            } else {
                1.0
            };
            let oon = if input.out_of_network { oon_factor } else { 1.0 };
            sanitize_finite(w * diversity * oon)
        })
        .collect();

    V3BatchScores { weighted, scores }
}
