use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

// ---------------------------------------------------------------------------
// CacheStore — abstract cache backend (对标 X 的 CacheStore<K, V>)
// ---------------------------------------------------------------------------

/// 缓存后端抽象，允许替换实现（moka、Redis、内存 HashMap）。
#[async_trait::async_trait]
pub trait CacheStore<K, V>: Send + Sync
where
    K: Eq + Hash + Send + Sync,
    V: Clone + Send + Sync,
{
    async fn get(&self, key: &K) -> Option<V>;
    async fn insert(&self, key: K, value: V);
    async fn invalidate(&self, key: &K);
    async fn invalidate_all(&self);
}

/// 基于 moka 的同步缓存后端实现
pub struct MokaCacheStore<V> {
    cache: Arc<moka::sync::Cache<String, V>>,
}

impl<V> MokaCacheStore<V>
where
    V: Clone + Send + Sync + 'static,
{
    pub fn new(max_capacity: u64, ttl: Duration) -> Self {
        let cache = moka::sync::Cache::builder()
            .max_capacity(max_capacity)
            .time_to_live(ttl)
            .build();
        Self {
            cache: Arc::new(cache),
        }
    }

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

// ---------------------------------------------------------------------------
// Hydrator — base trait (对标 X 的 Hydrator<Q, C>)
// ---------------------------------------------------------------------------

/// 基础 Hydrator trait，所有 hydrator 的根 trait。
///
/// 对标 X 的 `Hydrator<Q, C>`：接受查询和候选批次，返回 hydrated 候选。
pub trait Hydrator<Q, C>: Send + Sync
where
    Q: Send + Sync,
    C: Clone + Send + Sync,
{
    /// Hydrator 名称（用于遥测和 stage 记录）
    fn name(&self) -> &str;

    /// 是否启用（默认 true）
    fn enable(&self, _query: &Q) -> bool {
        true
    }

    /// 主执行逻辑：批量 hydrate 候选
    fn hydrate(
        &self,
        query: &Q,
        candidates: &[C],
    ) -> impl std::future::Future<Output = Vec<Result<C, String>>> + Send;

    /// 将 hydrated 候选的字段合并回原始候选（默认替换）
    fn update(&self, candidate: &mut C, hydrated: C) {
        *candidate = hydrated;
    }

    /// 批量 update：默认逐个调用 update
    fn update_all(&self, candidates: &mut [C], hydrated: Vec<Result<C, String>>) {
        for (candidate, result) in candidates.iter_mut().zip(hydrated) {
            if let Ok(h) = result {
                self.update(candidate, h);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// CachedHydrator — per-candidate caching (对标 X 的 CachedHydrator<Q, C>)
// ---------------------------------------------------------------------------

/// 带缓存的 Hydrator trait — 对标 X 的 `CachedHydrator<Q, C>` 模式
///
/// 核心设计：**per-candidate 缓存**，不是 per-query 缓存。
///
/// 例如 AuthorInfoHydrator 缓存 author 数据按 `author_id`，
/// 如果同一作者出现在 5 个候选中，只需 1 次 API 调用。
///
/// 提供 blanket impl of `Hydrator<Q, C>` for any `CachedHydrator<Q, C>`，
/// 自动处理 cache-or-fetch 逻辑。
pub trait CachedHydrator<Q, C>: Send + Sync
where
    Q: Send + Sync,
    C: Clone + Send + Sync,
{
    /// 缓存键类型（如 `String` author_id, `i64` post_id）
    type CacheKey: Eq + Hash + Clone + Send + Sync + 'static;

    /// 缓存值类型（如 AuthorInfo, VideoMetadata）
    type CacheValue: Clone + Send + Sync + 'static;

    /// Hydrator 名称
    fn name(&self) -> &str;

    /// 是否启用
    fn enable(&self, _query: &Q) -> bool {
        true
    }

    /// 获取缓存后端引用
    fn cache_store(&self) -> &dyn CacheStore<Self::CacheKey, Self::CacheValue>;

    /// 从候选生成缓存键（如 candidate.author_id）
    fn cache_key(&self, candidate: &C) -> Self::CacheKey;

    /// 从 hydrated 候选提取缓存值（如 author info 数据）
    fn cache_value(&self, hydrated: &C) -> Self::CacheValue;

    /// 从缓存值重建 hydrated 候选
    fn hydrate_from_cache(&self, value: Self::CacheValue) -> C;

    /// 实际 API 调用（仅对缓存未命中的候选批次调用）
    fn hydrate_from_client(
        &self,
        query: &Q,
        candidates: &[C],
    ) -> impl std::future::Future<Output = Vec<Result<C, String>>> + Send;

    /// 将 hydrated 字段合并回原始候选（默认替换）
    fn update(&self, candidate: &mut C, hydrated: C) {
        *candidate = hydrated;
    }

    /// 缓存统计钩子（用于遥测）
    fn stat_cache(&self, _cache_hits: usize, _cache_misses: usize) {}
}

/// Blanket impl: 任何 CachedHydrator 自动满足 Hydrator trait
///
/// 这是 X 的核心设计：CachedHydrator 透明地处理 cache-or-fetch 逻辑，
/// 调用方只需使用 Hydrator trait 接口。
impl<Q, C, H> Hydrator<Q, C> for H
where
    Q: Send + Sync,
    C: Clone + Send + Sync,
    H: CachedHydrator<Q, C>,
{
    fn name(&self) -> &str {
        CachedHydrator::name(self)
    }

    fn enable(&self, query: &Q) -> bool {
        CachedHydrator::enable(self, query)
    }

    async fn hydrate(&self, query: &Q, candidates: &[C]) -> Vec<Result<C, String>> {
        let store = self.cache_store();

        // 1. 按缓存键分组候选
        let mut cache_keys = Vec::with_capacity(candidates.len());
        let mut cache_hits: Vec<Option<<Self as CachedHydrator<Q, C>>::CacheValue>> =
            Vec::with_capacity(candidates.len());

        for candidate in candidates {
            let key = self.cache_key(candidate);
            let cached = store.get(&key).await;
            cache_hits.push(cached);
            cache_keys.push(key);
        }

        // 2. 收集缓存未命中的候选索引
        let miss_indices: Vec<usize> = cache_hits
            .iter()
            .enumerate()
            .filter(|(_, cached): &(_, &Option<<Self as CachedHydrator<Q, C>>::CacheValue>)| {
                cached.is_none()
            })
            .map(|(i, _)| i)
            .collect();

        // 3. 对未命中的候选批量调用 hydrate_from_client
        let miss_candidates: Vec<C> =
            miss_indices.iter().map(|&i| candidates[i].clone()).collect();
        let hydrated_results = if miss_candidates.is_empty() {
            Vec::new()
        } else {
            self.hydrate_from_client(query, &miss_candidates).await
        };

        // 4. 将新 hydrated 结果插入缓存
        for (idx, result) in miss_indices.iter().zip(hydrated_results.iter()) {
            if let Ok(hydrated) = result {
                let value = self.cache_value(hydrated);
                store.insert(cache_keys[*idx].clone(), value).await;
            }
        }

        // 5. 组装最终结果：缓存命中 + 新 hydrated
        let mut results = Vec::with_capacity(candidates.len());
        let mut miss_iter = hydrated_results.into_iter();
        let mut miss_idx_iter = miss_indices.iter();

        for (_i, cached) in cache_hits.into_iter().enumerate() {
            if let Some(value) = cached {
                results.push(Ok(self.hydrate_from_cache(value)));
            } else {
                // 这是未命中的候选，从 hydrate_from_client 结果取
                let result = miss_iter.next().unwrap_or_else(|| {
                    Err("hydrate_from_client returned fewer results than misses".to_string())
                });
                results.push(result);
                let _ = miss_idx_iter.next();
            }
        }

        let hit_count = results.iter().filter(|r| r.is_ok()).count() - miss_indices.len();
        self.stat_cache(hit_count, miss_indices.len());

        results
    }

    fn update(&self, candidate: &mut C, hydrated: C) {
        CachedHydrator::update(self, candidate, hydrated);
    }
}

// ---------------------------------------------------------------------------
// CachedHydratorExecutor — 便捷执行器（包装 trait 使用）
// ---------------------------------------------------------------------------

/// 便捷执行器，包装 Hydrator trait 的调用。
///
/// 用于 pipeline 中直接调用，自动处理 enable 检查和 update_all。
pub struct CachedHydratorExecutor;

impl CachedHydratorExecutor {
    /// 执行 hydrator：检查 enable，调用 hydrate，update_all 到候选
    pub async fn execute<Q, C, H>(hydrator: &H, query: &Q, candidates: &mut [C])
    where
        Q: Send + Sync,
        C: Clone + Send + Sync,
        H: Hydrator<Q, C>,
    {
        if !hydrator.enable(query) {
            return;
        }
        let results = hydrator.hydrate(query, candidates).await;
        hydrator.update_all(candidates, results);
    }
}

// ---------------------------------------------------------------------------
// 缓存键辅助函数
// ---------------------------------------------------------------------------

/// Query Hydrator 缓存键辅助函数
pub fn query_hydrator_cache_key(hydrator_name: &str, user_id: &str, request_id: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(request_id, &mut hasher);
    let hash = hasher.finish();
    format!("{}:{}:{:016x}", hydrator_name, user_id, hash)
}

/// Candidate Hydrator 缓存键辅助函数
pub fn candidate_hydrator_cache_key(hydrator_name: &str, post_id: &str) -> String {
    format!("{}:{}", hydrator_name, post_id)
}

/// Stage detail 缓存元数据
pub fn cache_stage_detail(hit: bool, key: &str, entry_count: u64) -> HashMap<String, Value> {
    let mut detail = HashMap::new();
    detail.insert("cacheHit".to_string(), Value::Bool(hit));
    detail.insert("cacheKey".to_string(), Value::String(key.to_string()));
    detail.insert("cacheEntryCount".to_string(), Value::from(entry_count));
    detail
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_cache_key_format() {
        let key = query_hydrator_cache_key("UserFeaturesQueryHydrator", "user-1", "req-123");
        assert!(key.starts_with("UserFeaturesQueryHydrator:user-1:"));
    }

    #[test]
    fn candidate_cache_key_format() {
        let key = candidate_hydrator_cache_key("AuthorInfoHydrator", "post-42");
        assert_eq!(key, "AuthorInfoHydrator:post-42");
    }

    #[test]
    fn cache_stage_detail_records_hit() {
        let detail = cache_stage_detail(true, "test-key", 42);
        assert_eq!(detail.get("cacheHit"), Some(&Value::Bool(true)));
        assert_eq!(detail.get("cacheEntryCount"), Some(&Value::from(42u64)));
    }
}
