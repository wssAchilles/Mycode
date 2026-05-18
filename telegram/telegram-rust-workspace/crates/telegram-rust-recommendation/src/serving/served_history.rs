use std::collections::HashSet;
use std::sync::Arc;

use anyhow::Result;
use redis::AsyncCommands;
use tokio::sync::Mutex;

/// Served History Store - 对标 X 的 ServedHistoryQueryHydrator
///
/// 从 Redis 加载用户最近推荐历史，避免重复推荐。
///
/// Redis key 格式: `served:history:{user_id}`
/// 数据结构: List of post_ids (LPUSH + LTRIM)
/// TTL: 30 天
pub struct ServedHistoryStore {
    redis_client: Option<redis::Client>,
    prefix: String,
    max_history: usize,
    ttl_secs: usize,
    /// 本地缓存（用于快速查询）
    local_cache: Arc<Mutex<LocalCache>>,
}

struct LocalCache {
    entries: std::collections::HashMap<String, CacheEntry>,
}

struct CacheEntry {
    post_ids: HashSet<String>,
    fetched_at: std::time::Instant,
}

const LOCAL_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

impl ServedHistoryStore {
    pub fn new(redis_url: &str, prefix: &str, max_history: usize, ttl_days: usize) -> Self {
        let redis_client = redis::Client::open(redis_url).ok();

        Self {
            redis_client,
            prefix: prefix.to_string(),
            max_history,
            ttl_secs: ttl_days * 86_400,
            local_cache: Arc::new(Mutex::new(LocalCache {
                entries: std::collections::HashMap::new(),
            })),
        }
    }

    fn redis_key(&self, user_id: &str) -> String {
        format!("{}:{}", self.prefix, user_id)
    }

    /// 获取用户的已推荐帖子 ID 集合
    pub async fn get_served_ids(&self, user_id: &str) -> HashSet<String> {
        // 1. 检查本地缓存
        {
            let cache = self.local_cache.lock().await;
            if let Some(entry) = cache.entries.get(user_id)
                && entry.fetched_at.elapsed() < LOCAL_CACHE_TTL
            {
                return entry.post_ids.clone();
            }
        }

        // 2. 从 Redis 获取
        let ids = self.fetch_from_redis(user_id).await.unwrap_or_default();

        // 3. 更新本地缓存
        {
            let mut cache = self.local_cache.lock().await;
            cache.entries.insert(
                user_id.to_string(),
                CacheEntry {
                    post_ids: ids.clone(),
                    fetched_at: std::time::Instant::now(),
                },
            );
        }

        ids
    }

    async fn fetch_from_redis(&self, user_id: &str) -> Result<HashSet<String>> {
        let client = match &self.redis_client {
            Some(client) => client,
            None => return Ok(HashSet::new()),
        };

        let mut conn = client.get_multiplexed_async_connection().await?;
        let key = self.redis_key(user_id);

        // LRANGE 获取最近的 post_ids
        let ids: Vec<String> = conn.lrange(&key, 0, self.max_history as isize - 1).await?;

        Ok(ids.into_iter().collect())
    }

    /// 记录已推荐的帖子 ID
    pub async fn record_served(&self, user_id: &str, post_ids: &[String]) {
        if post_ids.is_empty() {
            return;
        }

        // 1. 更新本地缓存
        {
            let mut cache = self.local_cache.lock().await;
            let entry = cache
                .entries
                .entry(user_id.to_string())
                .or_insert_with(|| CacheEntry {
                    post_ids: HashSet::new(),
                    fetched_at: std::time::Instant::now(),
                });
            for post_id in post_ids {
                entry.post_ids.insert(post_id.clone());
            }
        }

        // 2. 写入 Redis
        if let Err(e) = self.write_to_redis(user_id, post_ids).await {
            tracing::warn!("failed to write served history to redis: {}", e);
        }
    }

    async fn write_to_redis(&self, user_id: &str, post_ids: &[String]) -> Result<()> {
        let client = match &self.redis_client {
            Some(client) => client,
            None => return Ok(()),
        };

        let mut conn = client.get_multiplexed_async_connection().await?;
        let key = self.redis_key(user_id);

        // LPUSH 新的 post_ids
        let mut pipe = redis::pipe();
        for post_id in post_ids {
            pipe.lpush(&key, post_id);
        }
        // LTRIM 保留最近的 N 条
        pipe.ltrim(&key, 0, self.max_history as isize - 1);
        // EXPIRE 设置 TTL
        pipe.expire(&key, self.ttl_secs as i64);

        let _: () = pipe.query_async(&mut conn).await?;

        Ok(())
    }

    /// 清理过期的本地缓存
    pub async fn cleanup_local_cache(&self) {
        let mut cache = self.local_cache.lock().await;
        cache
            .entries
            .retain(|_, entry| entry.fetched_at.elapsed() < LOCAL_CACHE_TTL * 10);
    }
}

impl Default for ServedHistoryStore {
    fn default() -> Self {
        Self::new("redis://redis:6379", "served:history", 500, 30)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redis_key_format() {
        let store = ServedHistoryStore::new("redis://localhost", "served:history", 100, 30);
        assert_eq!(store.redis_key("user123"), "served:history:user123");
    }

    #[test]
    fn default_store_creation() {
        let store = ServedHistoryStore::default();
        assert_eq!(store.prefix, "served:history");
        assert_eq!(store.max_history, 500);
        assert_eq!(store.ttl_secs, 30 * 86_400);
    }
}
