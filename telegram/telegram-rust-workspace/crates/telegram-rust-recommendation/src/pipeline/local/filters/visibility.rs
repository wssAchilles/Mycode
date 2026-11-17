//! 可见性安全（Visibility Filtering）精选后过滤器：
//! 基于声明式规则引擎 `visibility_rules` 执行 fail-closed 安全审查，
//! 综合 `content_safety_labels`、`vf_result` 与 `author_cred_score`，无信任召回绕过后门。

use std::collections::HashMap;

use serde_json::{Map, Value};
use telegram_component_primitives::filters::VF_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_VISIBILITY_UNSAFE;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::super::context::{env_bool, space_feed_experiment_flag};
use super::detail::build_stage;
use super::visibility_rules::{
    ActionKind, HIGH_CREDIBILITY_EXEMPT_THRESHOLD, SafetyLevel, VisibilityPolicyConfig,
    evaluate_candidate_visibility,
};

/// 基于声明式可见性规则引擎过滤候选：
/// NSFW/high/blocked 及未通过安全审查内容一律丢弃；`author_cred_score >= 0.80` 时对轻度 `low_risk` 文本标签免误伤放行。
pub(super) fn vf_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let followed_count = query
        .user_features
        .as_ref()
        .map(|features| features.followed_user_ids.len())
        .unwrap_or_default();
    let is_cold_start = followed_count == 0;
    let allow_news_cold_start = space_feed_experiment_flag(
        query,
        "vf_degrade_allow_news_cold_start",
        env_bool("VF_DEGRADE_ALLOW_NEWS_COLD_START", true),
    );
    let allow_in_network_low_risk = space_feed_experiment_flag(
        query,
        "vf_in_network_allow_low_risk",
        env_bool("VF_IN_NETWORK_ALLOW_LOW_RISK", true),
    );
    let allow_oon_low_risk = space_feed_experiment_flag(
        query,
        "vf_oon_allow_low_risk",
        env_bool("VF_OON_ALLOW_LOW_RISK", false),
    );
    let drop_interstitial = space_feed_experiment_flag(
        query,
        "vf_drop_interstitial",
        env_bool("VF_DROP_INTERSTITIAL", false),
    );
    let safety_level = if space_feed_experiment_flag(query, "vf_safety_level_filter_all", false) {
        SafetyLevel::FilterAll
    } else {
        SafetyLevel::from_query(query, None)
    };

    let policy_cfg = VisibilityPolicyConfig {
        safety_level,
        is_cold_start,
        allow_news_cold_start,
        allow_in_network_low_risk,
        allow_oon_low_risk,
        drop_interstitial,
        high_cred_threshold: HIGH_CREDIBILITY_EXEMPT_THRESHOLD,
    };

    let mut kept = Vec::new();
    let mut removed = Vec::new();
    let mut drop_count = 0_u64;
    let mut tombstone_count = 0_u64;
    let mut interstitial_count = 0_u64;
    let mut downrank_count = 0_u64;
    let mut allow_count = 0_u64;
    let mut credibility_exempt_count = 0_u64;
    let mut async_labels_evaluated_count = 0_u64;

    for candidate in candidates {
        let verdict = evaluate_candidate_visibility(&candidate, &policy_cfg);

        if verdict.used_content_safety_labels {
            async_labels_evaluated_count += 1;
        }
        if verdict.credibility_exempt {
            credibility_exempt_count += 1;
        }
        match verdict.action {
            ActionKind::Drop => drop_count += 1,
            ActionKind::Tombstone => tombstone_count += 1,
            ActionKind::Interstitial => interstitial_count += 1,
            ActionKind::Downrank => downrank_count += 1,
            ActionKind::Allow => allow_count += 1,
        }

        if verdict.should_drop() {
            removed.push(candidate);
        } else {
            kept.push(candidate);
        }
    }

    let removed_count = input_count.saturating_sub(kept.len());

    let mut action_counts = Map::new();
    action_counts.insert("drop".to_string(), Value::from(drop_count));
    action_counts.insert("tombstone".to_string(), Value::from(tombstone_count));
    action_counts.insert("interstitial".to_string(), Value::from(interstitial_count));
    action_counts.insert("downrank".to_string(), Value::from(downrank_count));
    action_counts.insert("allow".to_string(), Value::from(allow_count));

    let mut detail = HashMap::new();
    detail.insert(
        "trustedEmptySelectionFallbackUsed".to_string(),
        Value::Bool(false),
    );
    detail.insert(
        "trustedUnderfillFallbackUsed".to_string(),
        Value::Bool(false),
    );
    detail.insert(
        "trustedUnderfillFallbackCount".to_string(),
        Value::from(0_u64),
    );
    detail.insert("failClosed".to_string(), Value::Bool(true));
    detail.insert(
        "coldStartNewsFallbackEnabled".to_string(),
        Value::Bool(allow_news_cold_start),
    );
    detail.insert(
        "safetyLevel".to_string(),
        Value::String(safety_level.as_str().to_string()),
    );
    detail.insert(
        "credibilityExemptCount".to_string(),
        Value::from(credibility_exempt_count),
    );
    detail.insert(
        "contentSafetyLabelsEvaluatedCount".to_string(),
        Value::from(async_labels_evaluated_count),
    );
    detail.insert("actionCounts".to_string(), Value::Object(action_counts));

    (
        kept,
        removed,
        build_stage(
            VF_FILTER,
            input_count,
            removed_count,
            Some(detail),
            Some(FILTER_DROP_REASON_VISIBILITY_UNSAFE),
        ),
        true,
    )
}
