use std::collections::{HashMap, HashSet};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::pipeline::local::context::{ranking_policy_usize, source_retrieval_lane};

const AUTHOR_SOFT_CAP_REASON: &str = "author_soft_cap";
const CONTENT_DUPLICATE_REASON: &str = "content_duplicate";
const CONVERSATION_DUPLICATE_REASON: &str = "conversation_duplicate";
const CROSS_PAGE_AUTHOR_SOFT_CAP_REASON: &str = "cross_page_author_soft_cap";
const CROSS_PAGE_SOURCE_SOFT_CAP_REASON: &str = "cross_page_source_soft_cap";
const CROSS_PAGE_TOPIC_SOFT_CAP_REASON: &str = "cross_page_topic_soft_cap";
const SERVED_STATE_REASON: &str = "served_state_duplicate";

#[derive(Debug, Clone)]
pub struct ServingDedupResult {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub has_more: bool,
    pub page_remaining_count: usize,
    pub page_underfilled: bool,
    pub page_underfill_reason: Option<String>,
    pub duplicate_suppressed_count: usize,
    pub cross_page_duplicate_count: usize,
    pub suppression_reasons: HashMap<String, usize>,
}

pub fn dedup_for_serving(
    query: &RecommendationQueryPayload,
    candidates: &[RecommendationCandidatePayload],
    limit: usize,
    author_soft_cap: usize,
) -> ServingDedupResult {
    let served_state = query
        .served_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    let served_author_counts = served_context_counts(&served_state, "author:");
    let served_source_counts = served_context_counts(&served_state, "source:");
    let served_topic_counts = served_context_counts(&served_state, "topic:");
    let cross_request_author_soft_cap =
        ranking_policy_usize(query, "cross_request_author_soft_cap", 0);
    let cross_request_source_soft_cap =
        ranking_policy_usize(query, "cross_request_source_soft_cap", 0);
    let cross_request_topic_soft_cap =
        ranking_policy_usize(query, "cross_request_topic_soft_cap", 0);

    let mut kept = Vec::with_capacity(candidates.len());
    let mut deferred_author_soft_cap = Vec::new();
    let mut deferred_cross_request_soft_cap = Vec::new();
    let mut seen_related_ids = HashSet::new();
    let mut seen_conversations = HashSet::new();
    let mut author_counts = HashMap::new();
    let mut source_counts = HashMap::new();
    let mut topic_counts = HashMap::new();
    let mut suppression_reasons = HashMap::new();
    let mut cross_page_duplicate_count = 0usize;

    for candidate in candidates.iter().cloned() {
        let related_ids = related_ids(&candidate);
        if related_ids.iter().any(|id| served_state.contains(id)) {
            *suppression_reasons
                .entry(SERVED_STATE_REASON.to_string())
                .or_insert(0) += 1;
            cross_page_duplicate_count = cross_page_duplicate_count.saturating_add(1);
            continue;
        }

        if related_ids.iter().any(|id| seen_related_ids.contains(id)) {
            *suppression_reasons
                .entry(CONTENT_DUPLICATE_REASON.to_string())
                .or_insert(0) += 1;
            continue;
        }

        if let Some(conversation_id) = candidate.conversation_id.as_ref() {
            if seen_conversations.contains(conversation_id) {
                *suppression_reasons
                    .entry(CONVERSATION_DUPLICATE_REASON.to_string())
                    .or_insert(0) += 1;
                continue;
            }
        }

        if let Some(reason) = cross_request_soft_cap_reason(
            &candidate,
            &served_author_counts,
            &served_source_counts,
            &served_topic_counts,
            &author_counts,
            &source_counts,
            &topic_counts,
            cross_request_author_soft_cap,
            cross_request_source_soft_cap,
            cross_request_topic_soft_cap,
        ) {
            deferred_cross_request_soft_cap.push((candidate, related_ids, reason));
            continue;
        }

        let author_entry = author_counts
            .entry(candidate.author_id.clone())
            .or_insert(0usize);
        if author_soft_cap > 0 && *author_entry >= author_soft_cap {
            deferred_author_soft_cap.push((candidate, related_ids));
            continue;
        }

        *author_entry += 1;
        record_candidate_state(
            &candidate,
            &related_ids,
            &mut seen_related_ids,
            &mut seen_conversations,
            &mut source_counts,
            &mut topic_counts,
        );
        kept.push(candidate);
    }

    let mut reinserted_cross_request_soft_cap_indexes = HashSet::new();
    if limit > 0 && kept.len() < limit {
        let needed = limit.saturating_sub(kept.len());
        for (index, (candidate, related_ids, _)) in
            deferred_cross_request_soft_cap.iter().enumerate()
        {
            if reinserted_cross_request_soft_cap_indexes.len() >= needed {
                break;
            }
            if related_ids.iter().any(|id| seen_related_ids.contains(id)) {
                continue;
            }
            if candidate
                .conversation_id
                .as_ref()
                .is_some_and(|conversation_id| seen_conversations.contains(conversation_id))
            {
                continue;
            }
            let author_entry = author_counts
                .entry(candidate.author_id.clone())
                .or_insert(0usize);
            *author_entry += 1;
            record_candidate_state(
                candidate,
                related_ids,
                &mut seen_related_ids,
                &mut seen_conversations,
                &mut source_counts,
                &mut topic_counts,
            );
            kept.push(candidate.clone());
            reinserted_cross_request_soft_cap_indexes.insert(index);
        }
    }

    let mut reinserted_author_soft_cap = 0usize;
    if limit > 0 && kept.len() < limit {
        let needed = limit.saturating_sub(kept.len());
        for (candidate, related_ids) in deferred_author_soft_cap.iter().take(needed) {
            if related_ids.iter().any(|id| seen_related_ids.contains(id)) {
                continue;
            }
            if candidate
                .conversation_id
                .as_ref()
                .is_some_and(|conversation_id| seen_conversations.contains(conversation_id))
            {
                continue;
            }
            let author_entry = author_counts
                .entry(candidate.author_id.clone())
                .or_insert(0usize);
            *author_entry += 1;
            record_candidate_state(
                candidate,
                related_ids,
                &mut seen_related_ids,
                &mut seen_conversations,
                &mut source_counts,
                &mut topic_counts,
            );
            kept.push(candidate.clone());
            reinserted_author_soft_cap = reinserted_author_soft_cap.saturating_add(1);
        }
    }

    let mut cross_request_suppressed = 0usize;
    for (index, (_, _, reason)) in deferred_cross_request_soft_cap.iter().enumerate() {
        if reinserted_cross_request_soft_cap_indexes.contains(&index) {
            continue;
        }
        *suppression_reasons
            .entry((*reason).to_string())
            .or_insert(0) += 1;
        cross_request_suppressed = cross_request_suppressed.saturating_add(1);
    }

    let author_soft_cap_suppressed = deferred_author_soft_cap
        .len()
        .saturating_sub(reinserted_author_soft_cap);
    if author_soft_cap_suppressed > 0 {
        *suppression_reasons
            .entry(AUTHOR_SOFT_CAP_REASON.to_string())
            .or_insert(0) += author_soft_cap_suppressed;
    }

    let page_remaining_count = kept
        .len()
        .saturating_sub(limit)
        .saturating_add(cross_request_suppressed)
        .saturating_add(author_soft_cap_suppressed);
    let has_more = page_remaining_count > 0;
    if limit > 0 && kept.len() > limit {
        kept.truncate(limit);
    }

    let duplicate_suppressed_count = suppression_reasons.values().sum();
    let page_underfilled = limit > 0 && kept.len() < limit;
    let page_underfill_reason = page_underfilled.then(|| {
        if cross_page_duplicate_count > 0 && author_soft_cap_suppressed == 0 {
            "cross_page_suppressed".to_string()
        } else if cross_request_suppressed > 0 && author_soft_cap_suppressed == 0 {
            "cross_page_soft_cap".to_string()
        } else if author_soft_cap_suppressed > 0
            && duplicate_suppressed_count == author_soft_cap_suppressed
        {
            "author_soft_cap".to_string()
        } else if duplicate_suppressed_count > 0 {
            "suppression_mixed".to_string()
        } else {
            "supply_exhausted".to_string()
        }
    });

    ServingDedupResult {
        candidates: kept,
        has_more,
        page_remaining_count,
        page_underfilled,
        page_underfill_reason,
        duplicate_suppressed_count,
        cross_page_duplicate_count,
        suppression_reasons,
    }
}

