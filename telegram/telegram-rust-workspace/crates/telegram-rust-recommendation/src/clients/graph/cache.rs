use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::sync::RwLock;

use super::types::{CacheKey, CachedEntry, GraphQueryResult};

/// Thread-safe cache for graph queries with TTL-based expiration
pub struct GraphSignalCache<T: Clone + Send + Sync> {
    inner: Arc<RwLock<HashMap<CacheKey, CachedEntry<T>>>>,
    ttl: Duration,
}

impl<T: Clone + Send + Sync> GraphSignalCache<T> {
    /// Create a new cache with the given TTL
    pub fn new(ttl: Duration) -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            ttl,
        }
    }

    /// Get a cached entry if it exists and is not expired
    pub async fn get(&self, key: &CacheKey) -> Option<GraphQueryResult<T>> {
        let inner = self.inner.read().await;
        inner.get(key).and_then(|entry| {
            if entry.cached_at.elapsed() < self.ttl {
                Some(entry.data.clone())
            } else {
                None
            }
        })
    }

    /// Insert an entry into the cache
    pub async fn insert(&self, key: CacheKey, data: GraphQueryResult<T>) {
        let mut inner = self.inner.write().await;
        inner.insert(
            key,
            CachedEntry {
                data,
                cached_at: Instant::now(),
            },
        );
    }

    /// Get or fetch: return cached value if available, otherwise fetch and cache
    pub async fn get_or_fetch<F, Fut>(
        &self,
        key: CacheKey,
        fetcher: F,
    ) -> Result<GraphQueryResult<T>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<GraphQueryResult<T>>>,
    {
        // Try cache first
        if let Some(cached) = self.get(&key).await {
            return Ok(cached);
        }

        // Fetch and cache
        let data = fetcher().await?;
        self.insert(key, data.clone()).await;
        Ok(data)
    }

    /// Remove expired entries
    pub async fn cleanup(&self) {
        let mut inner = self.inner.write().await;
        inner.retain(|_, entry| entry.cached_at.elapsed() < self.ttl);
    }

    /// Get cache size
    pub async fn size(&self) -> usize {
        let inner = self.inner.read().await;
        inner.len()
    }
}
