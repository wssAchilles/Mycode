use std::collections::HashMap;

use chrono::Utc;
use serde_json::Value;
use telegram_ranking_primitives::{
    TREND_AFFINITY_STRENGTH_FIELD, TREND_PERSONALIZATION_STRENGTH_FIELD, new_score_breakdown_map,
};
use telegram_source_primitives::{
    NEWS_ANN_SOURCE, RETRIEVAL_DENSE_VECTOR_SCORE_FIELD, RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD,
    RETRIEVAL_MULTI_SOURCE_BONUS_FIELD, RETRIEVAL_SOURCE_DIVERSITY_SCORE_FIELD,
    SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD,
};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{
    FALLBACK_LANE, IN_NETWORK_LANE, INTEREST_LANE, SOCIAL_EXPANSION_LANE, related_post_ids,
};

use super::policy::ScoringPolicy;

pub(super) fn freshness_signal(
    candidate: &RecommendationCandidatePayload,
    policy: &ScoringPolicy,
) -> f64 {
    let age_hours = Utc::now()
        .signed_duration_since(candidate.created_at)
        .num_seconds()
        .max(0) as f64
        / 3600.0;
    0.5_f64.powf(age_hours / policy.freshness_half_life_hours)
}

pub(super) fn popularity_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    let views = candidate.view_count.unwrap_or(1.0).max(1.0);
    let rate = (engagements / views).min(1.0);

    // Wilson score 下界: 对低互动量帖子更公平
    // 100 次浏览 10 次互动 vs 1000 次浏览 100 次互动, rate 相同但置信度不同
    let n = views.max(1.0);
    let z = 1.96; // 95% 置信度
    let z2 = z * z;
    let wilson_lower = (rate + z2 / (2.0 * n)
        - z * ((rate * (1.0 - rate) + z2 / (4.0 * n)) / n).sqrt())
        / (1.0 + z2 / n);
    let wilson_score = wilson_lower.max(0.0);

    // 量级信号: log 平滑
    let volume = (engagements.ln_1p() / 5.0).min(1.0);

    // 融合: 置信互动率 + 量级
    clamp01(wilson_score * 0.7 + volume * 0.3)
}

pub(super) fn quality_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let content_length = candidate.content.chars().count();

    // 内容长度评分: 用平滑的对数曲线代替阶梯函数
    // 0字 → 0.05, 10字 → 0.35, 50字 → 0.62, 140字 → 0.82, 280字 → 0.92, 1000字 → 0.95
    let length = if content_length < 3 {
        0.05
    } else {
        (content_length as f64).ln() / 7.0 // ln(3)/7 ≈ 0.16, ln(280)/7 ≈ 0.80
    };
    let length = length.min(0.96);

    // 媒体加分: 视频 > 图片, 且长视频比短视频更好
    let has_image = candidate.has_image == Some(true);
    let has_video = candidate.has_video == Some(true);
    let video_duration = candidate.video_duration_sec.unwrap_or_default();
    let media = if has_video {
        let duration_bonus = if video_duration > 30.0 { 0.06 } else { 0.0 };
        0.14 + duration_bonus
    } else if has_image {
        0.08
    } else {
        0.0
    };

    // 结构因子: 原创 > 回复 > 转发
    let structure = if candidate.is_reply {
        0.88
    } else if candidate.is_repost {
        0.80
    } else {
        1.0
    };

    // 安全因子: 被标记为不安全或 NSFW 的内容严重扣分
    let safety = if candidate
        .vf_result
        .as_ref()
        .is_some_and(|result| !result.safe)
        || candidate.is_nsfw == Some(true)
    {
        0.42
    } else {
        1.0
    };

    // 融合: 内容质量 60% + 媒体 15% + 结构 15% + 安全 10%
    clamp01(length * 0.60 + media * 0.15 + structure * 0.15 + safety * 0.10)
}

pub(super) fn author_affinity_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    ((candidate
        .author_affinity_score
        .unwrap_or_default()
        .clamp(-1.0, 1.0)
        + 1.0)
        / 2.0)
        .max(0.0)
}

pub(super) fn source_evidence_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let recall_confidence = candidate
        .recall_evidence
        .as_ref()
        .map(|evidence| evidence.confidence)
        .unwrap_or_default();
    let breakdown = candidate.score_breakdown.as_ref();
    recall_confidence
        .max(breakdown_value(
            breakdown,
            RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD,
        ))
        .max(breakdown_value(breakdown, RETRIEVAL_MULTI_SOURCE_BONUS_FIELD) * 4.0)
        .max(breakdown_value(
            breakdown,
            RETRIEVAL_DENSE_VECTOR_SCORE_FIELD,
        ))
        .max(breakdown_value(breakdown, "graphKernelScore"))
        .min(1.0)
}

pub(super) fn network_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    match (
        candidate.in_network,
        candidate.retrieval_lane.as_deref().unwrap_or_default(),
    ) {
        (Some(true), _) => 1.0,
        (_, IN_NETWORK_LANE) => 0.9,
        (_, SOCIAL_EXPANSION_LANE) => 0.72,
        (_, INTEREST_LANE) => 0.64,
        (_, FALLBACK_LANE) => 0.44,
        _ => 0.5,
    }
}

