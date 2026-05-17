use std::collections::HashMap;

use chrono::{Timelike, Utc};
use serde_json::Value;
use telegram_ranking_primitives::{
    TREND_AFFINITY_STRENGTH_FIELD, TREND_PERSONALIZATION_STRENGTH_FIELD, new_score_breakdown_map,
};
use telegram_source_primitives::{
    NEWS_ANN_SOURCE, RETRIEVAL_DENSE_VECTOR_SCORE_FIELD, RETRIEVAL_EVIDENCE_CONFIDENCE_FIELD,
    RETRIEVAL_MULTI_SOURCE_BONUS_FIELD, RETRIEVAL_SOURCE_DIVERSITY_SCORE_FIELD,
    SOURCE_SIGNAL_NORMALIZED_SCORE_FIELD,
};
use whatlang::detect;

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

/// 图谱权威度信号: 利用 graph_score 和 graph_recall_type
/// graph_score 来自 C++ 图服务的 BFS 多跳遍历，反映用户在社交图谱中的位置相关性
pub(super) fn graph_authority_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let graph_score = candidate.graph_score.unwrap_or_default();
    if graph_score <= 0.0 {
        return 0.0;
    }
    // graph_score 通常在 [0, 1] 范围，但可能超过 1.0
    let normalized = graph_score.min(1.0);
    // 图谱召回类型加权: direct_neighbor > recent_engager > co_engager > content_affinity > bridge
    let recall_type_bonus = match candidate.graph_recall_type.as_deref() {
        Some("social_neighbors") => 0.12,
        Some("recent_engagers") => 0.08,
        Some("co_engagers") => 0.06,
        Some("content_affinity_neighbors") => 0.04,
        Some("bridge_users") => 0.02,
        _ => 0.0,
    };
    clamp01(normalized + recall_type_bonus)
}

/// 源排名提升: recall_evidence.source_rank 越小（排名越靠前），提升越大
pub(super) fn source_rank_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let evidence = match candidate.recall_evidence.as_ref() {
        Some(evidence) => evidence,
        None => return 0.0,
    };
    let rank_score = evidence.source_rank_score.unwrap_or_default();
    if rank_score > 0.0 {
        return rank_score.min(1.0);
    }
    // 从 source_rank 计算: rank 1 → 1.0, rank 10 → 0.5, rank 100 → 0.17
    evidence
        .source_rank
        .filter(|&rank| rank > 0.0)
        .map(|rank| (1.0 / (1.0 + (rank - 1.0).ln_1p())).min(1.0))
        .unwrap_or(0.0)
}

/// 可见性梯度: 利用 vf_result.level 和 vf_result.score 细化安全惩罚
/// 比简单的 safe/unsafe 二元判断更精细
pub(super) fn visibility_gradient_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let vf = match candidate.vf_result.as_ref() {
        Some(vf) => vf,
        None => return 1.0, // 无可见性信息 = 默认可见
    };
    if !vf.safe {
        return 0.0; // 不安全内容直接归零
    }
    // 利用 level 字段做梯度调整
    let level_factor = match vf.level.as_deref() {
        Some("high_quality") => 1.08,
        Some("standard") => 1.0,
        Some("low_quality") => 0.82,
        Some("borderline") => 0.64,
        _ => 1.0,
    };
    // 利用 score 字段做连续调整
    let score_factor = vf
        .score
        .map(|s| 0.85 + s.clamp(0.0, 1.0) * 0.15) // [0.85, 1.0]
        .unwrap_or(1.0);
    (level_factor * score_factor).min(1.1).max(0.0)
}

/// 已互动内容惩罚: 对已经 like/repost 的内容施加降权
pub(super) fn engagement_penalties(candidate: &RecommendationCandidatePayload) -> f64 {
    let mut penalty = 1.0;
    if candidate.is_liked_by_user == Some(true) {
        penalty *= 0.65; // 已点赞降权 35%
    }
    if candidate.is_reposted_by_user == Some(true) {
        penalty *= 0.55; // 已转发降权 45%
    }
    penalty
}

