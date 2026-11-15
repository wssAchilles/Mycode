//! 候选多任务概率预测与排序信号契约结构。

use serde::{Deserialize, Serialize};

/// Phoenix / ValueModel 多头打分输出（含 13 路动作概率预测与 CREAD-30 停留时长分布）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PhoenixScoresPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub like_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repost_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quote_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub click_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quoted_click_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_click_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dwell_score: Option<f64>,
    /// 传统连续停留信号。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dwell_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_via_dm_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_via_copy_link_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo_expand_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_author_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_quality_view_score: Option<f64>,
    /// V3 标准动作头第 8 项：视频观看完成/有效播放概率。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_view_score: Option<f64>,
    /// V3 CREAD-30 分桶连续停留期待秒数。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_dwell_sec: Option<f64>,
    /// V3 视频续播期望秒数。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_continuation_secs: Option<f64>,
    /// V3 主页深潜访问期望秒数。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_visit_secs: Option<f64>,
    /// V3 CREAD-30 分桶概率分布向量（用于后验校准与置信度估计）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dwell_probs: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_interested_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismiss_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_author_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mute_author_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_score: Option<f64>,
}

/// 统一六维轻量行为摘要分。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ActionScoresPayload {
    pub click: f64,
    pub like: f64,
    pub reply: f64,
    pub repost: f64,
    pub dwell: f64,
    pub negative: f64,
}

/// 可解释多维度排序因子集合。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RankingSignalsPayload {
    pub relevance: f64,
    pub freshness: f64,
    pub popularity: f64,
    pub quality: f64,
    pub author_affinity: f64,
    pub topic_affinity: f64,
    pub source_affinity: f64,
    pub conversation_affinity: f64,
    pub source_evidence: f64,
    pub network: f64,
    pub negative_feedback: f64,
    pub delivery_fatigue: f64,
    pub content_kind: f64,
    pub trend: f64,
    pub source_quality: f64,
}

/// 候选多路召回汇聚证据（供特征构建与可观测审计使用）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RecallEvidencePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_lane: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_rank: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_rank_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_score: Option<f64>,
    pub source_count: f64,
    pub same_lane_source_count: f64,
    pub cross_lane_source_count: f64,
    pub confidence: f64,
}
