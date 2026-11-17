//! 冷启动 Beta-Thompson Sampling 提权打分器（对标 `x-algorithm/home-mixer/scorers/author_cold_start.rs`）。
//! 基于零外部重依赖的确定性 Gamma/Beta 采样器（Marsaglia-Tsang + Ahrens-Dieter），
//! 对符合条件的冷启动候选执行 `Beta(0.75 + x, 49.25 + n - x)` 后验采样，
//! 选取样本最高的 `Top-K` (`ts_top_k = 5`)，再从中挑选原始基础分最高者锚定提权至目标槽位 `[slot_min, slot_max)`。

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::clock::ranking_now;
use crate::pipeline::local::context::{space_feed_experiment_flag, space_feed_experiment_number};

use super::helpers::merge_breakdown;

/// 默认先验参数 `alpha0 = 0.75`（对标 `ColdStartBetaAlpha0`）。
pub const DEFAULT_COLD_START_BETA_ALPHA0: f64 = 0.75;
/// 默认先验参数 `beta0 = 49.25`（对标 `ColdStartBetaBeta0`）。
pub const DEFAULT_COLD_START_BETA_BETA0: f64 = 49.25;
/// 默认曝光缩放系数 `scale = 1.0`。
pub const DEFAULT_COLD_START_IMPRESSION_SCALE: f64 = 1.0;
/// 默认冷启动曝光门槛阈值（低于此值视作低曝光冷启候选）。
pub const DEFAULT_COLD_START_IMPRESSION_THRESHOLD: f64 = 100.0;
/// 默认非零分排名比例上限（仅允许前 50% 候选参与冷启动提权，防止长尾低质帖滥用）。
pub const DEFAULT_COLD_START_MAX_POSITION_RATIO: f64 = 0.5;
/// 默认冷启动插入目标槽位下界（含）。
pub const DEFAULT_COLD_START_SLOT_MIN: usize = 3;
/// 默认冷启动插入目标槽位上界（不含）。
pub const DEFAULT_COLD_START_SLOT_MAX: usize = 8;
/// 默认 Thompson Sampling 筛选 Top-K 数量（从 Beta 样本 Top-5 中再按原始分选优）。
pub const DEFAULT_COLD_START_TS_TOP_K: usize = 5;

/// 确定性 SplitMix64 伪随机数生成器，保障同一请求+候选的可复现性。
#[derive(Debug, Clone)]
pub struct DeterministicRng {
    state: u64,
}

impl DeterministicRng {
    /// 使用多段字符串材料构建确定性种子（FNV-1a 64-bit 混合分隔符）。
    pub fn from_seed_parts(parts: &[&str]) -> Self {
        const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
        const FNV_PRIME: u64 = 0x0100_0000_01b3;

        let mut hash = FNV_OFFSET;
        for part in parts {
            for &byte in part.as_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(FNV_PRIME);
            }
            // 分隔符避免 `("ab", "c")` 与 `("a", "bc")` 产生哈希碰撞
            hash ^= 0xff;
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        if hash == 0 {
            hash = 0x9e37_79b9_7f4a_7c15;
        }
        Self { state: hash }
    }

    /// 推进 SplitMix64 状态并返回下一个 64 位无符号整数。
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// 返回开闭区间 `(0.0, 1.0]` 上的均匀分布随机浮点（严格大于 `0.0`，规避 `ln(0)` 异常）。
    #[inline]
    pub fn next_open_unit(&mut self) -> f64 {
        let bits53 = self.next_u64() >> 11; // 取高 53 位，范围 [0, 2^53 - 1]
        ((bits53 + 1) as f64) / ((1_u64 << 53) as f64)
    }

    /// 在区间 `[lo, hi)` 上无偏均匀抽取一个索引（要求 `lo < hi`）。
    #[inline]
    pub fn next_range_usize(&mut self, lo: usize, hi: usize) -> usize {
        debug_assert!(lo < hi);
        let span = (hi - lo) as u128;
        let scaled = (u128::from(self.next_u64()) * span) >> 64;
        lo + (scaled as usize)
    }

    /// 使用 Box-Muller 变换采样标准正态分布 `N(0, 1)`。
    #[inline]
    pub fn sample_standard_normal(&mut self) -> f64 {
        let u1 = self.next_open_unit();
        let u2 = self.next_open_unit();
        let radius = (-2.0 * u1.ln()).sqrt();
        let theta = 2.0 * std::f64::consts::PI * u2;
        let z = radius * theta.cos();
        if z.is_finite() { z } else { 0.0 }
    }

