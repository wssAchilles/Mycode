use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};
use telegram_component_primitives::filters::{
    AGE_FILTER, AUTHOR_SOCIALGRAPH_FILTER, DUPLICATE_FILTER, MUTED_KEYWORD_FILTER,
    NEWS_EXTERNAL_ID_DEDUP_FILTER, PREVIOUSLY_SERVED_FILTER, RETWEET_DEDUP_FILTER,
    SEEN_POST_FILTER, SELF_POST_FILTER, VF_FILTER,
};
use telegram_filter_primitives::{
    FILTER_DROP_REASON_AGE_LIMIT, FILTER_DROP_REASON_BLOCKED_AUTHOR,
    FILTER_DROP_REASON_DUPLICATE_NEWS_EXTERNAL_ID, FILTER_DROP_REASON_DUPLICATE_POST,
    FILTER_DROP_REASON_MUTED_KEYWORD, FILTER_DROP_REASON_PREVIOUSLY_SERVED,
    FILTER_DROP_REASON_RETWEET_DUPLICATE, FILTER_DROP_REASON_SEEN_POST,
    FILTER_DROP_REASON_SELF_POST, FILTER_DROP_REASON_VISIBILITY_UNSAFE,
};
use telegram_source_primitives::{
    COLD_START_SOURCE, EMBEDDING_AUTHOR_SOURCE, GRAPH_KERNEL_SOURCE, GRAPH_SOURCE, NEWS_ANN_SOURCE,
    POPULAR_SOURCE,
};

use super::context::{env_bool, related_post_ids, space_feed_experiment_flag};

mod common;
mod conversation;
mod detail;
mod quality;

use common::{apply_trusted_underfill_fallback, partition};
use conversation::conversation_dedup_filter;
use detail::{build_disabled_stage, build_stage};
use quality::quality_guard_filter;

const DEFAULT_AGE_LIMIT_DAYS: i64 = 7;
const SPARSE_RECALL_AGE_LIMIT_DAYS: i64 = 180;

const TRUSTED_EMPTY_SELECTION_RECALL_SOURCES: &[&str] = &[
    GRAPH_KERNEL_SOURCE,
    GRAPH_SOURCE,
    EMBEDDING_AUTHOR_SOURCE,
    POPULAR_SOURCE,
    COLD_START_SOURCE,
    NEWS_ANN_SOURCE,
];

const SPARSE_RECALL_SOURCES: &[&str] = &[
    GRAPH_KERNEL_SOURCE,
    GRAPH_SOURCE,
    EMBEDDING_AUTHOR_SOURCE,
    POPULAR_SOURCE,
    COLD_START_SOURCE,
];

pub struct LocalFilterExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub drop_counts: HashMap<String, usize>,
    pub stages: Vec<RecommendationStagePayload>,
}

pub fn run_pre_score_filters(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalFilterExecution {
    let mut current = candidates;
    let mut removed = Vec::new();
    let mut drop_counts = HashMap::new();
    let mut stages = Vec::new();

    for filter in [
        duplicate_filter as FilterFn,
        news_external_id_dedup_filter,
        self_post_filter,
        retweet_dedup_filter,
        age_filter,
        quality_guard_filter,
        author_socialgraph_filter,
        muted_keyword_filter,
        seen_post_filter,
        previously_served_filter,
    ] {
        let (next, mut dropped, stage, enabled) = filter(query, current);
        if enabled {
            drop_counts.insert(stage.name.clone(), stage.removed_count.unwrap_or_default());
            removed.append(&mut dropped);
        }
        current = next;
        stages.push(stage);
    }

    LocalFilterExecution {
        candidates: current,
        drop_counts,
        stages,
    }
}

pub fn run_post_selection_filters(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalFilterExecution {
    let mut current = candidates;
    let mut removed = Vec::new();
    let mut drop_counts = HashMap::new();
    let mut stages = Vec::new();

    for filter in [vf_filter as FilterFn, conversation_dedup_filter] {
        let (next, mut dropped, stage, enabled) = filter(query, current);
        if enabled {
            drop_counts.insert(stage.name.clone(), stage.removed_count.unwrap_or_default());
            removed.append(&mut dropped);
        }
        current = next;
        stages.push(stage);
    }

    LocalFilterExecution {
        candidates: current,
        drop_counts,
        stages,
    }
}

type FilterFn = fn(
    &RecommendationQueryPayload,
    Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
);

fn duplicate_filter(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let mut seen = HashSet::new();
    let mut kept = Vec::new();
    let mut removed = Vec::new();

    for candidate in candidates {
        if seen.insert(candidate.post_id.clone()) {
            kept.push(candidate);
        } else {
            removed.push(candidate);
        }
    }
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            DUPLICATE_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_DUPLICATE_POST),
        ),
        true,
    )
}

