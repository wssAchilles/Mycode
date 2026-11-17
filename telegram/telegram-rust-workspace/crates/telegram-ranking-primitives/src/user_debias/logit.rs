//! Logit 空间用户消偏重中心化数学原语。

/// Logit 重中心化概率安全下界（对应 `1.0 - 1e-7` 上界），避免 `ln(0)` 或除零。
pub const DEFAULT_DEBIAS_PROB_FLOOR: f64 = 1e-7;
/// Logit 偏置默认裁剪上限。
pub const DEFAULT_DEBIAS_CLIP_LOGIT: f64 = 2.0;

/// 在 Logit 空间对预测概率执行重中心化消偏：`sigmoid(logit(prob) - clamp(bias, -clip, clip))`。
///
/// 当用户历史上相对全局更易发生正反馈（`bias > 0`）时，扣除用户基线偏置使真实内容吸引力可跨用户可比；
/// 若输入概率落在极端边界 `(0, 1e-7)` / `(1-1e-7, 1)` 外或参数非有限，直接安全返回原概率。
pub fn apply_logit_debias(prob: f64, bias: f64, clip: f64) -> f64 {
    if !prob.is_finite() {
        return 0.0;
    }
    if !(DEFAULT_DEBIAS_PROB_FLOOR..=1.0 - DEFAULT_DEBIAS_PROB_FLOOR).contains(&prob) {
        return prob.clamp(0.0, 1.0);
    }
    if !bias.is_finite() || !clip.is_finite() || clip <= 0.0 {
        return prob;
    }
    let clamped_bias = bias.clamp(-clip, clip);
    let logit = (prob / (1.0 - prob)).ln();
    let debiased_logit = logit - clamped_bias;
    let debiased = 1.0 / (1.0 + (-debiased_logit).exp());
    if debiased.is_finite() {
        debiased.clamp(DEFAULT_DEBIAS_PROB_FLOOR, 1.0 - DEFAULT_DEBIAS_PROB_FLOOR)
    } else {
        prob
    }
}

/// 带平滑权重 `alpha in [0.0, 1.0]` 的概率重中心化函数（对标 `vm-ranker/scoring/debias.rs`）。
pub fn recenter_probability(prob: f64, bias: f64, alpha: f64, clip: f64) -> f64 {
    if !alpha.is_finite() || alpha <= 0.0 {
        return prob;
    }
    let alpha = alpha.clamp(0.0, 1.0);
    let debiased = apply_logit_debias(prob, bias, clip);
    if !debiased.is_finite()
        || !(DEFAULT_DEBIAS_PROB_FLOOR..=1.0 - DEFAULT_DEBIAS_PROB_FLOOR).contains(&prob)
    {
        return debiased;
    }
    ((1.0 - alpha) * prob + alpha * debiased)
        .clamp(DEFAULT_DEBIAS_PROB_FLOOR, 1.0 - DEFAULT_DEBIAS_PROB_FLOOR)
}