    /// 使用 Marsaglia & Tsang (2000) + Ahrens-Dieter 变换采样 `Gamma(alpha, 1)`。
    pub fn sample_gamma(&mut self, alpha: f64) -> Option<f64> {
        if !alpha.is_finite() || alpha <= 0.0 {
            return None;
        }
        // 极小形状参数直接指数缩放保护，避免 1/alpha 溢出
        if alpha < 1e-6 {
            let u = self.next_open_unit();
            let log_g = u.ln() / alpha;
            let val = if log_g < -700.0 {
                f64::MIN_POSITIVE
            } else {
                log_g.exp().max(f64::MIN_POSITIVE)
            };
            return Some(val);
        }

        if alpha < 1.0 {
            // Ahrens-Dieter: Gamma(alpha) = Gamma(alpha + 1) * U^(1 / alpha)
            let g_plus_one = self.sample_gamma_ge_one(alpha + 1.0)?;
            let u = self.next_open_unit();
            let log_scale = u.ln() / alpha;
            let scaled = if log_scale < -700.0 {
                g_plus_one * 1e-300
            } else {
                g_plus_one * log_scale.exp()
            };
            return Some(scaled.max(f64::MIN_POSITIVE));
        }

        self.sample_gamma_ge_one(alpha)
    }

    /// 当 `alpha >= 1.0` 时执行 Marsaglia & Tsang (2000) 接受-拒绝采样。
    fn sample_gamma_ge_one(&mut self, alpha: f64) -> Option<f64> {
        let d = alpha - 1.0 / 3.0;
        let c = 1.0 / (9.0 * d).sqrt();

        for _ in 0..2048 {
            let z = self.sample_standard_normal();
            let x = 1.0 + c * z;
            if x <= 0.0 {
                continue;
            }
            let v = x * x * x;
            let u = self.next_open_unit();
            let z2 = z * z;
            if u < 1.0 - 0.0331 * z2 * z2 {
                let sample = d * v;
                if sample.is_finite() && sample > 0.0 {
                    return Some(sample);
                }
            }
            if u.ln() < 0.5 * z2 + d * (1.0 - v + v.ln()) {
                let sample = d * v;
                if sample.is_finite() && sample > 0.0 {
                    return Some(sample);
                }
            }
        }

        // 理论接受率 > 95%，极小概率触及迭代上限时安全回退均值
        Some(alpha)
    }
}

/// 基于已知随机数生成器执行 `Beta(alpha, beta)` 采样，对极大/异常参数保持数值有限性。
pub fn sample_beta_with_rng(alpha: f64, beta: f64, rng: &mut DeterministicRng) -> f64 {
    let a = if alpha.is_finite() {
        alpha.max(1e-6)
    } else {
        1e12
    };
    let b = if beta.is_finite() {
        beta.max(1e-6)
    } else {
        1e12
    };

    // 当参数量级极大（如接近 f64::MAX）时，先等比压缩防止 Gamma 乘法溢出，保留后验均值
    let max_ab = a.max(b);
    if max_ab > 1e12 {
        return (a / (a + b)).clamp(0.0, 1.0);
    }

    let Some(gx) = rng.sample_gamma(a) else {
        return (a / (a + b)).clamp(0.0, 1.0);
    };
    let Some(gy) = rng.sample_gamma(b) else {
        return (a / (a + b)).clamp(0.0, 1.0);
    };
    let sum = gx + gy;
    if sum <= 0.0 || !sum.is_finite() {
        (a / (a + b)).clamp(0.0, 1.0)
    } else {
        (gx / sum).clamp(0.0, 1.0)
    }
}

/// 基于种子字符串序列执行完全可复现的 `Beta(alpha, beta)` 采样。
pub fn sample_beta_deterministic(alpha: f64, beta: f64, seed_parts: &[&str]) -> f64 {
    let mut rng = DeterministicRng::from_seed_parts(seed_parts);
    sample_beta_with_rng(alpha, beta, &mut rng)
}

/// 冷启动 Beta-Thompson Sampling 配置项。
#[derive(Debug, Clone)]
pub struct ColdStartTsConfig {
    pub enabled: bool,
    pub beta_alpha0: f64,
    pub beta_beta0: f64,
    pub impression_scale: f64,
    pub impression_threshold: f64,
    pub max_position_ratio: f64,
    pub slot_min: usize,
    pub slot_max: usize,
    pub ts_top_k: usize,
    pub max_post_age_secs: Option<u64>,
}

