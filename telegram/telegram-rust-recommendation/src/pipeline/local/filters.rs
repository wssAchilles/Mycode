use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

use super::context::{env_bool, related_post_ids, space_feed_experiment_flag};

const LOCAL_EXECUTION_MODE: &str = "rust_local_rules_v1";
const DEFAULT_AGE_LIMIT_DAYS: i64 = 7;
const SPARSE_RECALL_AGE_LIMIT_DAYS: i64 = 180;

const TRUSTED_EMPTY_SELECTION_RECALL_SOURCES: &[&str] = &[
    "GraphKernelSource",
    "GraphSource",
    "EmbeddingAuthorSource",
    "PopularSource",
    "ColdStartSource",
    "NewsAnnSource",
];

const SPARSE_RECALL_SOURCES: &[&str] = &[
    "GraphKernelSource",
    "GraphSource",
    "EmbeddingAuthorSource",
    "PopularSource",
    "ColdStartSource",
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
        blocked_user_filter,
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
        build_stage("DuplicateFilter", input_count, removed_count, None),
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
            "NewsExternalIdDedupFilter",
            input_count,
            removed_count,
            Some(detail),
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
        build_stage("SelfPostFilter", input_count, removed_count, None),
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
        build_stage("RetweetDedupFilter", input_count, removed_count, None),
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
            build_disabled_stage("AgeFilter", input_count),
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
        build_stage("AgeFilter", input_count, removed_count, None),
        true,
    )
}

