use crate::contracts::RecommendationQueryPayload;
use crate::pipeline::local::context::space_feed_experiment_number;

/// DPP 滑窗衰减与前缀排斥配置。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SlidingWindow {
    /// 回溯窗口长度（最近已展示或已选出的候选槽位数）。
    pub size: usize,
    /// 距离衰减半衰期（每间隔该步数，排斥权重衰减为一半）。
    pub half_distance: f64,
    /// 相同 Semantic ID L1/L2 前缀触发的额外惩罚系数。
    pub sid_lambda: f64,
}

impl Default for SlidingWindow {
    fn default() -> Self {
        Self {
            size: 10,
            half_distance: 3.0,
            sid_lambda: 0.15,
        }
    }
}

/// DPP 多样性重排核心配置（对齐 x-algorithm/vm-ranker/dpp.rs）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DppConfig {
    /// 目标选出条目数 Top-K。
    pub top_k: usize,
    /// 质量与多样性权衡参数 theta ∈ [0, 1)，对应核缩放系数 alpha = theta / (2 * (1 - theta))。
    pub theta: f64,
    /// 参与 DPP 核矩阵或滑窗计算的最大候选截断名次（默认 150，确保计算开销亚毫秒级）。
    pub max_selected_rank: usize,
    /// 是否在非滑窗模式下按贪心选出顺序输出（默认 false；启用滑窗时自动按贪心顺序输出）。
    pub greedy_order: bool,
    /// 可选滑动窗口多样性排斥配置。
    pub window: Option<SlidingWindow>,
}

impl Default for DppConfig {
    fn default() -> Self {
        Self {
            top_k: 50,
            theta: 0.65,
            max_selected_rank: 150,
            greedy_order: false,
            window: Some(SlidingWindow {
                size: 10,
                half_distance: 3.0,
                sid_lambda: 0.15,
            }),
        }
    }
}

impl DppConfig {
    /// 以指定 `top_k` 和默认 V3 超参构造配置。
    pub fn with_top_k(top_k: usize) -> Self {
        Self {
            top_k,
            ..Self::default()
        }
    }

    /// 结合请求上下文实验参数与开关生成当前请求对应的 DPP 配置。
    pub fn for_query(query: &RecommendationQueryPayload, top_k: usize) -> Self {
        let mut cfg = Self::with_top_k(top_k);

        let theta = space_feed_experiment_number(query, "dpp_theta", cfg.theta);
        if theta.is_finite() {
            cfg.theta = theta.clamp(0.0, 0.999);
        }

        let max_rank = space_feed_experiment_number(
            query,
            "dpp_max_selected_rank",
            cfg.max_selected_rank as f64,
        );
        if max_rank.is_finite() && max_rank >= 1.0 {
            cfg.max_selected_rank = (max_rank.round() as usize).clamp(1, 500);
        }

        if query.feature_switch("dpp_greedy_order", false) {
            cfg.greedy_order = true;
        }

        if query.feature_switch("dpp_disable_window", false) {
            cfg.window = None;
        } else if let Some(mut window) = cfg.window {
            let win_size =
                space_feed_experiment_number(query, "dpp_window_size", window.size as f64);
            if win_size.is_finite() && win_size >= 0.0 {
                window.size = win_size.round() as usize;
            }
            let half_distance = space_feed_experiment_number(
                query,
                "dpp_window_half_distance",
                window.half_distance,
            );
            if half_distance.is_finite() && half_distance >= 0.0 {
                window.half_distance = half_distance;
            }
            let sid_lambda =
                space_feed_experiment_number(query, "dpp_sid_lambda", window.sid_lambda);
            if sid_lambda.is_finite() {
                window.sid_lambda = sid_lambda.clamp(0.0, 1.0);
            }
            cfg.window = Some(window);
        }

        cfg
    }
}