impl Default for ColdStartTsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            beta_alpha0: DEFAULT_COLD_START_BETA_ALPHA0,
            beta_beta0: DEFAULT_COLD_START_BETA_BETA0,
            impression_scale: DEFAULT_COLD_START_IMPRESSION_SCALE,
            impression_threshold: DEFAULT_COLD_START_IMPRESSION_THRESHOLD,
            max_position_ratio: DEFAULT_COLD_START_MAX_POSITION_RATIO,
            slot_min: DEFAULT_COLD_START_SLOT_MIN,
            slot_max: DEFAULT_COLD_START_SLOT_MAX,
            ts_top_k: DEFAULT_COLD_START_TS_TOP_K,
            max_post_age_secs: None,
        }
    }
}

impl ColdStartTsConfig {
    /// 从查询特性开关与实验配置读取冷启动 TS 参数。
    pub fn from_query(query: &RecommendationQueryPayload) -> Self {
        let mut cfg = Self::default();

        if let Some(&flag) = query
            .feature_switches
            .get("enable_cold_start_thompson_sampling")
        {
            cfg.enabled = flag;
        } else {
            cfg.enabled =
                space_feed_experiment_flag(query, "enable_cold_start_thompson_sampling", true);
        }

        let alpha0 = space_feed_experiment_number(
            query,
            "cold_start_beta_alpha0",
            DEFAULT_COLD_START_BETA_ALPHA0,
        );
        if alpha0.is_finite() && alpha0 > 0.0 {
            cfg.beta_alpha0 = alpha0;
        }

        let beta0 = space_feed_experiment_number(
            query,
            "cold_start_beta_beta0",
            DEFAULT_COLD_START_BETA_BETA0,
        );
        if beta0.is_finite() && beta0 > 0.0 {
            cfg.beta_beta0 = beta0;
        }

        let scale = space_feed_experiment_number(
            query,
            "cold_start_impression_scale",
            DEFAULT_COLD_START_IMPRESSION_SCALE,
        );
        if scale.is_finite() && scale >= 0.0 {
            cfg.impression_scale = scale;
        }

        let threshold = space_feed_experiment_number(
            query,
            "cold_start_impression_threshold",
            DEFAULT_COLD_START_IMPRESSION_THRESHOLD,
        );
        if threshold.is_finite() && threshold >= 0.0 {
            cfg.impression_threshold = threshold;
        }

        let ratio = space_feed_experiment_number(
            query,
            "low_impressions_max_boost_position_ratio",
            DEFAULT_COLD_START_MAX_POSITION_RATIO,
        );
        if ratio.is_finite() && ratio >= 0.0 {
            cfg.max_position_ratio = ratio.clamp(0.0, 1.0);
        }

        let slot_min = space_feed_experiment_number(
            query,
            "cold_start_slot_min",
            DEFAULT_COLD_START_SLOT_MIN as f64,
        );
        if slot_min.is_finite() && slot_min >= 0.0 {
            cfg.slot_min = slot_min.round() as usize;
        }

        let slot_max = space_feed_experiment_number(
            query,
            "cold_start_slot_max",
            DEFAULT_COLD_START_SLOT_MAX as f64,
        );
        if slot_max.is_finite() && slot_max >= 0.0 {
            cfg.slot_max = slot_max.round() as usize;
        }

        let ts_top_k = space_feed_experiment_number(
            query,
            "cold_start_ts_top_k",
            DEFAULT_COLD_START_TS_TOP_K as f64,
        );
        if ts_top_k.is_finite() && ts_top_k >= 0.0 {
            cfg.ts_top_k = ts_top_k.round() as usize;
        }

        let max_age = space_feed_experiment_number(query, "cold_start_max_post_age_secs", f64::NAN);
        if max_age.is_finite() && max_age > 0.0 {
            cfg.max_post_age_secs = Some(max_age.round() as u64);
        }

        cfg
    }
}

/// 冷启动 Beta-TS 执行结果。
#[derive(Debug, Clone)]
pub struct ColdStartTsOutcome {
    pub scores: Vec<f64>,
    pub eligible_indices: Vec<usize>,
    pub sampled_betas: HashMap<usize, f64>,
    pub lifted_index: Option<usize>,
    pub target_rank: Option<usize>,
    pub target_score: Option<f64>,
}

