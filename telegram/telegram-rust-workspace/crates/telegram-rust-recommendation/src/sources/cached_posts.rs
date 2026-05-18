use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use chrono::{Duration, Utc};
use redis::AsyncCommands;
use tokio::sync::Mutex;

use crate::contracts::RecommendationCandidatePayload;

/// Per-source cache for retrieval results.
///
/// Caches source candidates by `(source_name, user_id)` with configurable TTL.
/// Uses Redis as primary store with in-memory fallback, matching the ServeCache pattern.
#[derive(Debug, Clone)]
pub struct SourceCache {
    enabled: bool,
    ttl_secs: usize,
    prefix: String,
    redis_client: Option<redis::Client>,
    memory: Arc<Mutex<HashMap<String, SourceCacheEntry>>>,
}

#[derive(Debug, Clone)]
struct SourceCacheEntry {
    candidates: Vec<RecommendationCandidatePayload>,
    expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Default)]
pub struct SourceCacheHit {
    pub candidates: Option<Vec<RecommendationCandidatePayload>>,
}

impl SourceCache {
    pub fn new(redis_url: &str, enabled: bool, ttl_secs: usize, prefix: &str) -> Self {
        let redis_client = if enabled {
            redis::Client::open(redis_url.to_string()).ok()
        } else {
            None
        };

        Self {
            enabled,
            ttl_secs,
            prefix: prefix.to_string(),
            redis_client,
            memory: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub async fn get(&self, source_name: &str, user_id: &str) -> SourceCacheHit {
        if !self.enabled {
            return SourceCacheHit::default();
        }

        let key = self.cache_key(source_name, user_id);

        // Try Redis first.
        if let Some(client) = &self.redis_client
            && let Ok(mut connection) = client.get_multiplexed_async_connection().await
            && let Ok(value) = connection.get::<_, Option<String>>(&key).await
            && let Some(value) = value
            && let Ok(candidates) =
                serde_json::from_str::<Vec<RecommendationCandidatePayload>>(&value)
        {
            return SourceCacheHit {
                candidates: Some(candidates),
            };
        }

        // Fallback to in-memory cache.
        let memory = self.memory.lock().await;
        if let Some(entry) = memory.get(&key)
            && entry.expires_at > Utc::now()
        {
            return SourceCacheHit {
                candidates: Some(entry.candidates.clone()),
            };
        }

        SourceCacheHit::default()
    }

    pub async fn store(
        &self,
        source_name: &str,
        user_id: &str,
        candidates: &[RecommendationCandidatePayload],
    ) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }

        let key = self.cache_key(source_name, user_id);

        // Write to Redis.
        if let Some(client) = &self.redis_client
            && let Ok(mut connection) = client.get_multiplexed_async_connection().await
        {
            let serialized = serde_json::to_string(candidates)?;
            let _: () = connection
                .set_ex(&key, serialized, self.ttl_secs as u64)
                .await?;
        }

        // Write to in-memory cache.
        let mut memory = self.memory.lock().await;
        memory.insert(
            key,
            SourceCacheEntry {
                candidates: candidates.to_vec(),
                expires_at: Utc::now() + Duration::seconds(self.ttl_secs as i64),
            },
        );

        Ok(())
    }

    fn cache_key(&self, source_name: &str, user_id: &str) -> String {
        format!("{}:{source_name}:{user_id}", self.prefix)
    }
}

/// Wraps source retrieval with caching for cacheable sources.
///
/// For sources like `FollowingSource` that return relatively stable results,
/// this layer checks the cache before hitting the backend and stores results
/// after retrieval.
pub async fn retrieve_with_cache<F, Fut>(
    cache: &SourceCache,
    source_name: &str,
    user_id: &str,
    fetch: F,
) -> (Vec<RecommendationCandidatePayload>, bool)
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<Vec<RecommendationCandidatePayload>>>,
{
    // Check cache first.
    let hit = cache.get(source_name, user_id).await;
    if let Some(candidates) = hit.candidates {
        return (candidates, true);
    }

    // Cache miss — fetch from source.
    let started_at = Instant::now();
    let candidates = match fetch().await {
        Ok(candidates) => candidates,
        Err(_) => return (Vec::new(), false),
    };
    let _fetch_duration = started_at.elapsed();

    // Store in cache (fire-and-forget).
    let _ = cache.store(source_name, user_id, &candidates).await;

    (candidates, false)
}

/// Sources that benefit from caching (relatively stable between requests).
pub const CACHEABLE_SOURCES: &[&str] = &["FollowingSource", "PopularSource"];

const CACHED_POSTS_SOURCE_NAME: &str = "CachedPostsSource";
const CACHED_POSTS_TTL_SECS: usize = 300;
const CACHED_POSTS_REDIS_PREFIX: &str = "posts:following";

pub fn is_cacheable(source_name: &str) -> bool {
    CACHEABLE_SOURCES.contains(&source_name)
}

/// Redis-cached short-circuit wrapper around FollowingSource.
///
/// On cache hit, returns the cached candidate list directly.
/// On cache miss, delegates to the provided fetch function and stores
/// the result with a 5-minute TTL under `posts:following:{user_id}`.
pub struct CachedPostsSource {
    cache: SourceCache,
}

