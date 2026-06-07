use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

use chrono::{Duration, Utc};

use crate::contracts::{
    RecentStoreSnapshot, RecommendationCandidatePayload, RecommendationQueryPayload,
};

#[derive(Debug)]
pub struct RecentHotStore {
    per_user_capacity: usize,
    global_capacity: usize,
    shards: Vec<RecentHotShard>,
}

#[derive(Debug)]
struct RecentHotShard {
    inner: Mutex<RecentHotShardState>,
}

#[derive(Debug, Default)]
struct RecentHotShardState {
    per_user: HashMap<String, RecentBucket>,
    global: RecentBucket,
}

#[derive(Debug, Default)]
struct RecentBucket {
    entries: VecDeque<RecommendationCandidatePayload>,
    post_ids: HashSet<String>,
}

impl RecentHotStore {
    pub fn new(per_user_capacity: usize, global_capacity: usize) -> Self {
        Self::new_sharded(per_user_capacity, global_capacity, 1)
    }

    pub fn new_sharded(
        per_user_capacity: usize,
        global_capacity: usize,
        shard_count: usize,
    ) -> Self {
        let shard_count = shard_count.max(1);
        Self {
            per_user_capacity,
            global_capacity,
            shards: (0..shard_count)
                .map(|_| RecentHotShard {
                    inner: Mutex::new(RecentHotShardState::default()),
                })
                .collect(),
        }
    }

    pub fn record(&self, user_id: &str, candidates: &[RecommendationCandidatePayload]) {
        self.record_candidates(user_id, candidates);
    }

    fn record_candidates(&self, user_id: &str, candidates: &[RecommendationCandidatePayload]) {
        let shard = self.shard_for(user_id);
        let mut state = shard.inner.lock().expect("recent hot shard mutex poisoned");
        for candidate in candidates.iter().cloned() {
            {
                let user_bucket = state.per_user.entry(user_id.to_string()).or_default();
                user_bucket.push_dedup(candidate.clone(), self.per_user_capacity);
            }
            state.global.push_dedup(candidate, self.global_capacity);
        }
    }