/// 计算非零有限基础分在降序序列中的排名位次（对标 `author_cold_start.rs::positions_among_nonzero`）。
pub fn positions_among_nonzero(scores: &[f64]) -> (Vec<usize>, usize) {
    let mut order: Vec<usize> = scores
        .iter()
        .enumerate()
        .filter(|(_, s)| s.is_finite() && **s != 0.0)
        .map(|(i, _)| i)
        .collect();
    order.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]).then(a.cmp(&b)));
    let nonzero = order.len();
    let mut positions = vec![usize::MAX; scores.len()];
    for (position, &i) in order.iter().enumerate() {
        positions[i] = position;
    }
    (positions, nonzero)
}

/// 检查候选是否满足冷启动基础资格：非回复、非转发、曝光量低于阈值、安全无明显负反馈风险。
fn is_cold_start_base_eligible(
    candidate: &RecommendationCandidatePayload,
    score: f64,
    cfg: &ColdStartTsConfig,
    now: DateTime<Utc>,
) -> bool {
    if !score.is_finite() || score <= 0.0 {
        return false;
    }
    if candidate.is_reply || candidate.reply_to_post_id.is_some() {
        return false;
    }
    if candidate.is_repost || candidate.original_post_id.is_some() {
        return false;
    }
    if candidate.is_nsfw == Some(true) || candidate.vf_result.as_ref().is_some_and(|v| !v.safe) {
        return false;
    }
    if let Some(phoenix) = candidate.phoenix_scores.as_ref()
        && (phoenix.not_interested_score.unwrap_or_default() >= 0.5
            || phoenix.report_score.unwrap_or_default() >= 0.2
            || phoenix.block_author_score.unwrap_or_default() >= 0.3)
    {
        return false;
    }
    if !candidate
        .view_count
        .is_some_and(|imp| imp.is_finite() && imp >= 0.0 && imp < cfg.impression_threshold)
    {
        return false;
    }
    if let Some(max_age_secs) = cfg.max_post_age_secs {
        let age_secs = now
            .signed_duration_since(candidate.created_at)
            .num_seconds();
        if age_secs > max_age_secs as i64 {
            return false;
        }
    }
    true
}

/// 从目标槽位区间 `[slot_min, slot_max)` 确定性抽取目标锚定排名位次及基准分数。
fn cold_start_target_slot(
    query: &RecommendationQueryPayload,
    cfg: &ColdStartTsConfig,
    scores: &[f64],
) -> Option<(usize, f64)> {
    let mut ranked: Vec<f64> = scores
        .iter()
        .copied()
        .map(|s| if s.is_finite() { s } else { 0.0 })
        .collect();
    ranked.sort_by(|a, b| b.total_cmp(a));

    let hi = cfg.slot_max.min(ranked.len());
    let lo = cfg.slot_min.min(hi);
    if lo >= hi {
        return None;
    }

    let mut rng = DeterministicRng::from_seed_parts(&[
        &query.request_id,
        &query.decision_id,
        &query.user_id,
        "cold_start_target_slot",
    ]);
    let rank = rng.next_range_usize(lo, hi);
    Some((rank, ranked[rank]))
}

/// 按基础分选出最高分候选下标（分数相等取下标小者）。
fn pick_by_base_score(eligible: &[usize], scores: &[f64]) -> Option<usize> {
    eligible
        .iter()
        .copied()
        .max_by(|&a, &b| scores[a].total_cmp(&scores[b]).then(b.cmp(&a)))
}