impl CachedPostsSource {
    pub fn new(redis_url: &str) -> Self {
        Self {
            cache: SourceCache::new(
                redis_url,
                true,
                CACHED_POSTS_TTL_SECS,
                CACHED_POSTS_REDIS_PREFIX,
            ),
        }
    }

    pub fn source_name(&self) -> &str {
        CACHED_POSTS_SOURCE_NAME
    }

    pub async fn retrieve<F, Fut>(
        &self,
        user_id: &str,
        fetch: F,
    ) -> (Vec<RecommendationCandidatePayload>, bool)
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = anyhow::Result<Vec<RecommendationCandidatePayload>>>,
    {
        retrieve_with_cache(&self.cache, "FollowingSource", user_id, fetch).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_format() {
        let cache = SourceCache::new("redis://localhost:6379", true, 300, "src:cache:v1");
        assert_eq!(
            cache.cache_key("FollowingSource", "user-42"),
            "src:cache:v1:FollowingSource:user-42"
        );
    }

    #[test]
    fn is_cacheable_identifies_stable_sources() {
        assert!(is_cacheable("FollowingSource"));
        assert!(is_cacheable("PopularSource"));
        assert!(!is_cacheable("TwoTowerSource"));
        assert!(!is_cacheable("GraphSource"));
    }

    #[tokio::test]
    async fn disabled_cache_returns_none() {
        let cache = SourceCache::new("redis://localhost:6379", false, 300, "test");
        let hit = cache.get("FollowingSource", "user-1").await;
        assert!(hit.candidates.is_none());
    }

    #[tokio::test]
    async fn memory_cache_roundtrip() {
        // Use an unreachable Redis URL so only the in-memory path is exercised.
        let cache = SourceCache::new("redis://127.0.0.1:1", true, 300, "test:roundtrip");

        let candidates = vec![make_candidate("p1"), make_candidate("p2")];
        cache
            .store("FollowingSource", "user-1", &candidates)
            .await
            .unwrap();

        let hit = cache.get("FollowingSource", "user-1").await;
        assert!(hit.candidates.is_some());
        let cached = hit.candidates.unwrap();
        assert_eq!(cached.len(), 2);
        assert_eq!(cached[0].post_id, "p1");
        assert_eq!(cached[1].post_id, "p2");
    }

    #[tokio::test]
    async fn cache_miss_on_different_user() {
        let cache = SourceCache::new("redis://127.0.0.1:1", true, 300, "test:miss_user");

        let candidates = vec![make_candidate("p1")];
        cache
            .store("FollowingSource", "user-1", &candidates)
            .await
            .unwrap();

        let hit = cache.get("FollowingSource", "user-2").await;
        assert!(hit.candidates.is_none());
    }

    #[tokio::test]
    async fn retrieve_with_cache_caches_result() {
        let cache = SourceCache::new("redis://127.0.0.1:1", true, 300, "test:retrieve");

        let (result, was_cached) =
            retrieve_with_cache(&cache, "FollowingSource", "user-1", || async {
                Ok(vec![make_candidate("p1")])
            })
            .await;

        assert!(!was_cached);
        assert_eq!(result.len(), 1);

        // Second call should hit cache.
        let (result, was_cached) =
            retrieve_with_cache(&cache, "FollowingSource", "user-1", || async {
                panic!("should not be called")
            })
            .await;

        assert!(was_cached);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].post_id, "p1");
    }

    #[tokio::test]
    async fn cached_posts_source_returns_cached_following_candidates() {
        let source = CachedPostsSource::new("redis://127.0.0.1:1");

        let (result, was_cached) = source
            .retrieve("user-42", || async {
                Ok(vec![make_candidate("post-a"), make_candidate("post-b")])
            })
            .await;

        assert!(!was_cached);
        assert_eq!(result.len(), 2);

        let (result, was_cached) = source
            .retrieve("user-42", || async {
                panic!("fetch should not be called on cache hit")
            })
            .await;

        assert!(was_cached);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].post_id, "post-a");
    }

    #[tokio::test]
    async fn cached_posts_source_miss_on_different_user() {
        let source = CachedPostsSource::new("redis://127.0.0.1:1");

        let _ = source
            .retrieve("user-1", || async { Ok(vec![make_candidate("p1")]) })
            .await;

        let (result, was_cached) = source
            .retrieve("user-2", || async { Ok(vec![make_candidate("p2")]) })
            .await;

        assert!(!was_cached);
        assert_eq!(result[0].post_id, "p2");
    }

    fn make_candidate(id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: id.to_string(),
            model_post_id: None,
            author_id: "author-1".to_string(),
            content: String::new(),
            created_at: chrono::Utc::now(),
            conversation_id: None,
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: None,
            recall_source: None,
            retrieval_lane: None,
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            has_media: false,
            media_type: crate::contracts::MediaType::None,
            video_duration_ms: None,
            media: None,
            topic_ids: Vec::new(),
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
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: None,
            news_metadata: None,
            is_pinned: None,
            is_subscription_only: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
            post_type: None,
            mutual_follow_jaccard: None,
            following_replied: None,
            pipeline_score: None,
            score_breakdown: None,
        }
    }
}
