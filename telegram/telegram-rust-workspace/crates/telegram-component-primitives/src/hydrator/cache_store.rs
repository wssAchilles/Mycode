//! 缓存存储后端抽象与基于 Moka 的内存实现。

use std::hash::Hash;
use std::sync::Arc;
use std::time::Duration;

/// 缓存后端抽象，允许替换实现（moka、Redis、内存 HashMap）。
#[async_trait::async_trait]
pub trait CacheStore<K, V>: Send + Sync
where
    K: Eq + Hash + Send + Sync,
    V: Clone + Send + Sync,
{
    /// 按键查询缓存。
    async fn get(&self, key: &K) -> Option<V>;

    /// 写入缓存条目。
    async fn insert(&self, key: K, value: V);

    /// 使指定缓存键失效。
    async fn invalidate(&self, key: &K);

    /// 清空当前缓存实例。
    async fn invalidate_all(&self);
}

/// 基于 moka 的同步内存缓存后端实现。
pub struct MokaCacheStore<V> {
    cache: Arc<moka::sync::Cache<String, V>>,
}

impl<V> MokaCacheStore<V>
where
    V: Clone + Send + Sync + 'static,
{
    /// 构造带容量与过期策略的 Moka 缓存实例。
    pub fn new(max_capacity: u64, ttl: Duration) -> Self {
        let cache = moka::sync::Cache::builder()
            .max_capacity(max_capacity)
            .time_to_live(ttl)
            .weigher(|_key: &String, value: &V| -> u32 {
                // 按值的内存大小估算权重，防止大条目驱逐大量小条目
                let est = std::mem::size_of_val(value) as u32;
                est.max(1)
            })
            .build();
        Self {
            cache: Arc::new(cache),
        }
    }

    /// 返回当前已追踪的缓存条目估算数量。
    pub fn entry_count(&self) -> u64 {
        self.cache.entry_count()
    }
}

impl<V> Default for MokaCacheStore<V>
where
    V: Clone + Send + Sync + 'static,
{
    fn default() -> Self {
        Self::new(4096, Duration::from_secs(300))
    }
}

#[async_trait::async_trait]
impl<V> CacheStore<String, V> for MokaCacheStore<V>
where
    V: Clone + Send + Sync + 'static,
{
    async fn get(&self, key: &String) -> Option<V> {
        self.cache.get(key)
    }

    async fn insert(&self, key: String, value: V) {
        self.cache.insert(key, value);
    }

    async fn invalidate(&self, key: &String) {
        self.cache.invalidate(key);
    }

    async fn invalidate_all(&self) {
        self.cache.invalidate_all();
    }
}