/// 对候选集与基础分数向量执行完整的 Beta-Thompson Sampling 冷启动选优与槽位锚定提权。
pub fn apply_cold_start_ts(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    scores: &[f64],
    cfg: &ColdStartTsConfig,
) -> ColdStartTsOutcome {
    if !cfg.enabled || candidates.is_empty() || candidates.len() != scores.len() {
        return ColdStartTsOutcome {
            scores: scores.to_vec(),
            eligible_indices: Vec::new(),
            sampled_betas: HashMap::new(),
            lifted_index: None,
            target_rank: None,
            target_score: None,
        };
    }

    let Some((target_rank, target_score)) = cold_start_target_slot(query, cfg, scores) else {
        return ColdStartTsOutcome {
            scores: scores.to_vec(),
            eligible_indices: Vec::new(),
            sampled_betas: HashMap::new(),
            lifted_index: None,
            target_rank: None,
            target_score: None,
        };
    };

    let now = ranking_now();
    let (positions, nonzero) = positions_among_nonzero(scores);
    let max_cold_start_slot = (cfg.max_position_ratio * nonzero as f64) as usize;

    let eligible: Vec<usize> = candidates
        .iter()
        .enumerate()
        .filter(|(i, c)| {
            positions[*i] < max_cold_start_slot
                && is_cold_start_base_eligible(c, scores[*i], cfg, now)
        })
        .map(|(i, _)| i)
        .collect();

    if eligible.is_empty() {
        return ColdStartTsOutcome {
            scores: scores.to_vec(),
            eligible_indices: eligible,
            sampled_betas: HashMap::new(),
            lifted_index: None,
            target_rank: Some(target_rank),
            target_score: Some(target_score),
        };
    }

    let mut sampled_betas = HashMap::with_capacity(eligible.len());
    let (best_idx, _) = if cfg.ts_top_k == 0 || cfg.beta_alpha0 <= 0.0 || cfg.beta_beta0 <= 0.0 {
        (pick_by_base_score(&eligible, scores), ())
    } else {
        let mut sampled: Vec<(usize, f64)> = eligible
            .iter()
            .map(|&idx| {
                let candidate = &candidates[idx];
                let n = (cfg.impression_scale * candidate.view_count.unwrap_or(0.0)).max(0.0);
                let x = candidate.like_count.unwrap_or(0.0).max(0.0).min(n);
                let alpha = cfg.beta_alpha0 + x;
                let beta = cfg.beta_beta0 + (n - x).max(0.0);
                let beta_val = sample_beta_deterministic(
                    alpha,
                    beta,
                    &[
                        &query.request_id,
                        &query.decision_id,
                        &query.user_id,
                        &candidate.post_id,
                        &candidate.author_id,
                        "cold_start_ts",
                    ],
                );
                sampled_betas.insert(idx, beta_val);
                (idx, beta_val)
            })
            .collect();

        // 先按 Beta 样本值降序筛选 Top-K（默认 Top-5）
        sampled.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let k = cfg.ts_top_k.min(sampled.len());
        // 再从 Beta Top-K 中挑出原始基础分最高者（基础分相同取原下标更靠前者）
        let best = sampled[..k]
            .iter()
            .map(|(idx, _)| *idx)
            .max_by(|&a, &b| scores[a].total_cmp(&scores[b]).then(b.cmp(&a)));
        (best, ())
    };

    let Some(best_idx) = best_idx else {
        return ColdStartTsOutcome {
            scores: scores.to_vec(),
            eligible_indices: eligible,
            sampled_betas,
            lifted_index: None,
            target_rank: Some(target_rank),
            target_score: Some(target_score),
        };
    };

    let mut effective = scores.to_vec();
    let lifted = effective[best_idx].max(target_score);
    effective[best_idx] = if lifted.is_finite() {
        lifted
    } else {
        effective[best_idx]
    };

    ColdStartTsOutcome {
        scores: effective,
        eligible_indices: eligible,
        sampled_betas,
        lifted_index: Some(best_idx),
        target_rank: Some(target_rank),
        target_score: Some(target_score),
    }
}

