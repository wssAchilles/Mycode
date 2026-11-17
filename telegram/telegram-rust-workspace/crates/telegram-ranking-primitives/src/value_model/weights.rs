//! V3 14 真头契约常量、权重配置与输入结构体定义。

use serde::{Deserialize, Serialize};

/// V3 价值模型契约版本标识。
pub const V3_VALUE_MODEL_VERSION: &str = "v3_conditional_value_model_v1";
/// V3 分段连续负分压缩默认基准偏移量（对标 `xai-value-model` `NEGATIVE_SCORES_OFFSET = 0.001`）。
pub const V3_NEGATIVE_SCORES_OFFSET: f64 = 0.001;
/// V3 真头契约动作维度总数（10 个正向头 + 4 个负向头）。
pub const V3_HEAD_COUNT: usize = 14;

/// V3 14 真头标准顺序契约（与 `UserDebiasEntry::action_biases` 一一对应）。
pub const V3_HEAD_NAMES: [&str; V3_HEAD_COUNT] = [
    "click",
    "like",
    "reply",
    "repost",
    "quote",
    "share",
    "dwell",
    "video_view",
    "video_quality_view",
    "follow_author",
    "not_interested",
    "block_author",
    "mute_author",
    "report",
];

/// V3 条件期望价值模型权重配置。
///
/// - 14 真头：10 个正向动作头 + 4 个负向反馈头。
/// - 连续停留与条件期望乘积：`cont_dwell_time`、`video_view * expected_dwell_sec`、
///   `click * expected_dwell_sec` 与互关回复加成 `mutual_follow_reply_boost`。
/// - 负向权重按 `xai-value-model` 约定使用负数表示（例如 `-10.0`），若传入正幅度也按绝对值作为惩罚扣除。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct V3ValueModelWeights {
    // ── 14 真头权重（10 正 + 4 负） ──
    pub click: f64,
    pub like: f64,
    pub reply: f64,
    pub repost: f64,
    pub quote: f64,
    pub share: f64,
    pub dwell: f64,
    pub video_view: f64,
    pub video_quality_view: f64,
    pub follow_author: f64,
    pub not_interested: f64,
    pub block_author: f64,
    pub mute_author: f64,
    pub report: f64,

    // ── 连续停留与 3 项条件期望/互关交互权重 ──
    /// 连续停留时长权重（作用于 `cont_dwell_time`）。
    pub cont_dwell_time: f64,
    /// 条件期望乘积权重 1：作用于 `video_view * expected_dwell_sec`。
    pub video_view_expected_dwell_sec: f64,
    /// 条件期望乘积权重 2：作用于 `click * expected_dwell_sec`。
    pub click_expected_dwell_sec: f64,
    /// 互关作者回复加成权重：当满足互关且为原创主帖时叠加至 `reply` 权重。
    pub mutual_follow_reply_boost: f64,

    // ── 分段偏移与单层多样性配置 ──
    /// 正负分分界偏移量（默认 `0.001`）。
    pub negative_scores_offset: f64,
    /// 是否启用单层作者多样性衰减。
    pub enable_author_diversity: bool,
    /// 作者多样性指数衰减底数（典型值 `0.8` 或 `0.5`）。
    pub author_diversity_decay: f64,
    /// 作者多样性衰减下限（典型值 `0.3` 或 `0.25`）。
    pub author_diversity_floor: f64,
    /// 站外候选（Out-Of-Network）缩放乘数（默认 `1.0`）。
    pub oon_weight_factor: f64,
    /// 视频优质播放（VQV）最低时长门槛（秒，默认 `5.0`）。
    pub min_video_duration_sec: f64,
}

