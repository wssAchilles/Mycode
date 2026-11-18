//! 候选与排序打分载荷的非有限浮点数（`NaN` / `Infinity`）安全清洗模块。
//!
//! 防止任何非有限浮点值被 `serde_json` 序列化为 `null` 而破坏下游跨语言契约校验。

use std::collections::HashMap;

use super::core::RecommendationCandidatePayload;
use super::scores::{
    ActionScoresPayload, PhoenixScoresPayload, RankingSignalsPayload, RecallEvidencePayload,
};
use super::v3::{RetrievalSourcePayload, SlateContextPayload};

#[inline]
pub(crate) fn sanitize_f64(value: &mut f64) {
    if !value.is_finite() {
        *value = 0.0;
    }
}

#[inline]
pub(crate) fn sanitize_opt_f64(value: &mut Option<f64>) {
    if let Some(inner) = value
        && !inner.is_finite()
    {
        *inner = 0.0;
    }
}

#[inline]
pub(crate) fn sanitize_f32(value: &mut f32) {
    if !value.is_finite() {
        *value = 0.0;
    }
}

pub(crate) fn sanitize_f64_map(map: &mut HashMap<String, f64>) {
    for value in map.values_mut() {
        sanitize_f64(value);
    }
}

impl PhoenixScoresPayload {
    /// 将所有动作概率与停留时长分桶中的 `NaN` / `Infinity` 清洗为 `0.0`。
    pub fn sanitize_non_finite_floats(&mut self) {
        sanitize_opt_f64(&mut self.like_score);
        sanitize_opt_f64(&mut self.reply_score);
        sanitize_opt_f64(&mut self.repost_score);
        sanitize_opt_f64(&mut self.quote_score);
        sanitize_opt_f64(&mut self.click_score);
        sanitize_opt_f64(&mut self.quoted_click_score);
        sanitize_opt_f64(&mut self.profile_click_score);
        sanitize_opt_f64(&mut self.dwell_score);
        sanitize_opt_f64(&mut self.dwell_time);
        sanitize_opt_f64(&mut self.share_score);
        sanitize_opt_f64(&mut self.share_via_dm_score);
        sanitize_opt_f64(&mut self.share_via_copy_link_score);
        sanitize_opt_f64(&mut self.photo_expand_score);
        sanitize_opt_f64(&mut self.follow_author_score);
        sanitize_opt_f64(&mut self.video_quality_view_score);
        sanitize_opt_f64(&mut self.video_view_score);
        sanitize_opt_f64(&mut self.expected_dwell_sec);
        sanitize_opt_f64(&mut self.video_continuation_secs);
        sanitize_opt_f64(&mut self.profile_visit_secs);
        if let Some(probs) = self.dwell_probs.as_mut() {
            for prob in probs.iter_mut() {
                sanitize_f64(prob);
            }
        }
        sanitize_opt_f64(&mut self.not_interested_score);
        sanitize_opt_f64(&mut self.dismiss_score);
        sanitize_opt_f64(&mut self.block_author_score);
        sanitize_opt_f64(&mut self.block_score);
        sanitize_opt_f64(&mut self.mute_author_score);
        sanitize_opt_f64(&mut self.report_score);
    }
}

impl ActionScoresPayload {
    /// 将六维行为摘要分中的非有限值清洗为 `0.0`。
    pub fn sanitize_non_finite_floats(&mut self) {
        sanitize_f64(&mut self.click);
        sanitize_f64(&mut self.like);
        sanitize_f64(&mut self.reply);
        sanitize_f64(&mut self.repost);
        sanitize_f64(&mut self.dwell);
        sanitize_f64(&mut self.negative);
    }
}