fn record_candidate_state(
    candidate: &RecommendationCandidatePayload,
    related_ids: &[String],
    seen_related_ids: &mut HashSet<String>,
    seen_conversations: &mut HashSet<String>,
    source_counts: &mut HashMap<String, usize>,
    topic_counts: &mut HashMap<String, usize>,
) {
    for id in related_ids {
        seen_related_ids.insert(id.clone());
    }

    if let Some(conversation_id) = candidate.conversation_id.as_ref() {
        seen_conversations.insert(conversation_id.clone());
    }

    if let Some(source_key) = candidate_source_context_key(candidate) {
        *source_counts.entry(source_key).or_insert(0) += 1;
    }
    if let Some(topic_key) = candidate_topic_context_key(candidate) {
        *topic_counts.entry(topic_key).or_insert(0) += 1;
    }
}

fn cross_request_soft_cap_reason(
    candidate: &RecommendationCandidatePayload,
    served_author_counts: &HashMap<String, usize>,
    served_source_counts: &HashMap<String, usize>,
    served_topic_counts: &HashMap<String, usize>,
    author_counts: &HashMap<String, usize>,
    source_counts: &HashMap<String, usize>,
    topic_counts: &HashMap<String, usize>,
    author_cap: usize,
    source_cap: usize,
    topic_cap: usize,
) -> Option<&'static str> {
    if author_cap > 0
        && context_count(served_author_counts, author_counts, &candidate.author_id) >= author_cap
    {
        return Some(CROSS_PAGE_AUTHOR_SOFT_CAP_REASON);
    }

    if source_cap > 0 {
        if let Some(source_key) = candidate_source_context_key(candidate) {
            if context_count(served_source_counts, source_counts, &source_key) >= source_cap {
                return Some(CROSS_PAGE_SOURCE_SOFT_CAP_REASON);
            }
        }
    }

    if topic_cap > 0 {
        if let Some(topic_key) = candidate_topic_context_key(candidate) {
            if context_count(served_topic_counts, topic_counts, &topic_key) >= topic_cap {
                return Some(CROSS_PAGE_TOPIC_SOFT_CAP_REASON);
            }
        }
    }

    None
}

