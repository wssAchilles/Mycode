//! 内容卫生过滤器组：负责自帖过滤、时效性窗口限制以及屏蔽关键词匹配。

use std::collections::HashSet;

use telegram_component_primitives::filters::{AGE_FILTER, MUTED_KEYWORD_FILTER, SELF_POST_FILTER};
use telegram_filter_primitives::{
    FILTER_DROP_REASON_AGE_LIMIT, FILTER_DROP_REASON_MUTED_KEYWORD, FILTER_DROP_REASON_SELF_POST,
};
use telegram_source_primitives::{
    COLD_START_SOURCE, EMBEDDING_AUTHOR_SOURCE, GRAPH_KERNEL_SOURCE, GRAPH_SOURCE, POPULAR_SOURCE,
};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::super::clock::ranking_now;
use super::common::partition;
use super::detail::{build_disabled_stage, build_stage};

const DEFAULT_AGE_LIMIT_DAYS: i64 = 7;
const SPARSE_RECALL_AGE_LIMIT_DAYS: i64 = 180;

const SPARSE_RECALL_SOURCES: &[&str] = &[
    GRAPH_KERNEL_SOURCE,
    GRAPH_SOURCE,
    EMBEDDING_AUTHOR_SOURCE,
    POPULAR_SOURCE,
    COLD_START_SOURCE,
];

/// 过滤用户自己发布的帖子（含精选外域混排链路）。
pub(super) fn self_post_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let (kept, removed) = partition(candidates, |candidate| candidate.author_id != query.user_id);
    let removed_count = input_count.saturating_sub(kept.len());
    (
        kept,
        removed,
        build_stage(
            SELF_POST_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_SELF_POST),
        ),
        true,
    )
}

/// 对非稀疏召回源执行标准时效性截断，并对冷启/图召回保留更长回溯窗口。
pub(super) fn age_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    if query.in_network_only {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(AGE_FILTER, input_count),
            false,
        );
    }

    let now = ranking_now();
    let sparse_sources = HashSet::<&str>::from_iter(SPARSE_RECALL_SOURCES.iter().copied());
    let (kept, removed) = partition(candidates, |candidate| {
        let max_age_days = candidate
            .recall_source
            .as_deref()
            .filter(|source| sparse_sources.contains(source))
            .map(|_| SPARSE_RECALL_AGE_LIMIT_DAYS)
            .unwrap_or(DEFAULT_AGE_LIMIT_DAYS);
        now.signed_duration_since(candidate.created_at).num_days() <= max_age_days
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            AGE_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_AGE_LIMIT),
        ),
        true,
    )
}

/// 按用户配置的屏蔽词与短语窗口拦截命中内容。
pub(super) fn muted_keyword_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let muted_keywords = query
        .user_features
        .as_ref()
        .map(|features| {
            features
                .muted_keywords
                .iter()
                .map(|keyword| keyword.trim().to_lowercase())
                .filter(|keyword| !keyword.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if muted_keywords.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(MUTED_KEYWORD_FILTER, input_count),
            false,
        );
    }

    let single_words: Vec<&str> = muted_keywords
        .iter()
        .filter(|kw| !kw.contains(char::is_whitespace))
        .map(|kw| kw.as_str())
        .collect();
    let phrases: Vec<Vec<&str>> = muted_keywords
        .iter()
        .filter(|kw| kw.contains(char::is_whitespace))
        .map(|kw| kw.split_whitespace().collect())
        .collect();

    let (kept, removed) = partition(candidates, |candidate| {
        let content = candidate.content.to_lowercase();
        let tokens: Vec<&str> = content.split_whitespace().collect();

        let single_match = single_words.iter().any(|keyword| tokens.contains(keyword));
        let phrase_match = phrases.iter().any(|phrase| {
            tokens
                .windows(phrase.len())
                .any(|window| window == phrase.as_slice())
        });

        !single_match && !phrase_match
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            MUTED_KEYWORD_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_MUTED_KEYWORD),
        ),
        true,
    )
}