impl Default for V3ValueModelWeights {
    /// 默认所有权重归零以保障测试零污染，同时提供有效偏移量与门槛参数。
    fn default() -> Self {
        Self {
            click: 0.0,
            like: 0.0,
            reply: 0.0,
            repost: 0.0,
            quote: 0.0,
            share: 0.0,
            dwell: 0.0,
            video_view: 0.0,
            video_quality_view: 0.0,
            follow_author: 0.0,
            not_interested: 0.0,
            block_author: 0.0,
            mute_author: 0.0,
            report: 0.0,
            cont_dwell_time: 0.0,
            video_view_expected_dwell_sec: 0.0,
            click_expected_dwell_sec: 0.0,
            mutual_follow_reply_boost: 0.0,
            negative_scores_offset: V3_NEGATIVE_SCORES_OFFSET,
            enable_author_diversity: false,
            author_diversity_decay: 0.8,
            author_diversity_floor: 0.3,
            oon_weight_factor: 1.0,
            min_video_duration_sec: 5.0,
        }
    }
}

impl V3ValueModelWeights {
    /// 构建 V3 在线生产推荐默认权重配置（与 14 真头契约及条件期望对齐）。
    pub fn production_defaults() -> Self {
        Self {
            click: 0.5,
            like: 2.0,
            reply: 5.0,
            repost: 4.0,
            quote: 4.5,
            share: 2.5,
            dwell: 0.4,
            video_view: 1.2,
            video_quality_view: 3.0,
            follow_author: 2.4,
            not_interested: -5.0,
            block_author: -10.0,
            mute_author: -4.0,
            report: -8.0,
            cont_dwell_time: 0.05,
            video_view_expected_dwell_sec: 0.12,
            click_expected_dwell_sec: 0.08,
            mutual_follow_reply_boost: 1.5,
            negative_scores_offset: V3_NEGATIVE_SCORES_OFFSET,
            enable_author_diversity: true,
            author_diversity_decay: 0.8,
            author_diversity_floor: 0.3,
            oon_weight_factor: 0.85,
            min_video_duration_sec: 5.0,
        }
    }

    /// 计算 10 个正向离散动作概率头的权重总和（用于负分压缩分母正部分）。
    pub fn positive_sum(&self) -> f64 {
        [
            self.click,
            self.like,
            self.reply,
            self.repost,
            self.quote,
            self.share,
            self.dwell,
            self.video_view,
            self.video_quality_view,
            self.follow_author,
        ]
        .into_iter()
        .map(sanitize_non_negative)
        .sum()
    }

    /// 计算 4 个负向反馈概率头的惩罚权重幅值总和（恒返回非负数 `neg_sum >= 0`）。
    pub fn negative_sum(&self) -> f64 {
        [
            self.not_interested,
            self.block_author,
            self.mute_author,
            self.report,
        ]
        .into_iter()
        .map(sanitize_abs)
        .sum()
    }

    /// 计算概率头总权重和 `total_sum = pos_sum + neg_sum`。
    ///
    /// 以 `pos_sum + neg_sum` 作为负分压缩分母，确保任意合法负分 `s in [-neg_sum, 0)`
    /// 满足 `(s + neg_sum) / total_sum < 1.0`，映射后严格小于 `offset`。
    pub fn total_sum(&self) -> f64 {
        self.positive_sum() + self.negative_sum()
    }

    /// 返回当前生效的偏移常数（非有限或负值时回退至 `V3_NEGATIVE_SCORES_OFFSET`）。
    pub fn effective_offset(&self) -> f64 {
        if self.negative_scores_offset.is_finite() && self.negative_scores_offset >= 0.0 {
            self.negative_scores_offset
        } else {
            V3_NEGATIVE_SCORES_OFFSET
        }
    }

    /// 根据候选是否具备互关原创资格计算生效的 `reply` 权重。
    pub fn reply_weight_for(&self, candidate: &V3CandidateScoringInputs) -> f64 {
        let boost = if candidate.mutual_reply_boost_eligible() {
            sanitize_finite(self.mutual_follow_reply_boost)
        } else {
            0.0
        };
        sanitize_finite(self.reply) + boost
    }

    /// 根据候选视频时长门槛与资格标记计算生效的 `video_quality_view` 权重。
    pub fn vqv_weight_for(&self, candidate: &V3CandidateScoringInputs) -> f64 {
        let duration_ok = candidate
            .video_duration_sec
            .is_none_or(|sec| sec.is_finite() && sec >= self.min_video_duration_sec);
        if candidate.vqv_eligible && duration_ok {
            sanitize_finite(self.video_quality_view)
        } else {
            0.0
        }
    }
}