fn news_external_id_dedup_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let enable_cluster_dedup =
        space_feed_experiment_flag(query, "enable_news_cluster_dedup", false);
    let mut seen_external = HashSet::new();
    let mut seen_cluster = HashSet::new();
    let mut kept = Vec::new();
    let mut removed = Vec::new();

    for candidate in candidates {
        if candidate.is_news != Some(true) {
            kept.push(candidate);
            continue;
        }

        let external_id = candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.external_id.clone())
            .or_else(|| candidate.model_post_id.clone())
            .unwrap_or_default();
        let cluster_key = if enable_cluster_dedup {
            candidate
                .news_metadata
                .as_ref()
                .and_then(|metadata| metadata.cluster_id)
                .map(|cluster_id| cluster_id.to_string())
                .unwrap_or_default()
        } else {
            String::new()
        };

        if !external_id.is_empty() && !seen_external.insert(external_id) {
            removed.push(candidate);
            continue;
        }
        if !cluster_key.is_empty() && !seen_cluster.insert(cluster_key) {
            removed.push(candidate);
            continue;
        }

        kept.push(candidate);
    }
    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert(
        "clusterDedupEnabled".to_string(),
        Value::Bool(enable_cluster_dedup),
    );

    (
        kept,
        removed,
        build_stage(
            NEWS_EXTERNAL_ID_DEDUP_FILTER,
            input_count,
            removed_count,
            Some(detail),
            Some(FILTER_DROP_REASON_DUPLICATE_NEWS_EXTERNAL_ID),
        ),
        true,
    )
}

fn self_post_filter(
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

fn retweet_dedup_filter(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let mut seen = HashSet::new();
    let mut kept = Vec::new();
    let mut removed = Vec::new();

    for candidate in candidates {
        let canonical = candidate
            .original_post_id
            .clone()
            .unwrap_or_else(|| candidate.post_id.clone());
        if seen.insert(canonical) {
            kept.push(candidate);
        } else {
            removed.push(candidate);
        }
    }
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            RETWEET_DEDUP_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_RETWEET_DUPLICATE),
        ),
        true,
    )
}

fn age_filter(
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

    let now = chrono::Utc::now();
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

fn author_socialgraph_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let features = query.user_features.as_ref();

    let blocked: HashSet<String> = features
        .map(|f| f.blocked_user_ids.iter().cloned().collect())
        .unwrap_or_default();
    let muted: HashSet<String> = features
        .map(|f| f.muted_user_ids.iter().cloned().collect())
        .unwrap_or_default();

    if blocked.is_empty() && muted.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage(AUTHOR_SOCIALGRAPH_FILTER, input_count),
            false,
        );
    }

    let (kept, removed) = partition(candidates, |candidate| {
        // Condition 1: Viewer muted the author
        if muted.contains(&candidate.author_id) {
            return false;
        }
        // Condition 2: Viewer blocked the author
        if blocked.contains(&candidate.author_id) {
            return false;
        }
        // Condition 3: Author blocks the viewer
        if candidate.author_blocks_viewer.unwrap_or(false) {
            return false;
        }
        true
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage(
            AUTHOR_SOCIALGRAPH_FILTER,
            input_count,
            removed_count,
            None,
            Some(FILTER_DROP_REASON_BLOCKED_AUTHOR),
        ),
        true,
    )
}

