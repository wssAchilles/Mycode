//! 可见性安全（Visibility Filtering）精选后过滤器：严格按 fail-closed 原则执行安全审查，无信任召回绕过后门。

use std::collections::HashMap;

use serde_json::Value;
use telegram_component_primitives::filters::VF_FILTER;
use telegram_filter_primitives::FILTER_DROP_REASON_VISIBILITY_UNSAFE;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::super::context::{env_bool, space_feed_experiment_flag};
use super::detail::build_stage;

/// 基于内容安全审查状态（VF）过滤候选：NSFW、未通过安全审查以及未授权域外未审核内容一律丢弃。
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

    let mut kept = Vec::new();
    let mut removed = Vec::new();

    for candidate in candidates {
        if candidate.is_nsfw == Some(true) {
            removed.push(candidate);
            continue;
        }

        let Some(vf) = candidate.vf_result.as_ref() else {
            // VF 结果缺失时 fail-closed 降级：仅允许已关注网络内或冷启动新闻语料通过，拒绝域外未知内容
            let keep_unchecked_candidate = candidate.in_network == Some(true)
                || (is_cold_start && allow_news_cold_start && candidate.is_news == Some(true));
            if keep_unchecked_candidate {
                kept.push(candidate);
            } else {
                removed.push(candidate);
            }
            continue;
        };

        if !vf.safe {
            removed.push(candidate);
            continue;
        }

        if vf.level.as_deref() == Some("low_risk") {
            let allow_low_risk = if candidate.in_network == Some(true) {
                allow_in_network_low_risk
            } else {
                allow_oon_low_risk
            };
            if !allow_low_risk {
                removed.push(candidate);
                continue;
            }
        }

        kept.push(candidate);
    }

    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert(
        "trustedEmptySelectionFallbackUsed".to_string(),
        Value::Bool(false),
    );
    detail.insert(
        "trustedUnderfillFallbackUsed".to_string(),
        Value::Bool(false),
    );
    detail.insert("trustedUnderfillFallbackCount".to_string(), Value::from(0_u64));
    detail.insert("failClosed".to_string(), Value::Bool(true));
    detail.insert(
        "coldStartNewsFallbackEnabled".to_string(),
        Value::Bool(allow_news_cold_start),
    );

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