fn context_count(
    served_counts: &HashMap<String, usize>,
    current_counts: &HashMap<String, usize>,
    key: &str,
) -> usize {
    served_counts
        .get(key)
        .copied()
        .unwrap_or_default()
        .saturating_add(current_counts.get(key).copied().unwrap_or_default())
}

fn served_context_counts(served_state: &HashSet<String>, prefix: &str) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for value in served_state {
        let Some(key) = value.strip_prefix(prefix) else {
            continue;
        };
        let key = normalize_context_key(key);
        if !key.is_empty() {
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    counts
}

fn candidate_source_context_key(candidate: &RecommendationCandidatePayload) -> Option<String> {
    candidate
        .recall_source
        .as_deref()
        .or(candidate.retrieval_lane.as_deref())
        .map(normalize_context_key)
        .filter(|value| !value.is_empty())
        .or_else(|| Some(normalize_context_key(source_retrieval_lane(""))))
}

fn candidate_topic_context_key(candidate: &RecommendationCandidatePayload) -> Option<String> {
    if let Some(cluster_id) = candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
    {
        return Some(format!("news_cluster:{cluster_id}"));
    }
    if let Some(conversation_id) = candidate
        .conversation_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!(
            "conversation:{}",
            normalize_context_key(conversation_id)
        ));
    }
    if let Some(pool_kind) = candidate
        .interest_pool_kind
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!(
            "interest_pool:{}",
            normalize_context_key(pool_kind)
        ));
    }
    Some(format!("format:{}", candidate_format_key(candidate)))
}

fn candidate_format_key(candidate: &RecommendationCandidatePayload) -> &'static str {
    if candidate.is_news == Some(true) {
        "news"
    } else if candidate.has_video == Some(true) {
        "video"
    } else if candidate.has_image == Some(true) {
        "image"
    } else if candidate.is_reply {
        "reply"
    } else if candidate.is_repost {
        "repost"
    } else {
        "text"
    }
}