/// V3 候选项 14 真头概率与 CREAD-30 条件期望连续预测向量。
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct V3PhoenixPredictions {
    pub click: f64,
    pub like: f64,
    pub reply: f64,
    pub repost: f64,
    pub quote: f64,
    pub share: f64,
    pub dwell: f64,
    pub video_view: f64,
    pub video_quality_view: f64,
    pub follow_author: f64,
    pub not_interested: f64,
    pub block_author: f64,
    pub mute_author: f64,
    pub report: f64,
    /// 连续停留时长预测（秒）。
    pub cont_dwell_time: f64,
    /// CREAD-30 条件期望停留时长 E[dwell | engaged]（秒）。
    pub expected_dwell_sec: f64,
}

impl V3PhoenixPredictions {
    /// 按 `V3_HEAD_NAMES` 标准顺序导出 14 真头概率数组。
    pub fn to_head_array(self) -> [f64; V3_HEAD_COUNT] {
        [
            self.click,
            self.like,
            self.reply,
            self.repost,
            self.quote,
            self.share,
            self.dwell,
            self.video_view,
            self.video_quality_view,
            self.follow_author,
            self.not_interested,
            self.block_author,
            self.mute_author,
            self.report,
        ]
    }

    /// 将 14 真头概率数组写回结构体，保留连续停留与期望字段不变。
    pub fn apply_head_array(&mut self, heads: [f64; V3_HEAD_COUNT]) {
        self.click = heads[0];
        self.like = heads[1];
        self.reply = heads[2];
        self.repost = heads[3];
        self.quote = heads[4];
        self.share = heads[5];
        self.dwell = heads[6];
        self.video_view = heads[7];
        self.video_quality_view = heads[8];
        self.follow_author = heads[9];
        self.not_interested = heads[10];
        self.block_author = heads[11];
        self.mute_author = heads[12];
        self.report = heads[13];
    }
}

/// V3 候选项价值打分上下文输入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct V3CandidateScoringInputs {
    /// 14 真头概率与 CREAD-30 条件期望输入。
    pub predictions: V3PhoenixPredictions,
    /// 候选作者是否与当前用户互关。
    pub is_mutual_follow_author: bool,
    /// 候选是否为回复帖（用于互关原创加成资格判定）。
    pub is_reply: bool,
    /// 候选是否为转发帖（用于互关原创加成资格判定）。
    pub is_repost: bool,
    /// 视频时长（秒，存在时与 `min_video_duration_sec` 比较）。
    pub video_duration_sec: Option<f64>,
    /// 候选是否具备 VQV 打分资格（默认 `true`，可由上游按视频条件关闭）。
    pub vqv_eligible: bool,
    /// 是否为站外召回（Out-Of-Network）。
    pub out_of_network: bool,
    /// 冷启动探索加分（在 `unoffset` 净分空间中叠加）。
    pub author_exploration_bonus: f64,
}

impl Default for V3CandidateScoringInputs {
    fn default() -> Self {
        Self {
            predictions: V3PhoenixPredictions::default(),
            is_mutual_follow_author: false,
            is_reply: false,
            is_repost: false,
            video_duration_sec: None,
            vqv_eligible: true,
            out_of_network: false,
            author_exploration_bonus: 0.0,
        }
    }
}

impl V3CandidateScoringInputs {
    /// 判断候选是否满足互关回复加成资格（互关作者且非回复非转发）。
    pub fn mutual_reply_boost_eligible(&self) -> bool {
        !self.is_reply && !self.is_repost && self.is_mutual_follow_author
    }
}

pub(super) fn sanitize_finite(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

fn sanitize_non_negative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

pub(super) fn sanitize_abs(value: f64) -> f64 {
    if value.is_finite() {
        value.abs()
    } else {
        0.0
    }
}