fn blocked_user_filter(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let blocked = query
        .user_features
        .as_ref()
        .map(|features| features.blocked_user_ids.clone())
        .unwrap_or_default();
    if blocked.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage("BlockedUserFilter", input_count),
            false,
        );
    }

    let blocked = blocked.into_iter().collect::<HashSet<_>>();
    let (kept, removed) = partition(candidates, |candidate| {
        !blocked.contains(&candidate.author_id)
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage("BlockedUserFilter", input_count, removed_count, None),
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
            build_disabled_stage("MutedKeywordFilter", input_count),
            false,
        );
    }

    let (kept, removed) = partition(candidates, |candidate| {
        let content = candidate.content.to_lowercase();
        !muted_keywords
            .iter()
            .any(|keyword| content.contains(keyword.as_str()))
    });
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage("MutedKeywordFilter", input_count, removed_count, None),
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
    let seen_ids = if !query.seen_ids.is_empty() {
        query.seen_ids.clone()
    } else {
        query
            .user_features
            .as_ref()
            .map(|features| features.seen_post_ids.clone())
            .unwrap_or_default()
    };
    if query.in_network_only || seen_ids.is_empty() {
        return (
            candidates,
            Vec::new(),
            build_disabled_stage("SeenPostFilter", input_count),
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

    let fallback_used = kept.is_empty() && !fallback.is_empty();
    if fallback_used {
        let fallback_ids = fallback
            .iter()
            .map(|candidate| candidate.post_id.clone())
            .collect::<HashSet<_>>();
        removed.retain(|candidate| !fallback_ids.contains(&candidate.post_id));
        kept = fallback;
    }
    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert(
        "trustedEmptySelectionFallbackUsed".to_string(),
        Value::Bool(fallback_used),
    );

    (
        kept,
        removed,
        build_stage("SeenPostFilter", input_count, removed_count, Some(detail)),
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
            build_disabled_stage("PreviouslyServedFilter", input_count),
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
        build_stage("PreviouslyServedFilter", input_count, removed_count, None),
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
            if candidate.in_network == Some(true) {
                kept.push(candidate);
            } else if is_cold_start && allow_news_cold_start && candidate.is_news == Some(true) {
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

    let fallback_used = kept.is_empty() && !fallback.is_empty();
    if fallback_used {
        let fallback_ids = fallback
            .iter()
            .map(|candidate| candidate.post_id.clone())
            .collect::<HashSet<_>>();
        removed.retain(|candidate| !fallback_ids.contains(&candidate.post_id));
        kept = fallback;
    }
    let removed_count = input_count.saturating_sub(kept.len());

    let mut detail = HashMap::new();
    detail.insert(
        "trustedEmptySelectionFallbackUsed".to_string(),
        Value::Bool(fallback_used),
    );
    detail.insert(
        "coldStartNewsFallbackEnabled".to_string(),
        Value::Bool(allow_news_cold_start),
    );

    (
        kept,
        removed,
        build_stage("VFFilter", input_count, removed_count, Some(detail)),
        true,
    )
}

fn conversation_dedup_filter(
    _query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
    RecommendationStagePayload,
    bool,
) {
    let input_count = candidates.len();
    let mut kept: Vec<RecommendationCandidatePayload> = Vec::new();
    let mut removed = Vec::new();
    let mut best_by_conversation: HashMap<String, (usize, f64)> = HashMap::new();

    for candidate in candidates {
        let key = candidate
            .conversation_id
            .clone()
            .unwrap_or_else(|| candidate.post_id.clone());
        let score = candidate.score.unwrap_or_default();
        match best_by_conversation.get(&key).copied() {
            Some((index, existing_score)) if score > existing_score => {
                removed.push(kept[index].clone());
                kept[index] = candidate;
                best_by_conversation.insert(key, (index, score));
            }
            Some(_) => removed.push(candidate),
            None => {
                best_by_conversation.insert(key, (kept.len(), score));
                kept.push(candidate);
            }
        }
    }
    let removed_count = input_count.saturating_sub(kept.len());

    (
        kept,
        removed,
        build_stage("ConversationDedupFilter", input_count, removed_count, None),
        true,
    )
}

fn partition(
    candidates: Vec<RecommendationCandidatePayload>,
    keep: impl Fn(&RecommendationCandidatePayload) -> bool,
) -> (
    Vec<RecommendationCandidatePayload>,
    Vec<RecommendationCandidatePayload>,
) {
    let mut kept = Vec::new();
    let mut removed = Vec::new();
    for candidate in candidates {
        if keep(&candidate) {
            kept.push(candidate);
        } else {
            removed.push(candidate);
        }
    }
    (kept, removed)
}

fn build_disabled_stage(name: &str, input_count: usize) -> RecommendationStagePayload {
    RecommendationStagePayload {
        name: name.to_string(),
        enabled: false,
        duration_ms: 0,
        input_count,
        output_count: input_count,
        removed_count: Some(0),
        detail: Some(HashMap::from([(
            "executionMode".to_string(),
            Value::String(LOCAL_EXECUTION_MODE.to_string()),
        )])),
    }
}

fn build_stage(
    name: &str,
    input_count: usize,
    removed_count: usize,
    detail: Option<HashMap<String, Value>>,
) -> RecommendationStagePayload {
    let mut detail = detail.unwrap_or_default();
    detail.insert(
        "executionMode".to_string(),
        Value::String(LOCAL_EXECUTION_MODE.to_string()),
    );
    detail.insert("owner".to_string(), Value::String("rust".to_string()));

    RecommendationStagePayload {
        name: name.to_string(),
        enabled: true,
        duration_ms: 0,
        input_count,
        output_count: input_count.saturating_sub(removed_count),
        removed_count: Some(removed_count),
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use crate::contracts::{
        CandidateNewsMetadataPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
        UserFeaturesPayload, UserStateContextPayload,
    };

    use super::{run_post_selection_filters, run_pre_score_filters};

    fn query() -> RecommendationQueryPayload {
        RecommendationQueryPayload {
            request_id: "req-local-filters".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 20,
            cursor: None,
            in_network_only: false,
            seen_ids: vec!["seen-post".to_string()],
            served_ids: vec!["served-post".to_string()],
            is_bottom_request: true,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: Some(UserFeaturesPayload {
                followed_user_ids: vec!["author-a".to_string()],
                blocked_user_ids: vec!["blocked-author".to_string()],
                muted_keywords: vec!["spoiler".to_string()],
                seen_post_ids: Vec::new(),
                follower_count: None,
                account_created_at: None,
            }),
            embedding_context: None,
            user_state_context: Some(UserStateContextPayload {
                state: "warm".to_string(),
                reason: "test".to_string(),
                followed_count: 1,
                recent_action_count: 2,
                recent_positive_action_count: 1,
                usable_embedding: true,
                account_age_days: Some(10),
            }),
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
        }
    }

    fn candidate(post_id: &str, author_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: Some(post_id.to_string()),
            author_id: author_id.to_string(),
            content: "clean content".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("GraphSource".to_string()),
            retrieval_lane: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: None,
            weighted_score: Some(1.0),
            score: Some(1.0),
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    #[test]
    fn local_pre_score_filters_drop_seen_muted_blocked_and_served_candidates() {
        let mut blocked = candidate("blocked", "blocked-author");
        blocked.content = "clean".to_string();
        let mut muted = candidate("muted", "author-b");
        muted.content = "contains spoiler".to_string();
        let seen = candidate("seen-post", "author-c");
        let served = candidate("served-post", "author-d");

        let result = run_pre_score_filters(&query(), vec![blocked, muted, seen, served]);
        assert!(result.candidates.is_empty());
        assert_eq!(result.drop_counts.get("BlockedUserFilter"), Some(&1));
        assert_eq!(result.drop_counts.get("MutedKeywordFilter"), Some(&1));
        assert_eq!(result.drop_counts.get("SeenPostFilter"), Some(&1));
        assert_eq!(result.drop_counts.get("PreviouslyServedFilter"), Some(&1));
    }

    #[test]
    fn post_selection_filters_keep_best_conversation_and_safe_candidates() {
        let mut first = candidate("post-1", "author-a");
        first.conversation_id = Some("conv-1".to_string());
        first.score = Some(1.0);
        first.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
            safe: true,
            ..Default::default()
        });

        let mut second = candidate("post-2", "author-b");
        second.conversation_id = Some("conv-1".to_string());
        second.score = Some(2.0);
        second.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
            safe: true,
            ..Default::default()
        });

        let mut unsafe_candidate = candidate("post-3", "author-c");
        unsafe_candidate.score = Some(3.0);
        unsafe_candidate.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
            safe: false,
            ..Default::default()
        });

        let mut news = candidate("post-4", "author-d");
        news.is_news = Some(true);
        news.news_metadata = Some(CandidateNewsMetadataPayload {
            external_id: Some("news-1".to_string()),
            ..CandidateNewsMetadataPayload::default()
        });
        news.vf_result = Some(crate::contracts::CandidateVisibilityPayload {
            safe: true,
            ..Default::default()
        });

        let result =
            run_post_selection_filters(&query(), vec![first, second, unsafe_candidate, news]);
        assert_eq!(result.candidates.len(), 2);
        assert!(
            result
                .candidates
                .iter()
                .any(|candidate| candidate.post_id == "post-2")
        );
        assert!(
            result
                .candidates
                .iter()
                .any(|candidate| candidate.post_id == "post-4")
        );
    }
}