/// 在线评分链调用入口：直接基于 `weighted_score` 执行冷启动 Beta-TS 提权并回写 `weighted_score` / `pipeline_score` / `score_breakdown`。
pub(super) fn apply_cold_start_ts_for_query(
    query: &RecommendationQueryPayload,
    candidates: &mut [RecommendationCandidatePayload],
) -> ColdStartTsOutcome {
    let cfg = ColdStartTsConfig::from_query(query);
    let base_scores: Vec<f64> = candidates
        .iter()
        .map(|c| c.weighted_score.unwrap_or_else(|| c.primary_score()))
        .collect();

    let outcome = apply_cold_start_ts(query, candidates, &base_scores, &cfg);

    for &idx in &outcome.eligible_indices {
        merge_breakdown(&mut candidates[idx], "coldStartTsEligible", 1.0);
        if let Some(&beta_val) = outcome.sampled_betas.get(&idx) {
            merge_breakdown(&mut candidates[idx], "coldStartTsBetaSample", beta_val);
        }
    }

    if let Some(best_idx) = outcome.lifted_index {
        let new_score = outcome.scores[best_idx];
        if new_score.is_finite() && new_score > base_scores[best_idx] {
            candidates[best_idx].weighted_score = Some(new_score);
            candidates[best_idx].pipeline_score = Some(new_score);
        }
        merge_breakdown(&mut candidates[best_idx], "coldStartTsSelected", 1.0);
        if let Some(rank) = outcome.target_rank {
            merge_breakdown(
                &mut candidates[best_idx],
                "coldStartTsTargetRank",
                rank as f64,
            );
        }
        if let Some(target_score) = outcome.target_score {
            merge_breakdown(
                &mut candidates[best_idx],
                "coldStartTsTargetScore",
                target_score,
            );
        }
        merge_breakdown(
            &mut candidates[best_idx],
            "coldStartTsLiftedScore",
            new_score,
        );
    }

    outcome
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::contracts::{
        PhoenixScoresPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
    };

    use super::{
        ColdStartTsConfig, DeterministicRng, apply_cold_start_ts, apply_cold_start_ts_for_query,
        positions_among_nonzero, sample_beta_deterministic, sample_beta_with_rng,
    };

    fn make_query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-cold-start-ts".to_string(),
            decision_id: "00000000-0000-4000-8000-000000000011".to_string(),
            user_id: "viewer-cold-ts".to_string(),
            limit: 10,
            ..Default::default()
        }
    }

    fn make_candidate(
        post_id: &str,
        view_count: Option<f64>,
        like_count: Option<f64>,
        weighted_score: f64,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            author_id: format!("author-{post_id}"),
            content: "cold start ts post".to_string(),
            created_at: Utc::now(),
            view_count,
            like_count,
            weighted_score: Some(weighted_score),
            pipeline_score: Some(weighted_score),
            ..Default::default()
        }
    }

    #[test]
    fn beta_sampler_is_deterministic_and_matches_theoretical_mean_and_variance() {
        let s1 = sample_beta_deterministic(0.75, 49.25, &["req-1", "post-1"]);
        let s2 = sample_beta_deterministic(0.75, 49.25, &["req-1", "post-1"]);
        assert_eq!(s1, s2);
        assert!((0.0..=1.0).contains(&s1));

        // 对 Beta(0.75 + 10, 49.25 + 40) = Beta(10.75, 89.25) 统计大样本均值与方差
        let alpha = 10.75_f64;
        let beta = 89.25_f64;
        let expected_mean = alpha / (alpha + beta); // 0.1075
        let expected_var = (alpha * beta) / ((alpha + beta).powi(2) * (alpha + beta + 1.0));

        let mut rng = DeterministicRng::from_seed_parts(&["stat-check"]);
        let n = 8000;
        let samples: Vec<f64> = (0..n)
            .map(|_| sample_beta_with_rng(alpha, beta, &mut rng))
            .collect();
        let mean = samples.iter().sum::<f64>() / n as f64;
        let var = samples.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n as f64;

        assert!(
            (mean - expected_mean).abs() < 0.005,
            "mean={mean} expected={expected_mean}"
        );
        assert!(
            (var - expected_var).abs() < 0.0005,
            "var={var} expected={expected_var}"
        );
    }

    #[test]
    fn filters_replies_reposts_high_impressions_and_out_of_ratio_positions() {
        let query = make_query();
        let cfg = ColdStartTsConfig {
            impression_threshold: 100.0,
            max_position_ratio: 0.6, // 5 个非零候选中允许前 3 名（rank 0, 1, 2）
            slot_min: 0,
            slot_max: 2,
            ts_top_k: 5,
            ..Default::default()
        };

        let mut reply = make_candidate("c0-reply", Some(5.0), Some(1.0), 10.0);
        reply.is_reply = true;

        let mut repost = make_candidate("c1-repost", Some(5.0), Some(1.0), 9.0);
        repost.is_repost = true;

        let eligible = make_candidate("c2-eligible", Some(10.0), Some(3.0), 8.0);
        let high_imp = make_candidate("c3-high-imp", Some(500.0), Some(50.0), 7.0);
        let tail_low = make_candidate("c4-tail-low", Some(2.0), Some(1.0), 3.0);
        let tail_zero = make_candidate("c5-zero", Some(1.0), Some(0.0), 0.0);

        let candidates = vec![reply, repost, eligible, high_imp, tail_low, tail_zero];
        let scores = vec![10.0, 9.0, 8.0, 7.0, 3.0, 0.0];

        let (positions, nonzero) = positions_among_nonzero(&scores);
        assert_eq!(nonzero, 5);
        assert_eq!(positions[5], usize::MAX);

        let outcome = apply_cold_start_ts(&query, &candidates, &scores, &cfg);
        assert_eq!(outcome.eligible_indices, vec![2]);
        assert_eq!(outcome.lifted_index, Some(2));
        // 槽位 [0, 2) 对应 ranked[0]=10.0 或 ranked[1]=9.0，均大于原分 8.0
        assert!(outcome.scores[2] >= 9.0);
    }

    #[test]
    fn picks_highest_base_score_within_top_5_beta_samples_and_lifts_into_target_slot() {
        let query = make_query();
        let cfg = ColdStartTsConfig {
            impression_threshold: 100.0,
            max_position_ratio: 1.0,
            slot_min: 0,
            slot_max: 2,
            ts_top_k: 5,
            ..Default::default()
        };

        // 构造 8 个候选：前 2 名高曝光高分，后 6 名冷启低曝光且全都在 Top-5 竞争
        let mut candidates = vec![
            make_candidate("top-0", Some(500.0), Some(50.0), 100.0),
            make_candidate("top-1", Some(400.0), Some(40.0), 90.0),
        ];
        for i in 0..6 {
            candidates.push(make_candidate(
                &format!("cold-{i}"),
                Some(20.0),
                Some(2.0),
                10.0 + i as f64,
            ));
        }

        let scores: Vec<f64> = candidates
            .iter()
            .map(|c| c.weighted_score.unwrap())
            .collect();
        let outcome = apply_cold_start_ts(&query, &candidates, &scores, &cfg);

        assert_eq!(outcome.eligible_indices.len(), 6);
        let best_idx = outcome.lifted_index.expect("one candidate lifted");
        // 验证选中者一定属于 Beta 采样 Top-5 之一，且是在该 Top-5 内基础分最高者
        let mut by_beta: Vec<(usize, f64)> = outcome
            .sampled_betas
            .iter()
            .map(|(&idx, &val)| (idx, val))
            .collect();
        by_beta.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let top5_indices: Vec<usize> = by_beta[..5].iter().map(|(i, _)| *i).collect();
        assert!(top5_indices.contains(&best_idx));
        let max_score_in_top5 = top5_indices
            .iter()
            .map(|&i| scores[i])
            .fold(f64::NEG_INFINITY, f64::max);
        assert_eq!(scores[best_idx], max_score_in_top5);
        assert!(outcome.scores[best_idx] >= 90.0);

        // 也验证在线 mutate 接口正确更新 weighted_score / pipeline_score / breakdown
        let mut query_override = query.clone();
        query_override.experiment_context = None;
        // 通过 apply_cold_start_ts_for_query 测试写回字段
        candidates.push(make_candidate("cold-extra", Some(5.0), Some(1.0), 25.0));
        let mut negative_guard = make_candidate("cold-neg", Some(5.0), Some(1.0), 30.0);
        negative_guard.phoenix_scores = Some(PhoenixScoresPayload {
            not_interested_score: Some(0.9),
            ..Default::default()
        });
        candidates.push(negative_guard);
        let out = apply_cold_start_ts_for_query(&query_override, &mut candidates);
        if let Some(lifted) = out.lifted_index {
            assert_ne!(candidates[lifted].post_id, "cold-neg");
            assert_eq!(
                candidates[lifted]
                    .score_breakdown
                    .as_ref()
                    .and_then(|b| b.get("coldStartTsSelected")),
                Some(&1.0)
            );
        }
    }

    #[test]
    fn ts_top_k_zero_falls_back_to_argmax_base_score() {
        let query = make_query();
        let cfg = ColdStartTsConfig {
            ts_top_k: 0,
            max_position_ratio: 1.0,
            slot_min: 0,
            slot_max: 1,
            ..Default::default()
        };
        let candidates = vec![
            make_candidate("top", Some(300.0), Some(20.0), 50.0),
            make_candidate("cold-low", Some(5.0), Some(0.0), 10.0),
            make_candidate("cold-high", Some(8.0), Some(1.0), 20.0),
        ];
        let scores = vec![50.0, 10.0, 20.0];
        let outcome = apply_cold_start_ts(&query, &candidates, &scores, &cfg);
        assert_eq!(outcome.lifted_index, Some(2));
        assert_eq!(outcome.scores[2], 50.0);
    }
}
