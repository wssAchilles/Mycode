use std::collections::{HashMap, HashSet, VecDeque};

use chrono::{Duration, Utc};

use crate::contracts::{
    RecentStoreSnapshot, RecommendationCandidatePayload, RecommendationQueryPayload,
};

#[derive(Debug)]
pub struct RecentHotStore {
    per_user_capacity: usize,
    global_capacity: usize,
    per_user: HashMap<String, VecDeque<RecommendationCandidatePayload>>,
    global: VecDeque<RecommendationCandidatePayload>,
}

impl RecentHotStore {
    pub fn new(per_user_capacity: usize, global_capacity: usize) -> Self {
        Self {
            per_user_capacity,
            global_capacity,
            per_user: HashMap::new(),
            global: VecDeque::new(),
        }
    }

    pub fn record(&mut self, user_id: &str, candidates: &[RecommendationCandidatePayload]) {
        let user_bucket = self.per_user.entry(user_id.to_string()).or_default();

        for candidate in candidates.iter().cloned() {
            push_dedup(user_bucket, candidate.clone(), self.per_user_capacity);
            push_dedup(&mut self.global, candidate, self.global_capacity);
        }
    }

    pub fn recent_hot_candidates(
        &self,
        query: &RecommendationQueryPayload,
        existing_ids: &HashSet<String>,
    ) -> Vec<RecommendationCandidatePayload> {
        let cutoff = Utc::now() - Duration::hours(12);
        self.global
            .iter()
            .filter(|candidate| candidate.created_at >= cutoff)
            .filter(|candidate| candidate.author_id != query.user_id)
            .filter(|candidate| !existing_ids.contains(&candidate.post_id))
            .take(query.limit.saturating_mul(2))
            .cloned()
            .collect()
    }

    pub fn snapshot(&self) -> RecentStoreSnapshot {
        RecentStoreSnapshot {
            global_size: self.global.len(),
            tracked_users: self.per_user.len(),
        }
    }
}

fn push_dedup(
    bucket: &mut VecDeque<RecommendationCandidatePayload>,
    candidate: RecommendationCandidatePayload,
    capacity: usize,
) {
    if let Some(position) = bucket
        .iter()
        .position(|existing| existing.post_id == candidate.post_id)
    {
        bucket.remove(position);
    }
    bucket.push_front(candidate);
    while bucket.len() > capacity {
        bucket.pop_back();
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::RecentHotStore;
    use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

    fn candidate(post_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: "hello".to_string(),
            created_at: Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("RecentHotStore".to_string()),
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
            pipeline_score: Some(1.0),
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    #[test]
    fn keeps_recent_entries_deduplicated() {
        let mut store = RecentHotStore::new(2, 3);
        store.record("u1", &[candidate("p1"), candidate("p2"), candidate("p1")]);
        let snapshot = store.snapshot();
        assert_eq!(snapshot.global_size, 2);
        assert_eq!(snapshot.tracked_users, 1);
    }

    #[test]
    fn excludes_existing_ids_from_recent_hot_results() {
        let mut store = RecentHotStore::new(4, 4);
        store.record("u1", &[candidate("p1"), candidate("p2")]);
        let query = RecommendationQueryPayload {
            request_id: "req-1".to_string(),
            user_id: "u2".to_string(),
            limit: 10,
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
        let results =
            store.recent_hot_candidates(&query, &std::iter::once("p1".to_string()).collect());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].post_id, "p2");
    }
}
