use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use tokio::sync::Mutex;

use crate::contracts::RecommendationCandidatePayload;

use super::detail::build_materializer_telemetry;
use super::{
    GraphSourceRuntime, MATERIALIZER_RETRY_MAX_LIMIT_PER_AUTHOR,
    MATERIALIZER_RETRY_MAX_LOOKBACK_DAYS,
};

const MATERIALIZER_CACHE_KEY_MODE: &str = "rust_author_ids_limit_lookback_v1";
const MATERIALIZER_CACHE_TTL_MS: i64 = 15_000;
const MATERIALIZER_CACHE_MAX_ENTRIES: usize = 64;

#[derive(Debug, Clone)]
struct MaterializerCacheEntry {
    candidates: Vec<RecommendationCandidatePayload>,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub(super) struct GraphMaterializerCache {
    entries: Arc<Mutex<HashMap<String, MaterializerCacheEntry>>>,
}

#[derive(Debug, Clone)]
struct MaterializerCacheLookup {
    candidates: Vec<RecommendationCandidatePayload>,
    entry_count: usize,
    eviction_count: u64,
}

impl GraphMaterializerCache {
    pub(super) fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn get(&self, key: &str, now: DateTime<Utc>) -> Option<MaterializerCacheLookup> {
        let mut entries = self.entries.lock().await;
        let eviction_count = evict_expired_entries(&mut entries, now);
        let candidates = entries
            .get(key)
            .filter(|entry| entry.expires_at > now)
            .map(|entry| entry.candidates.clone())?;

        Some(MaterializerCacheLookup {
            candidates,
            entry_count: entries.len(),
            eviction_count,
        })
    }

