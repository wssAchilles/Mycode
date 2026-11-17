//! 曝光疲劳过滤器组：严格屏蔽已曝光（Seen）和翻页已下发（Served）候选，不保留信任召回回流后门。

use std::collections::{HashMap, HashSet};

use serde_json::Value;
use telegram_component_primitives::filters::{PREVIOUSLY_SERVED_FILTER, SEEN_POST_FILTER};
use telegram_filter_primitives::{
    FILTER_DROP_REASON_PREVIOUSLY_SERVED, FILTER_DROP_REASON_SEEN_POST,
};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::super::context::related_post_ids;
use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

/// 严格拦截用户已看过（包含转发/引用关联 ID）的帖子，即使列表欠满也禁止已看帖回流。
pub(super) fn seen_post_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let seen_ids = query.effective_seen_ids();
    if query.in_network_only || seen_ids.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(SEEN_POST_FILTER, input_count),
            false,
        );
    }

    let seen = seen_ids.into_iter().collect::<HashSet<_>>();
    let (kept, removed) = partition(candidates, |candidate| {
        !related_post_ids(candidate)
            .into_iter()
            .any(|id| seen.contains(&id))
    });
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
    detail.insert(
        "trustedUnderfillFallbackCount".to_string(),
        Value::from(0_u64),
    );
    detail.insert("failClosed".to_string(), Value::Bool(true));

    (
        kept,
        removed,
        build_stage(
            SEEN_POST_FILTER,
            input_count,
            removed_count,
            Some(detail),
            Some(FILTER_DROP_REASON_SEEN_POST),
        ),
        true,
    )
}

/// 翻页加载（Bottom request）时拦截本会话已下发给前端的帖子，防止重复出现。
pub(super) fn previously_served_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    if !query.is_bottom_request || query.served_ids.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(PREVIOUSLY_SERVED_FILTER, input_count),
            false,
        );
    }

    let served = query.served_ids.iter().cloned().collect::<HashSet<_>>();
    let (kept, removed) = partition(candidates, |candidate| {
        !related_post_ids(candidate)
            .into_iter()
            .any(|id| served.contains(&id))
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            PREVIOUSLY_SERVED_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_PREVIOUSLY_SERVED),
        ),
        true,
    )
}
