use std::collections::{HashMap, HashSet};

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

const AUTHOR_SOFT_CAP_REASON: &str = "author_soft_cap";
const CONTENT_DUPLICATE_REASON: &str = "content_duplicate";
const CONVERSATION_DUPLICATE_REASON: &str = "conversation_duplicate";
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

    let mut kept = Vec::with_capacity(candidates.len());
    let mut deferred_author_soft_cap = Vec::new();
    let mut seen_related_ids = HashSet::new();
    let mut seen_conversations = HashSet::new();
    let mut author_counts = HashMap::new();
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
        );
        kept.push(candidate);
    }

    let mut reinserted_author_soft_cap = 0usize;
    if limit > 0 && kept.len() < limit {
        let needed = limit.saturating_sub(kept.len());
        for (candidate, related_ids) in deferred_author_soft_cap.iter().take(needed) {
            let author_entry = author_counts
                .entry(candidate.author_id.clone())
                .or_insert(0usize);
            *author_entry += 1;
            record_candidate_state(
                candidate,
                related_ids,
                &mut seen_related_ids,
                &mut seen_conversations,
            );
            kept.push(candidate.clone());
            reinserted_author_soft_cap = reinserted_author_soft_cap.saturating_add(1);
        }
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
) {
    for id in related_ids {
        seen_related_ids.insert(id.clone());
    }

    if let Some(conversation_id) = candidate.conversation_id.as_ref() {
        seen_conversations.insert(conversation_id.clone());
    }
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
}