    async fn store(
        &self,
        key: String,
        candidates: &[RecommendationCandidatePayload],
        now: DateTime<Utc>,
    ) -> (usize, u64) {
        let mut entries = self.entries.lock().await;
        let mut eviction_count = evict_expired_entries(&mut entries, now);
        if entries.len() >= MATERIALIZER_CACHE_MAX_ENTRIES && !entries.contains_key(&key) {
            if let Some(oldest_key) = oldest_cache_key(&entries) {
                entries.remove(&oldest_key);
                eviction_count += 1;
            }
        }

        entries.insert(
            key,
            MaterializerCacheEntry {
                candidates: candidates.to_vec(),
                expires_at: now + Duration::milliseconds(MATERIALIZER_CACHE_TTL_MS),
            },
        );
        (entries.len(), eviction_count)
    }
}

impl Default for GraphMaterializerCache {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct MaterializerRetryDetail {
    pub(super) applied: bool,
    pub(super) recovered: bool,
    pub(super) lookback_days: Option<usize>,
    pub(super) limit_per_author: Option<usize>,
}

#[derive(Debug, Clone, Default)]
pub(super) struct MaterializerTelemetry {
    pub(super) query_duration_ms: Option<u64>,
    pub(super) provider_latency_ms: Option<u64>,
    pub(super) cache_hit: Option<bool>,
    pub(super) requested_author_count: Option<usize>,
    pub(super) unique_author_count: Option<usize>,
    pub(super) returned_post_count: Option<usize>,
    pub(super) cache_key_mode: Option<String>,
    pub(super) cache_ttl_ms: Option<u64>,
    pub(super) cache_entry_count: Option<usize>,
    pub(super) cache_eviction_count: Option<u64>,
}

pub(super) struct GraphMaterializationResult {
    pub(super) candidates: Vec<RecommendationCandidatePayload>,
    pub(super) provider_calls: HashMap<String, usize>,
    pub(super) provider_latency_ms: HashMap<String, u64>,
    pub(super) retry: MaterializerRetryDetail,
    pub(super) telemetry: MaterializerTelemetry,
    pub(super) fallback_reason: Option<String>,
}

impl GraphSourceRuntime {
    pub(super) async fn materialize_graph_author_candidates(
        &self,
        author_ids: &[String],
    ) -> GraphMaterializationResult {
        let mut provider_calls = HashMap::new();
        let mut provider_latency_ms = HashMap::new();
        let mut retry = MaterializerRetryDetail::default();
        let mut telemetry = MaterializerTelemetry::default();
        let mut cache_key = materializer_cache_key(
            author_ids,
            self.materializer_limit_per_author,
            self.materializer_lookback_days,
        );

        if let Some(cache_hit) = self.materializer_cache.get(&cache_key, Utc::now()).await {
            annotate_materializer_cache_hit(&mut telemetry, author_ids, &cache_hit);
            return GraphMaterializationResult {
                telemetry,
                candidates: cache_hit.candidates,
                provider_calls,
                provider_latency_ms,
                retry,
                fallback_reason: None,
            };
        }

        let mut candidates = match self
            .backend_client
            .graph_author_candidates(
                author_ids,
                self.materializer_limit_per_author,
                self.materializer_lookback_days,
            )
            .await
        {
            Ok(response) => {
                *provider_calls
                    .entry("providers/graph/authors".to_string())
                    .or_insert(0) += 1;
                *provider_latency_ms
                    .entry("providers/graph/authors".to_string())
                    .or_insert(0) += response.latency_ms;
                telemetry = build_materializer_telemetry(
                    response.payload.diagnostics.as_ref(),
                    response.latency_ms,
                );
                response.payload.candidates
            }
            Err(_error) => {
                return GraphMaterializationResult {
                    candidates: Vec::new(),
                    provider_calls,
                    provider_latency_ms,
                    retry,
                    telemetry,
                    fallback_reason: Some("graph_author_materializer_failed".to_string()),
                };
            }
        };

        if candidates.is_empty() {
            retry.applied = true;
            retry.lookback_days = Some(materializer_retry_lookback_days(
                self.materializer_lookback_days,
            ));
            retry.limit_per_author = Some(materializer_retry_limit_per_author(
                self.materializer_limit_per_author,
            ));
            let retry_limit = retry
                .limit_per_author
                .unwrap_or(self.materializer_limit_per_author);
            let retry_lookback = retry
                .lookback_days
                .unwrap_or(self.materializer_lookback_days);
            cache_key = materializer_cache_key(author_ids, retry_limit, retry_lookback);

            if let Some(cache_hit) = self.materializer_cache.get(&cache_key, Utc::now()).await {
                retry.recovered = !cache_hit.candidates.is_empty();
                annotate_materializer_cache_hit(&mut telemetry, author_ids, &cache_hit);
                return GraphMaterializationResult {
                    telemetry,
                    candidates: cache_hit.candidates,
                    provider_calls,
                    provider_latency_ms,
                    retry,
                    fallback_reason: None,
                };
            }

            match self
                .backend_client
                .graph_author_candidates(author_ids, retry_limit, retry_lookback)
                .await
            {
                Ok(response) => {
                    *provider_calls
                        .entry("providers/graph/authors_retry".to_string())
                        .or_insert(0) += 1;
                    *provider_latency_ms
                        .entry("providers/graph/authors_retry".to_string())
                        .or_insert(0) += response.latency_ms;
                    telemetry = build_materializer_telemetry(
                        response.payload.diagnostics.as_ref(),
                        response.latency_ms,
                    );
                    retry.recovered = !response.payload.candidates.is_empty();
                    candidates = response.payload.candidates;
                }
                Err(_error) => {
                    return GraphMaterializationResult {
                        candidates: Vec::new(),
                        provider_calls,
                        provider_latency_ms,
                        retry,
                        telemetry,
                        fallback_reason: Some("graph_author_materializer_retry_failed".to_string()),
                    };
                }
            }
        }

        if !candidates.is_empty() {
            let (entry_count, eviction_count) = self
                .materializer_cache
                .store(cache_key, &candidates, Utc::now())
                .await;
            annotate_materializer_cache_store(
                &mut telemetry,
                author_ids,
                candidates.len(),
                entry_count,
                eviction_count,
            );
        }

        GraphMaterializationResult {
            candidates,
            provider_calls,
            provider_latency_ms,
            retry,
            telemetry,
            fallback_reason: None,
        }
    }
}

pub(super) fn materializer_retry_limit_per_author(current_limit: usize) -> usize {
    (current_limit.max(2) * 2).min(MATERIALIZER_RETRY_MAX_LIMIT_PER_AUTHOR)
}

pub(super) fn materializer_retry_lookback_days(_current_lookback_days: usize) -> usize {
    MATERIALIZER_RETRY_MAX_LOOKBACK_DAYS
}

fn annotate_materializer_cache_hit(
    telemetry: &mut MaterializerTelemetry,
    author_ids: &[String],
    cache_hit: &MaterializerCacheLookup,
) {
    telemetry.query_duration_ms.get_or_insert(0);
    telemetry.provider_latency_ms.get_or_insert(0);
    telemetry.cache_hit = Some(true);
    telemetry.requested_author_count = Some(author_ids.len());
    telemetry.unique_author_count = Some(normalized_author_ids(author_ids).len());
    telemetry.returned_post_count = Some(cache_hit.candidates.len());
    telemetry.cache_key_mode = Some(MATERIALIZER_CACHE_KEY_MODE.to_string());
    telemetry.cache_ttl_ms = Some(MATERIALIZER_CACHE_TTL_MS as u64);
    telemetry.cache_entry_count = Some(cache_hit.entry_count);
    telemetry.cache_eviction_count = Some(cache_hit.eviction_count);
}

fn annotate_materializer_cache_store(
    telemetry: &mut MaterializerTelemetry,
    author_ids: &[String],
    returned_post_count: usize,
    entry_count: usize,
    eviction_count: u64,
) {
    telemetry.cache_hit.get_or_insert(false);
    telemetry
        .requested_author_count
        .get_or_insert(author_ids.len());
    telemetry
        .unique_author_count
        .get_or_insert(normalized_author_ids(author_ids).len());
    telemetry
        .returned_post_count
        .get_or_insert(returned_post_count);
    telemetry
        .cache_key_mode
        .get_or_insert_with(|| MATERIALIZER_CACHE_KEY_MODE.to_string());
    telemetry
        .cache_ttl_ms
        .get_or_insert(MATERIALIZER_CACHE_TTL_MS as u64);
    telemetry.cache_entry_count.get_or_insert(entry_count);
    telemetry.cache_eviction_count.get_or_insert(eviction_count);
}

fn materializer_cache_key(
    author_ids: &[String],
    limit_per_author: usize,
    lookback_days: usize,
) -> String {
    format!(
        "{}|limit={}|lookback={}|authors={}",
        MATERIALIZER_CACHE_KEY_MODE,
        limit_per_author,
        lookback_days,
        normalized_author_ids(author_ids).join(","),
    )
}

fn normalized_author_ids(author_ids: &[String]) -> Vec<String> {
    let mut normalized = author_ids
        .iter()
        .map(|author_id| author_id.trim())
        .filter(|author_id| !author_id.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    normalized.sort_unstable();
    normalized.dedup();
    normalized
}

fn evict_expired_entries(
    entries: &mut HashMap<String, MaterializerCacheEntry>,
    now: DateTime<Utc>,
) -> u64 {
    let expired_keys = entries
        .iter()
        .filter_map(|(key, entry)| (entry.expires_at <= now).then(|| key.clone()))
        .collect::<Vec<_>>();
    let eviction_count = expired_keys.len() as u64;
    for key in expired_keys {
        entries.remove(&key);
    }
    eviction_count
}

fn oldest_cache_key(entries: &HashMap<String, MaterializerCacheEntry>) -> Option<String> {
    entries
        .iter()
        .min_by_key(|(key, entry)| (entry.expires_at, key.as_str()))
        .map(|(key, _entry)| key.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materializer_cache_key_normalizes_author_order_and_duplicates() {
        let left = materializer_cache_key(
            &[
                "author-b".to_string(),
                " author-a ".to_string(),
                "author-a".to_string(),
            ],
            3,
            30,
        );
        let right =
            materializer_cache_key(&["author-a".to_string(), "author-b".to_string()], 3, 30);

        assert_eq!(left, right);
        assert!(left.contains("authors=author-a,author-b"));
    }

    #[tokio::test]
    async fn materializer_cache_evicts_expired_entries_before_lookup() {
        let cache = GraphMaterializerCache::new();
        let now = Utc::now();
        {
            let mut entries = cache.entries.lock().await;
            entries.insert(
                "expired".to_string(),
                MaterializerCacheEntry {
                    candidates: Vec::new(),
                    expires_at: now - Duration::milliseconds(1),
                },
            );
        }

        let lookup = cache.get("expired", now).await;

        assert!(lookup.is_none());
        assert!(cache.entries.lock().await.is_empty());
    }
}