impl RankingSignalsPayload {
    /// 将多维排序信号中的非有限值清洗为 `0.0`。
    pub fn sanitize_non_finite_floats(&mut self) {
        sanitize_f64(&mut self.relevance);
        sanitize_f64(&mut self.freshness);
        sanitize_f64(&mut self.popularity);
        sanitize_f64(&mut self.quality);
        sanitize_f64(&mut self.author_affinity);
        sanitize_f64(&mut self.topic_affinity);
        sanitize_f64(&mut self.source_affinity);
        sanitize_f64(&mut self.conversation_affinity);
        sanitize_f64(&mut self.source_evidence);
        sanitize_f64(&mut self.network);
        sanitize_f64(&mut self.negative_feedback);
        sanitize_f64(&mut self.delivery_fatigue);
        sanitize_f64(&mut self.content_kind);
        sanitize_f64(&mut self.trend);
        sanitize_f64(&mut self.source_quality);
    }
}

impl RecallEvidencePayload {
    /// 将召回证据中的非有限浮点值清洗为 `0.0`。
    pub fn sanitize_non_finite_floats(&mut self) {
        sanitize_opt_f64(&mut self.source_rank);
        sanitize_opt_f64(&mut self.source_rank_score);
        sanitize_opt_f64(&mut self.source_score);
        sanitize_f64(&mut self.source_count);
        sanitize_f64(&mut self.same_lane_source_count);
        sanitize_f64(&mut self.cross_lane_source_count);
        sanitize_f64(&mut self.confidence);
    }
}

impl RetrievalSourcePayload {
    /// 清洗召回源明细中的非有限分值。
    pub fn sanitize_non_finite_floats(&mut self) {
        sanitize_opt_f64(&mut self.score);
    }
}

impl SlateContextPayload {
    /// 清洗 Slate 上下文中的非有限分值。
    pub fn sanitize_non_finite_floats(&mut self) {
        sanitize_opt_f64(&mut self.pre_diversity_score);
    }
}

impl RecommendationCandidatePayload {
    /// 递归清洗候选及所有嵌套打分/向量字段中的 `NaN` / `Infinity` 为有限值 `0.0`。
    pub fn sanitize_non_finite_floats(&mut self) {
        for source in &mut self.retrieval_sources {
            source.sanitize_non_finite_floats();
        }
        if let Some(embedding) = self.semantic_embedding_256d.as_mut() {
            for value in embedding.iter_mut() {
                sanitize_f32(value);
            }
        }
        sanitize_opt_f64(&mut self.author_cred_score);
        sanitize_opt_f64(&mut self.video_duration_sec);
        sanitize_opt_f64(&mut self.like_count);
        sanitize_opt_f64(&mut self.comment_count);
        sanitize_opt_f64(&mut self.repost_count);
        sanitize_opt_f64(&mut self.view_count);
        sanitize_opt_f64(&mut self.author_affinity_score);
        if let Some(scores) = self.phoenix_scores.as_mut() {
            scores.sanitize_non_finite_floats();
        }
        if let Some(scores) = self.action_scores.as_mut() {
            scores.sanitize_non_finite_floats();
        }
        if let Some(signals) = self.ranking_signals.as_mut() {
            signals.sanitize_non_finite_floats();
        }
        if let Some(evidence) = self.recall_evidence.as_mut() {
            evidence.sanitize_non_finite_floats();
        }
        sanitize_opt_f64(&mut self.weighted_score);
        sanitize_opt_f64(&mut self.score);
        if let Some(breakdown) = self.score_breakdown.as_mut() {
            sanitize_f64_map(breakdown);
        }
        sanitize_opt_f64(&mut self.pipeline_score);
        sanitize_opt_f64(&mut self.graph_score);
        sanitize_opt_f64(&mut self.mutual_follow_jaccard);
        if let Some(slate) = self.slate_context.as_mut() {
            slate.sanitize_non_finite_floats();
        }
        if let Some(slate) = self.served_slate_context.as_mut() {
            slate.sanitize_non_finite_floats();
        }
        sanitize_opt_f64(&mut self.page_rl_exploration_prob);
    }
}
