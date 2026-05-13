use std::collections::HashMap;

use serde_json::Value;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use telegram_component_primitives::filters::QUALITY_GUARD_FILTER;
use telegram_filter_primitives::{
    FILTER_DROP_REASON_COUNTS_FIELD, QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT,
    QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT, QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT,
    QUALITY_GUARD_EMPTY_CONTENT_COUNT_FIELD, QUALITY_GUARD_ULTRA_SHORT_TEXT_COUNT_FIELD,
    QUALITY_GUARD_UNSAFE_COUNT_FIELD, QualityGuardInput,
};

use super::super::context::space_feed_experiment_flag;
use super::super::filter_decision::drop_reason_counts;
use super::detail::{build_disabled_stage, build_stage};

pub(super) fn quality_guard_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let enabled = space_feed_experiment_flag(query, "enable_quality_guard_filter", true);
    if !enabled {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(QUALITY_GUARD_FILTER, input_count),
            false,
        );
    }

    let mut kept = Vec::new();
    let mut removed = Vec::new();
    let mut empty_content_count = 0usize;
    let mut unsafe_count = 0usize;
    let mut ultra_short_count = 0usize;

    for candidate in candidates {
        let reason = quality_guard_drop_reason(&candidate);
        match reason {
            Some(QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT) => {
                unsafe_count += 1;
                removed.push(candidate);
            }
            Some(QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT) => {
                empty_content_count += 1;
                removed.push(candidate);
            }
            Some(QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT) => {
                ultra_short_count += 1;
                removed.push(candidate);
            }
            _ => kept.push(candidate),
        }
    }

    let removed_count = input_count.saturating_sub(kept.len());
    let mut detail = HashMap::new();
    detail.insert(
        QUALITY_GUARD_EMPTY_CONTENT_COUNT_FIELD.to_string(),
        Value::from(empty_content_count as u64),
    );
    detail.insert(
        QUALITY_GUARD_UNSAFE_COUNT_FIELD.to_string(),
        Value::from(unsafe_count as u64),
    );
    detail.insert(
        QUALITY_GUARD_ULTRA_SHORT_TEXT_COUNT_FIELD.to_string(),
        Value::from(ultra_short_count as u64),
    );
    detail.insert(
        FILTER_DROP_REASON_COUNTS_FIELD.to_string(),
        drop_reason_counts(&[
            (QUALITY_GUARD_DROP_REASON_EMPTY_CONTENT, empty_content_count),
            (QUALITY_GUARD_DROP_REASON_UNSAFE_CONTENT, unsafe_count),
            (
                QUALITY_GUARD_DROP_REASON_ULTRA_SHORT_TEXT,
                ultra_short_count,
            ),
        ]),
    );

    (
        kept,
        removed,
        build_stage(
            QUALITY_GUARD_FILTER,
            input_count,
            removed_count,
            Some(detail),
            None,
        ),
        true,
    )
}

fn quality_guard_drop_reason(candidate: &RecommendationCandidatePayload) -> Option<&'static str> {
    let content_len = candidate.content.trim().chars().count();
    let has_media = candidate.has_image == Some(true)
        || candidate.has_video == Some(true)
        || candidate
            .media
            .as_ref()
            .is_some_and(|items| !items.is_empty());
    let has_news_payload = candidate.news_metadata.as_ref().is_some_and(|metadata| {
        metadata
            .title
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            || metadata
                .summary
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
            || metadata
                .url
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
            || metadata
                .source_url
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
    });
    telegram_filter_primitives::quality_guard_drop_reason(QualityGuardInput {
        is_nsfw: candidate.is_nsfw == Some(true),
        content_len,
        has_media,
        has_news_payload,
    })
}
