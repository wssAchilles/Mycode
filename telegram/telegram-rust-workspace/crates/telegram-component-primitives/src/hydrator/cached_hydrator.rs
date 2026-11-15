//! 传统单候选缓存水合器与兼容执行器（保留并自动桥接 `TwoPhaseHydrator`）。

use std::hash::Hash;

use super::cache_store::CacheStore;
use super::traits::Hydrator;
use super::two_phase::TwoPhaseHydrator;

/// 带缓存的 Hydrator trait — per-candidate 缓存设计。
#[async_trait::async_trait]
pub trait CachedHydrator<Q, C>: Send + Sync
where
    Q: Send + Sync + 'static,
    C: Clone + Send + Sync + 'static,
{
    /// 缓存键类型（如 `author_id` 或 `post_id`）。
    type CacheKey: Eq + Hash + Clone + Send + Sync + 'static;

    /// 缓存值类型（如作者信息或视频元数据）。
    type CacheValue: Clone + Send + Sync + 'static;

    /// Hydrator 名称。
    fn name(&self) -> &str;

    /// 是否启用。
    fn enable(&self, _query: &Q) -> bool {
        true
    }

    /// 获取缓存后端引用。
    fn cache_store(&self) -> &dyn CacheStore<Self::CacheKey, Self::CacheValue>;

    /// 从候选生成缓存键。
    fn cache_key(&self, candidate: &C) -> Self::CacheKey;

    /// 从已水合候选提取可缓存值。
    fn cache_value(&self, hydrated: &C) -> Self::CacheValue;

    /// 从缓存值重建已水合候选。
    fn hydrate_from_cache(&self, value: Self::CacheValue) -> C;

    /// 仅对缓存未命中批次发起实际远端调用。
    async fn hydrate_from_client(&self, query: &Q, candidates: &[C]) -> Vec<Result<C, String>>;

    /// 将已水合字段合并回原始候选（默认整体替换）。
    fn update(&self, candidate: &mut C, hydrated: C) {
        *candidate = hydrated;
    }

    /// 缓存命中与未命中统计钩子。
    fn stat_cache(&self, _cache_hits: usize, _cache_misses: usize) {}

    /// 执行缓存检索、Miss 拉取与异步回填。
    async fn hydrate_cached(&self, query: &Q, candidates: &[C]) -> Vec<Result<C, String>> {
        let store = self.cache_store();
        let mut cache_keys = Vec::with_capacity(candidates.len());
        let mut cache_hits: Vec<Option<Self::CacheValue>> = Vec::with_capacity(candidates.len());

        for candidate in candidates {
            let key = self.cache_key(candidate);
            let cached = store.get(&key).await;
            cache_hits.push(cached);
            cache_keys.push(key);
        }

        let miss_indices: Vec<usize> = cache_hits
            .iter()
            .enumerate()
            .filter(|(_, cached)| cached.is_none())
            .map(|(i, _)| i)
            .collect();

        let miss_candidates: Vec<C> = miss_indices
            .iter()
            .map(|&i| candidates[i].clone())
            .collect();
        let hydrated_results = if miss_candidates.is_empty() {
            Vec::new()
        } else {
            self.hydrate_from_client(query, &miss_candidates).await
        };

        for (idx, result) in miss_indices.iter().zip(hydrated_results.iter()) {
            if let Ok(hydrated) = result {
                let value = self.cache_value(hydrated);
                store.insert(cache_keys[*idx].clone(), value).await;
            }
        }

        let mut results = Vec::with_capacity(candidates.len());
        let mut miss_iter = hydrated_results.into_iter();
        for cached in cache_hits.into_iter() {
            if let Some(value) = cached {
                results.push(Ok(self.hydrate_from_cache(value)));
            } else {
                let result = miss_iter.next().unwrap_or_else(|| {
                    Err("hydrate_from_client returned fewer results than misses".to_string())
                });
                results.push(result);
            }
        }

        let hit_count = results.iter().filter(|r| r.is_ok()).count() - miss_indices.len();
        self.stat_cache(hit_count, miss_indices.len());
        results
    }
}

/// 任何 `CachedHydrator` 通过 `TwoPhaseHydrator` 自动获得兼容能力（对标 X 的继承链）。
#[async_trait::async_trait]
impl<Q, C, H> TwoPhaseHydrator<Q, C> for H
where
    Q: Send + Sync + 'static,
    C: Clone + Send + Sync + 'static,
    H: CachedHydrator<Q, C> + 'static,
{
    type Fetched = Vec<Result<C, String>>;

    fn name(&self) -> &str {
        CachedHydrator::name(self)
    }

    fn enable(&self, query: &Q) -> bool {
        CachedHydrator::enable(self, query)
    }

    async fn fetch(&self, query: &Q, candidates: &[C]) -> Result<Self::Fetched, String> {
        Ok(self.hydrate_cached(query, candidates).await)
    }

    fn apply(&self, _query: &Q, candidates: &mut [C], fetched: Self::Fetched) {
        for (candidate, hydrated) in candidates.iter_mut().zip(fetched) {
            if let Ok(hydrated) = hydrated {
                CachedHydrator::update(self, candidate, hydrated);
            }
        }
    }

    fn merge(&self, candidate: &mut C, hydrated: C) {
        CachedHydrator::update(self, candidate, hydrated);
    }

    async fn legacy_hydrate(&self, query: &Q, candidates: &[C]) -> Vec<Result<C, String>> {
        self.hydrate_cached(query, candidates).await
    }
}

/// 便捷执行器，包装 `Hydrator` trait 调用（自动处理 enable 与 update_all）。
pub struct CachedHydratorExecutor;

impl CachedHydratorExecutor {
    /// 执行单个水合器并原位更新候选。
    pub async fn execute<Q, C, H>(hydrator: &H, query: &Q, candidates: &mut [C])
    where
        Q: Send + Sync + 'static,
        C: Clone + Send + Sync + 'static,
        H: Hydrator<Q, C>,
    {
        if !hydrator.enable(query) {
            return;
        }
        let results = hydrator.hydrate(query, candidates).await;
        hydrator.update_all(candidates, results);
    }
}