    pub fn recent_hot_candidates(
        &self,
        query: &RecommendationQueryPayload,
        existing_ids: &HashSet<String>,
    ) -> Vec<RecommendationCandidatePayload> {
        let cutoff = Utc::now() - Duration::hours(12);
        let mut candidates = self
            .shards
            .iter()
            .flat_map(|shard| {
                let state = shard.inner.lock().expect("recent hot shard mutex poisoned");
                state
                    .global
                    .entries
                    .iter()
                    .filter(|candidate| candidate.created_at >= cutoff)
                    .filter(|candidate| candidate.author_id != query.user_id)
                    .filter(|candidate| !existing_ids.contains(&candidate.post_id))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        candidates.truncate(query.limit.saturating_mul(2));
        candidates
    }

    pub fn snapshot(&self) -> RecentStoreSnapshot {
        let (global_size, tracked_users) =
            self.shards
                .iter()
                .fold((0usize, 0usize), |(global_size, tracked_users), shard| {
                    let state = shard.inner.lock().expect("recent hot shard mutex poisoned");
                    (
                        global_size + state.global.len(),
                        tracked_users + state.per_user.len(),
                    )
                });
        RecentStoreSnapshot {
            global_size,
            tracked_users,
        }
    }

    pub fn control_plane_snapshot(&self) -> RecentHotControlPlaneSnapshot {
        RecentHotControlPlaneSnapshot {
            shard_count: self.shards.len(),
            per_user_capacity: self.per_user_capacity,
            global_capacity: self.global_capacity,
            total_global_capacity: self.global_capacity.saturating_mul(self.shards.len()),
        }
    }

    fn shard_for(&self, user_id: &str) -> &RecentHotShard {
        let mut hasher = DefaultHasher::new();
        user_id.hash(&mut hasher);
        let index = hasher.finish() as usize % self.shards.len();
        &self.shards[index]
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentHotControlPlaneSnapshot {
    pub shard_count: usize,
    pub per_user_capacity: usize,
    pub global_capacity: usize,
    pub total_global_capacity: usize,
}

impl RecentBucket {
    fn len(&self) -> usize {
        self.entries.len()
    }

    fn push_dedup(&mut self, candidate: RecommendationCandidatePayload, capacity: usize) {
        if self.post_ids.contains(&candidate.post_id)
            && let Some(position) = self
                .entries
                .iter()
                .position(|existing| existing.post_id == candidate.post_id)
        {
            self.entries.remove(position);
        }

        self.post_ids.insert(candidate.post_id.clone());
        self.entries.push_front(candidate);

        while self.entries.len() > capacity {
            if let Some(removed) = self.entries.pop_back() {
                self.post_ids.remove(&removed.post_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;
    use std::thread;

    use chrono::{Duration, Utc};
    use telegram_source_primitives::RECENT_HOT_STORE_SOURCE;

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
            recall_source: Some(RECENT_HOT_STORE_SOURCE.to_string()),
            retrieval_lane: None,
            interest_pool_kind: None,
            topic_ids: Vec::new(),
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: crate::contracts::MediaType::None,
            video_duration_ms: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            author_blocks_viewer: None,
            language_code: None,
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
            is_subscription_only: None,
            score_breakdown: None,
            pipeline_score: Some(1.0),
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
        }
    }

    fn old_candidate(post_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            created_at: Utc::now() - Duration::hours(24),
            ..candidate(post_id)
        }
    }

    #[test]
    fn keeps_recent_entries_deduplicated() {
        let store = RecentHotStore::new(2, 3);
        store.record("u1", &[candidate("p1"), candidate("p2"), candidate("p1")]);
        let snapshot = store.snapshot();
        assert_eq!(snapshot.global_size, 2);
        assert_eq!(snapshot.tracked_users, 1);
    }

    #[test]
    fn sharded_store_reports_capacity_and_shard_count() {
        let store = RecentHotStore::new_sharded(2, 3, 4);
        let snapshot = store.control_plane_snapshot();
        assert_eq!(snapshot.shard_count, 4);
        assert_eq!(snapshot.per_user_capacity, 2);
        assert_eq!(snapshot.global_capacity, 3);
        assert_eq!(snapshot.total_global_capacity, 12);
    }

    #[test]
    fn sharded_store_records_concurrently_without_cross_shard_corruption() {
        let store = Arc::new(RecentHotStore::new_sharded(8, 8, 8));
        let handles = (0..8)
            .map(|index| {
                let store = Arc::clone(&store);
                thread::spawn(move || {
                    store.record_candidates(
                        &format!("u{index}"),
                        &[candidate(&format!("p{index}"))],
                    );
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().expect("thread should finish");
        }

        let snapshot = store.snapshot();
        assert_eq!(snapshot.tracked_users, 8);
        assert_eq!(snapshot.global_size, 8);
    }

    #[test]
    fn excludes_existing_ids_from_recent_hot_results() {
        let store = RecentHotStore::new(4, 4);
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
            ranking_policy: None,
            user_signal_features: None,
            interested_topics: None,
            mutual_follow_ids: None,
            demographics: None,
            feature_switches: HashMap::new(),
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
        };
        let results =
            store.recent_hot_candidates(&query, &std::iter::once("p1".to_string()).collect());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].post_id, "p2");
    }

    #[test]
    fn recent_hot_prunes_old_and_over_capacity_candidates() {
        let store = RecentHotStore::new_sharded(2, 2, 1);
        store.record("u2", &[old_candidate("old")]);
        store.record("u1", &[candidate("p1"), candidate("p2"), candidate("p3")]);
        let query = RecommendationQueryPayload {
            request_id: "req-1".to_string(),
            user_id: "u9".to_string(),
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
            ranking_policy: None,
            user_signal_features: None,
            interested_topics: None,
            mutual_follow_ids: None,
            demographics: None,
            feature_switches: HashMap::new(),
            past_request_timestamps: Vec::new(),
            impressed_post_ids: Vec::new(),
            subscribed_user_ids: Vec::new(),
        };

        let results = store.recent_hot_candidates(&query, &HashSet::new());
        assert_eq!(
            results
                .iter()
                .map(|candidate| candidate.post_id.as_str())
                .collect::<Vec<_>>(),
            vec!["p3", "p2"]
        );
    }
}