pub(super) fn content_kind_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let lane = candidate.retrieval_lane.as_deref().unwrap_or_default();
    let news: f64 = if candidate.is_news == Some(true)
        || candidate.recall_source.as_deref() == Some(NEWS_ANN_SOURCE)
    {
        0.72
    } else {
        0.0
    };
    let media = (candidate.has_image == Some(true)) as i32 as f64 * 0.12
        + (candidate.has_video == Some(true)) as i32 as f64 * 0.18;
    let lane_prior: f64 = match lane {
        IN_NETWORK_LANE => 0.48,
        SOCIAL_EXPANSION_LANE => 0.42,
        INTEREST_LANE => 0.46,
        FALLBACK_LANE => 0.3,
        _ => 0.34,
    };
    clamp01(news.max(lane_prior) + media)
}

pub(super) fn trend_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    breakdown_value(breakdown, TREND_PERSONALIZATION_STRENGTH_FIELD)
        .max(breakdown_value(breakdown, TREND_AFFINITY_STRENGTH_FIELD))
        .max(breakdown_value(breakdown, "newsTrendLinkStrength"))
        .max(breakdown_value(breakdown, "trendHeat") / 100.0)
        .max(breakdown_value(breakdown, "newsTrendHeat") / 100.0)
        .min(1.0)
}

pub(super) fn source_quality_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let breakdown = candidate.score_breakdown.as_ref();
    let recall = candidate
        .recall_evidence
        .as_ref()
        .map(|evidence| evidence.confidence)
        .unwrap_or_default();
    let normalized_score = breakdown_value(breakdown, SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD);
    let source_prior = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.source.as_deref())
        .map(news_source_prior)
        .unwrap_or(0.52);
    clamp01(
        recall * 0.34
            + normalized_score * 0.2
            + breakdown_value(breakdown, RETRIEVAL_SOURCE_DIVERSITY_SCORE_FIELD) * 0.18
            + source_prior * 0.28,
    )
}

pub(super) fn negative_feedback_signal(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let mut strength: f64 = 0.0;

    // 直接黑名单: 永久压制
    if query
        .user_features
        .as_ref()
        .is_some_and(|features| features.blocked_user_ids.contains(&candidate.author_id))
    {
        strength = strength.max(1.0);
    }

    // 内容安全: 不安全或 NSFW
    if candidate
        .vf_result
        .as_ref()
        .is_some_and(|result| !result.safe)
        || candidate.is_nsfw == Some(true)
    {
        strength = strength.max(0.72);
    }

    // 从用户行为序列中匹配负面反馈
    // 关键改进: 加入时间衰减 — 3天前的 dismiss 不应该和今天的一样强
    let now_ms = Utc::now().timestamp_millis();
    let related_ids = related_post_ids(candidate);

    for action in query.user_action_sequence.as_ref().into_iter().flatten() {
        let action_name = action
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let base = match action_name {
            "dismiss" => 0.34,
            "not_interested" => 0.5,
            "mute_author" => 0.68,
            "block_author" => 0.9,
            "report" => 0.84,
            _ => 0.0,
        };
        if base <= 0.0 {
            continue;
        }

        // 时间衰减: 7 天半衰期
        let time_decay = action
            .get("timestamp")
            .and_then(|v| {
                v.as_str().and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(s)
                        .ok()
                        .map(|dt| dt.timestamp_millis())
                })
            })
            .map(|ts| {
                let age_days = ((now_ms - ts).max(0) as f64) / (1000.0 * 60.0 * 60.0 * 24.0);
                0.5_f64.powf(age_days / 7.0) // 7天半衰期
            })
            .unwrap_or(1.0);

        let post_match = action_string(
            action,
            &[
                "targetPostId",
                "target_post_id",
                "modelPostId",
                "model_post_id",
            ],
        )
        .is_some_and(|target| related_ids.iter().any(|id| id == &target));
        let author_match = action_string(action, &["targetAuthorId", "target_author_id"])
            .is_some_and(|target| target == candidate.author_id);
        if post_match || author_match {
            let effective = base * time_decay;
            strength = strength.max(if post_match {
                effective
            } else {
                effective * 0.62
            });
        }
    }
    clamp01(strength)
}

pub(super) fn merge_breakdown(
    candidate: &mut RecommendationCandidatePayload,
    key: &str,
    value: f64,
) {
    if !value.is_finite() {
        return;
    }
    let breakdown = candidate
        .score_breakdown
        .get_or_insert_with(new_score_breakdown_map);
    breakdown.insert(key.to_string(), value);
}

pub(super) fn clamp01(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 1.0)
    }
}

fn news_source_prior(source: &str) -> f64 {
    let key = source.to_lowercase();
    if key.contains("reuters") || key.contains("apnews") || key.contains("associatedpress") {
        0.92
    } else if key.contains("bbc") || key.contains("nytimes") || key.contains("theguardian") {
        0.86
    } else if key.contains("cnn") || key.contains("bloomberg") || key.contains("wsj") {
        0.8
    } else {
        0.56
    }
}

fn action_string(action: &HashMap<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = action.get(*key) else {
            continue;
        };
        if let Some(as_string) = value.as_str() {
            return Some(as_string.to_string());
        }
        if let Some(as_oid) = value
            .as_object()
            .and_then(|object| object.get("$oid").or_else(|| object.get("oid")))
            .and_then(Value::as_str)
        {
            return Some(as_oid.to_string());
        }
    }
    None
}

fn breakdown_value(breakdown: Option<&HashMap<String, f64>>, key: &str) -> f64 {
    breakdown
        .and_then(|breakdown| breakdown.get(key))
        .copied()
        .unwrap_or_default()
}