/// 多源证据提升: 被多个召回源命中的内容更可能有价值
pub(super) fn multi_source_evidence_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let evidence = match candidate.recall_evidence.as_ref() {
        Some(evidence) => evidence,
        None => return 0.0,
    };
    let cross_lane = evidence.cross_lane_source_count;
    let same_lane = evidence.same_lane_source_count;
    let total = evidence.source_count;
    if total <= 0.0 {
        return 0.0;
    }
    // 跨 lane 来源比同 lane 更有价值（多样性证据）
    let cross_bonus = (cross_lane.ln_1p() / 3.0).min(0.4);
    let same_bonus = (same_lane.ln_1p() / 5.0).min(0.3);
    let total_bonus = (total.ln_1p() / 6.0).min(0.3);
    clamp01(cross_bonus + same_bonus + total_bonus)
}

/// 内容速度信号: 互动量 / 发布小时数
/// 高速度意味着内容正在快速获得关注
pub(super) fn content_velocity_signal(candidate: &RecommendationCandidatePayload) -> f64 {
    let age_hours = Utc::now()
        .signed_duration_since(candidate.created_at)
        .num_seconds()
        .max(0) as f64
        / 3600.0;
    if age_hours < 0.1 {
        return 0.5; // 刚发布的内容给中等分数
    }
    let engagements = candidate.like_count.unwrap_or_default()
        + candidate.comment_count.unwrap_or_default() * 2.0
        + candidate.repost_count.unwrap_or_default() * 3.0;
    // 每小时互动量，用 log 平滑
    let velocity = engagements / age_hours;
    // ln(1)/8 ≈ 0.09, ln(10)/8 ≈ 0.29, ln(100)/8 ≈ 0.58, ln(1000)/8 ≈ 0.86
    clamp01(velocity.ln_1p() / 8.0)
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

/// 用户成熟度校准: 根据用户活跃度调整信号权重
/// 高活跃用户的兴趣信号更可靠，新用户需要更多探索
pub(super) fn user_sophistication_factor(query: &RecommendationQueryPayload) -> f64 {
    let state = query
        .user_state_context
        .as_ref()
        .map(|ctx| ctx.state.as_str())
        .unwrap_or("");
    let account_age = query
        .user_state_context
        .as_ref()
        .and_then(|ctx| ctx.account_age_days)
        .unwrap_or(0);
    let recent_actions = query
        .user_state_context
        .as_ref()
        .map(|ctx| ctx.recent_action_count)
        .unwrap_or(0);
    let followed_count = query
        .user_state_context
        .as_ref()
        .map(|ctx| ctx.followed_count)
        .unwrap_or(0);

    match state {
        "cold_start" => 0.72, // 新用户：降低个性化信号权重，增加探索
        "sparse" => 0.86,
        "heavy" => 1.08, // 活跃用户：增强个性化信号
        _ => {
            // 基于账户年龄和活跃度的连续校准
            let age_factor = (account_age as f64 / 365.0).min(1.0); // 1年 = 成熟
            let action_factor = (recent_actions as f64 / 100.0).min(1.0);
            let follow_factor = (followed_count as f64 / 200.0).min(1.0);
            0.8 + (age_factor * 0.1 + action_factor * 0.06 + follow_factor * 0.04)
        }
    }
}

/// 语言匹配信号: 内容语言与用户偏好语言的匹配度
pub(super) fn language_match_signal(
    query: &RecommendationQueryPayload,
    candidate: &RecommendationCandidatePayload,
) -> f64 {
    let user_lang = match query.language_code.as_deref() {
        Some(lang) if !lang.is_empty() => lang.to_lowercase(),
        _ => return 1.0, // 无语言偏好或空值 = 不惩罚
    };
    // 从 candidate 内容推断语言（简单启发式）
    let content_lang = detect_content_language(&candidate.content);
    if content_lang.is_empty() {
        return 0.92; // 无法检测语言 = 轻微惩罚
    }
    if content_lang == user_lang {
        1.0
    } else {
        // 安全截取前 2 个 Unicode 字符，避免多字节 UTF-8 边界 panic
        let user_prefix: String = user_lang.chars().take(2).collect();
        let content_prefix: String = content_lang.chars().take(2).collect();
        if content_lang.starts_with(&user_prefix) || user_lang.starts_with(&content_prefix) {
            0.88 // 同语族（如 zh-cn / zh-tw）
        } else {
            0.62 // 不同语言
        }
    }
}

/// 语言检测: 使用 whatlang 进行检测，回退到 Unicode 范围启发式
fn detect_content_language(text: &str) -> String {
    // 使用 whatlang 进行高精度检测
    if let Some(info) = detect(text) {
        if info.is_reliable() {
            return info.lang().code().to_string();
        }
    }

    // 回退: Unicode 范围启发式
    let mut cjk_count = 0;
    let mut latin_count = 0;
    let mut cyrillic_count = 0;
    let mut arabic_count = 0;
    let total = text.chars().count().max(1);

    for ch in text.chars() {
        match ch as u32 {
            0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x3000..=0x303F => cjk_count += 1,
            0x0041..=0x024F => latin_count += 1,
            0x0400..=0x04FF => cyrillic_count += 1,
            0x0600..=0x06FF | 0x0750..=0x077F => arabic_count += 1,
            _ => {}
        }
    }

    let threshold = total / 4; // 25% 以上的字符属于某个脚本
    if cjk_count > threshold {
        "zh".to_string()
    } else if cyrillic_count > threshold {
        "ru".to_string()
    } else if arabic_count > threshold {
        "ar".to_string()
    } else if latin_count > threshold {
        "en".to_string()
    } else {
        String::new()
    }
}

/// 新鲜度-质量交互惩罚: 高质量内容可以容忍稍旧，低质量内容过期更快
pub(super) fn freshness_quality_interaction(freshness: f64, quality: f64) -> f64 {
    // 高质量内容的新鲜度惩罚减弱（半衰期延长 30%）
    // 低质量内容的新鲜度惩罚增强（半衰期缩短 20%）
    let quality_factor = 0.8 + quality * 0.4; // [0.8, 1.2]
    (freshness * quality_factor).min(1.0)
}

/// 时段个性化: 根据 UTC 时间调整内容类型偏好
/// 注: 如有用户本地时区信息，应替换为本地时间
pub(super) fn time_of_day_adjustment(_query: &RecommendationQueryPayload) -> f64 {
    let hour = Utc::now().hour();

    match hour {
        6..=8 => 0.96,   // 早晨：轻微偏好新闻和信息类
        9..=11 => 1.02,  // 上午：活跃时段
        12..=13 => 1.0,  // 午休
        14..=17 => 1.04, // 下午：最活跃时段
        18..=21 => 1.06, // 晚间：娱乐和社交内容
        22..=23 => 0.98, // 深夜：降低活跃度
        _ => 0.90,       // 凌晨：大幅降低
    }
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
    // 精确匹配源名称或域名前缀，避免 "notreuters" 匹配 "reuters"
    let is_trusted = |name: &str| {
        key == name
            || key.starts_with(&format!("{name}."))
            || key.ends_with(&format!(".{name}"))
            || key.contains(&format!(".{name}."))
    };
    if is_trusted("reuters") || is_trusted("apnews") || is_trusted("associatedpress") {
        0.92
    } else if is_trusted("bbc") || is_trusted("nytimes") || is_trusted("theguardian") {
        0.86
    } else if is_trusted("cnn") || is_trusted("bloomberg") || is_trusted("wsj") {
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