fn normalize_context_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn related_ids(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();

    for value in [
        candidate.model_post_id.as_ref(),
        Some(&candidate.post_id),
        candidate.original_post_id.as_ref(),
        candidate.reply_to_post_id.as_ref(),
        candidate.conversation_id.as_ref(),
    ] {
        if let Some(value) = value {
            push_unique_id(&mut ids, &mut seen, value);
        }
    }

    if candidate.is_news == Some(true) {
        if let Some(metadata) = candidate.news_metadata.as_ref() {
            if let Some(external_id) = metadata.external_id.as_ref() {
                push_unique_id(&mut ids, &mut seen, external_id);
            }
            if let Some(cluster_id) = metadata.cluster_id {
                push_unique_id(&mut ids, &mut seen, &format!("news:cluster:{cluster_id}"));
            }
        }
    }

    ids
}

fn push_unique_id(ids: &mut Vec<String>, seen: &mut HashSet<String>, value: &str) {
    let value = value.trim();
    if value.is_empty() || !seen.insert(value.to_string()) {
        return;
    }
    ids.push(value.to_string());
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use chrono::Utc;

    use crate::contracts::RecommendationCandidatePayload;
    use crate::contracts::query::RankingPolicyPayload;

    use super::dedup_for_serving;

    fn candidate(
        post_id: &str,
        author_id: &str,
        conversation_id: Option<&str>,
    ) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: author_id.to_string(),
            content: "content".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            conversation_id: conversation_id.map(ToOwned::to_owned),
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("GraphSource".to_string()),
            retrieval_lane: None,
            interest_pool_kind: None,
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
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
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
    fn suppresses_cross_page_duplicates_from_served_state() {
        let query = crate::contracts::RecommendationQueryPayload {
            request_id: "req-1".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 10,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: vec!["post-1".to_string()],
            is_bottom_request: true,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        };

        let result = dedup_for_serving(
            &query,
            &[
                candidate("post-1", "author-1", None),
                candidate("post-2", "author-2", None),
            ],
            10,
            2,
        );

        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.cross_page_duplicate_count, 1);
        assert_eq!(
            result
                .suppression_reasons
                .get("served_state_duplicate")
                .copied(),
            Some(1)
        );
        assert_eq!(
            result.page_underfill_reason.as_deref(),
            Some("cross_page_suppressed")
        );
    }

    #[test]
    fn backfills_author_soft_cap_when_page_would_underfill() {
        let query = crate::contracts::RecommendationQueryPayload {
            request_id: "req-2".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 3,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        };
        let candidates = vec![
            candidate("post-1", "author-1", None),
            candidate("post-2", "author-1", None),
            candidate("post-3", "author-1", None),
        ];

        let result = dedup_for_serving(&query, &candidates, 3, 2);

        assert_eq!(result.candidates.len(), 3);
        assert_eq!(
            result
                .suppression_reasons
                .get("author_soft_cap")
                .copied()
                .unwrap_or_default(),
            0
        );
        assert!(!result.page_underfilled);
    }

    #[test]
    fn reports_remaining_candidates_when_page_has_more_after_truncation() {
        let query = crate::contracts::RecommendationQueryPayload {
            request_id: "req-3".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 2,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: Vec::new(),
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        };
        let candidates = vec![
            candidate("post-1", "author-1", None),
            candidate("post-2", "author-2", None),
            candidate("post-3", "author-3", None),
        ];

        let result = dedup_for_serving(&query, &candidates, 2, 0);

        assert!(result.has_more);
        assert_eq!(result.page_remaining_count, 1);
        assert!(!result.page_underfilled);
        assert_eq!(result.candidates.len(), 2);
    }

    #[test]
    fn soft_suppresses_cross_page_author_context_without_hard_dedup() {
        let query = crate::contracts::RecommendationQueryPayload {
            request_id: "req-4".to_string(),
            user_id: "viewer-1".to_string(),
            limit: 1,
            cursor: None,
            in_network_only: false,
            seen_ids: Vec::new(),
            served_ids: vec!["author:author-1".to_string()],
            is_bottom_request: true,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: None,
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: Some(RankingPolicyPayload {
                cross_request_author_soft_cap: Some(1),
                ..RankingPolicyPayload::default()
            }),
        };
        let candidates = vec![
            candidate("post-1", "author-1", None),
            candidate("post-2", "author-2", None),
        ];

        let result = dedup_for_serving(&query, &candidates, 1, 2);

        assert_eq!(result.candidates[0].post_id, "post-2");
        assert_eq!(
            result
                .suppression_reasons
                .get("cross_page_author_soft_cap")
                .copied(),
            Some(1)
        );
        assert!(result.has_more);
    }
}