fn muted_keyword_filter(
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

    // Separate single-word and multi-word phrases for optimized matching
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

        // Check single-word keywords against token set
        let single_match = single_words
            .iter()
            .any(|keyword| tokens.iter().any(|token| *token == *keyword));

        // Check multi-word phrases against consecutive token sequences
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

fn seen_post_filter(
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

    let allow_trusted_fallback = space_feed_experiment_flag(
        query,
        "seen_filter_allow_trusted_empty_selection_recall",
        env_bool("SEEN_FILTER_ALLOW_TRUSTED_EMPTY_SELECTION_RECALL", true),
    );
    let seen = seen_ids.into_iter().collect::<HashSet<_>>();
    let trusted_sources =
        HashSet::<&str>::from_iter(TRUSTED_EMPTY_SELECTION_RECALL_SOURCES.iter().copied());
    let mut kept = Vec::new();
    let mut removed = Vec::new();
    let mut fallback = Vec::new();

    for candidate in candidates {
        let is_seen = related_post_ids(&candidate)
            .into_iter()
            .any(|id| seen.contains(&id));
        if is_seen {
            if allow_trusted_fallback
                && !query.in_network_only
                && candidate
                    .recall_source
                    .as_deref()
                    .is_some_and(|source| trusted_sources.contains(source))
            {
                fallback.push(candidate.clone());
            }
            removed.push(candidate);
        } else {
            kept.push(candidate);
        }
    }

    let fallback_result = apply_trusted_underfill_fallback(
        &mut kept,
        &mut removed,
        fallback,
        query.limit.saturating_mul(3).max(query.limit).max(1),
    );
    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert(
        "trustedEmptySelectionFallbackUsed".to_string(),
        Value::Bool(fallback_result.empty_selection_recovered),
    );
    detail.insert(
        "trustedUnderfillFallbackUsed".to_string(),
        Value::Bool(fallback_result.used_count > 0),
    );
    detail.insert(
        "trustedUnderfillFallbackCount".to_string(),
        Value::from(fallback_result.used_count as u64),
    );

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

fn previously_served_filter(
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

fn vf_filter(
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
    let allow_trusted_fallback = space_feed_experiment_flag(
        query,
        "vf_degrade_allow_trusted_empty_selection_recall",
        env_bool("VF_DEGRADE_ALLOW_TRUSTED_EMPTY_SELECTION_RECALL", true),
    );
    let trusted_sources =
        HashSet::<&str>::from_iter(TRUSTED_EMPTY_SELECTION_RECALL_SOURCES.iter().copied());

    let mut kept = Vec::new();
    let mut removed = Vec::new();
    let mut fallback = Vec::new();

    for candidate in candidates {
        if candidate.is_nsfw == Some(true) {
            removed.push(candidate);
            continue;
        }

        let vf = candidate.vf_result.as_ref();
        if vf.is_none() {
            let keep_unchecked_candidate = candidate.in_network == Some(true)
                || (is_cold_start && allow_news_cold_start && candidate.is_news == Some(true));
            if keep_unchecked_candidate {
                kept.push(candidate);
            } else {
                if allow_trusted_fallback
                    && !query.in_network_only
                    && candidate
                        .recall_source
                        .as_deref()
                        .is_some_and(|source| trusted_sources.contains(source))
                {
                    fallback.push(candidate.clone());
                }
                removed.push(candidate);
            }
            continue;
        }

        let vf = vf.expect("checked");
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
                if allow_trusted_fallback
                    && candidate
                        .recall_source
                        .as_deref()
                        .is_some_and(|source| trusted_sources.contains(source))
                {
                    fallback.push(candidate.clone());
                }
                removed.push(candidate);
                continue;
            }
        }

        kept.push(candidate);
    }

    let fallback_result =
        apply_trusted_underfill_fallback(&mut kept, &mut removed, fallback, query.limit.max(1));
    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert(
        "trustedEmptySelectionFallbackUsed".to_string(),
        Value::Bool(fallback_result.empty_selection_recovered),
    );
    detail.insert(
        "trustedUnderfillFallbackUsed".to_string(),
        Value::Bool(fallback_result.used_count > 0),
    );
    detail.insert(
        "trustedUnderfillFallbackCount".to_string(),
        Value::from(fallback_result.used_count as u64),
    );
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

#[cfg(test)]
mod tests;
