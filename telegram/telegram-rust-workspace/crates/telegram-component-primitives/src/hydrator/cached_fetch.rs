//! 基于 `TwoPhaseHydrator` 的按候选细粒度缓存抓取器（对标 X `CachedFetch`）。

use std::hash::Hash;

use super::cache_store::CacheStore;
use super::two_phase::TwoPhaseHydrator;

/// 扩展 `TwoPhaseHydrator`：先查询本地/分布式缓存，仅对缓存未命中子集调用远端 `fetch_values`。
#[async_trait::async_trait]
pub trait CachedFetch<Q, C>: TwoPhaseHydrator<Q, C>
where
    Q: Send + Sync + 'static,
    C: Clone + Send + Sync + 'static,
{
    /// 缓存键类型（需可哈希并支持克隆回填）。
    type CacheKey: Eq + Hash + Clone + Send + Sync + 'static;

    /// 单候选对应的轻量缓存值类型（例如 6 级 Semantic ID 或作者元数据）。
    type Value: Clone + Send + Sync + 'static;

    /// 获取底层缓存存储引用。
    fn cache_store(&self) -> &dyn CacheStore<Self::CacheKey, Self::Value>;

    /// 计算单个候选的缓存键。
    fn cache_key(&self, query: &Q, candidate: &C) -> Self::CacheKey;

    /// 若候选上已由召回源或流式索引携带有效值，直接短路缓存查询。
    fn existing_value(&self, _candidate: &C) -> Option<Self::Value> {
        None
    }

    /// 仅针对缓存未命中切片执行批量拉取（返回与 `misses` 等长的 `Option<Value>`）。
    async fn fetch_values(&self, query: &Q, misses: &[&C]) -> Vec<Option<Self::Value>>;

    /// 缓存命中率统计钩子，用于暴露 Moka/Redis 命中指标。
    fn stat_cache(&self, _cache_hits: usize, _cache_misses: usize) {}

    /// 批量执行：候选自带值短路 -> 读 `CacheStore` -> 批量抓取 Miss -> 回填缓存 -> 原位组装返回。
    async fn fetch_cached(
        &self,
        query: &Q,
        candidates: &[C],
    ) -> Result<Vec<Option<Self::Value>>, String> {
        let mut values = Vec::with_capacity(candidates.len());
        let mut miss_indices = Vec::new();
        let mut miss_keys = Vec::new();
        let mut cache_hits = 0usize;

        for (index, candidate) in candidates.iter().enumerate() {
            if let Some(value) = self.existing_value(candidate) {
                values.push(Some(value));
                continue;
            }
            let key = self.cache_key(query, candidate);
            match self.cache_store().get(&key).await {
                Some(value) => {
                    cache_hits += 1;
                    values.push(Some(value));
                }
                None => {
                    miss_indices.push(index);
                    miss_keys.push(key);
                    values.push(None);
                }
            }
        }

        self.stat_cache(cache_hits, miss_indices.len());
        if miss_indices.is_empty() {
            return Ok(values);
        }

        let misses: Vec<&C> = miss_indices.iter().map(|&idx| &candidates[idx]).collect();
        let fetched = self.fetch_values(query, &misses).await;
        if fetched.len() != miss_indices.len() {
            return Err(format!(
                "CachedFetch length_mismatch expected={} got={}",
                miss_indices.len(),
                fetched.len()
            ));
        }

        for ((index, key), value) in miss_indices.into_iter().zip(miss_keys).zip(fetched) {
            if let Some(val) = &value {
                self.cache_store().insert(key, val.clone()).await;
            }
            values[index] = value;
        }

        Ok(values)
    }
}
