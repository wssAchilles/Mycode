//! 水合器原语单元测试（覆盖基础缓存键与 `TwoPhaseHydrator` + `CachedFetch` 链路）。

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde_json::Value;

use super::{
    CacheStore, CachedFetch, MokaCacheStore, TwoPhaseHydrator, cache_stage_detail,
    candidate_hydrator_cache_key, query_hydrator_cache_key, traits::Hydrator,
};

#[derive(Clone, Debug, PartialEq)]
struct DummyCandidate {
    id: String,
    code: Option<i32>,
}

struct DummySidHydrator {
    store: MokaCacheStore<i32>,
    fetch_calls: AtomicUsize,
}

impl DummySidHydrator {
    fn new() -> Self {
        Self {
            store: MokaCacheStore::new(64, Duration::from_secs(60)),
            fetch_calls: AtomicUsize::new(0),
        }
    }
}

#[async_trait::async_trait]
impl TwoPhaseHydrator<(), DummyCandidate> for DummySidHydrator {
    type Fetched = Vec<Option<i32>>;

    fn name(&self) -> &str {
        "DummySidHydrator"
    }

    async fn fetch(
        &self,
        query: &(),
        candidates: &[DummyCandidate],
    ) -> Result<Self::Fetched, String> {
        self.fetch_cached(query, candidates).await
    }

    fn apply(&self, _query: &(), candidates: &mut [DummyCandidate], fetched: Self::Fetched) {
        for (candidate, val) in candidates.iter_mut().zip(fetched) {
            if candidate.code.is_none() {
                candidate.code = val;
            }
        }
    }

    fn merge(&self, candidate: &mut DummyCandidate, hydrated: DummyCandidate) {
        if candidate.code.is_none() {
            candidate.code = hydrated.code;
        }
    }
}

#[async_trait::async_trait]
impl CachedFetch<(), DummyCandidate> for DummySidHydrator {
    type CacheKey = String;
    type Value = i32;

    fn cache_store(&self) -> &dyn CacheStore<Self::CacheKey, Self::Value> {
        &self.store
    }

    fn cache_key(&self, _query: &(), candidate: &DummyCandidate) -> Self::CacheKey {
        candidate.id.clone()
    }

    fn existing_value(&self, candidate: &DummyCandidate) -> Option<Self::Value> {
        candidate.code
    }

    async fn fetch_values(
        &self,
        _query: &(),
        misses: &[&DummyCandidate],
    ) -> Vec<Option<Self::Value>> {
        self.fetch_calls.fetch_add(1, Ordering::SeqCst);
        misses
            .iter()
            .map(|c| Some(c.id.len() as i32 * 10))
            .collect()
    }
}

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

#[test]
fn cached_fetch_two_phase_populates_and_reuses_cache() {
    use std::future::Future;
    use std::pin::pin;
    use std::task::{Context, Poll, Waker};

    fn block_on_ready<F: Future>(fut: F) -> F::Output {
        let mut fut = pin!(fut);
        let waker = Waker::noop();
        let mut cx = Context::from_waker(waker);
        match fut.as_mut().poll(&mut cx) {
            Poll::Ready(out) => out,
            Poll::Pending => panic!("测试用内存水合 Future 不应进入阻塞态"),
        }
    }

    block_on_ready(async {
        let hydrator = DummySidHydrator::new();
        let mut batch = vec![
            DummyCandidate {
                id: "p1".to_string(),
                code: Some(99),
            },
            DummyCandidate {
                id: "p2".to_string(),
                code: None,
            },
        ];

        // 首次两阶段执行仅拉取 p2，p1 通过 existing_value 短路
        let output = hydrator.fetch_output(&(), &batch).await;
        hydrator.apply_output(&(), &mut batch, output);
        assert_eq!(batch[0].code, Some(99));
        assert_eq!(batch[1].code, Some(20));
        assert_eq!(hydrator.fetch_calls.load(Ordering::SeqCst), 1);

        // 第二轮应全部命中缓存或 existing_value，不再触发 fetch_values
        let mut batch2 = vec![DummyCandidate {
            id: "p2".to_string(),
            code: None,
        }];
        let out2 = hydrator.fetch_output(&(), &batch2).await;
        hydrator.apply_output(&(), &mut batch2, out2);
        assert_eq!(batch2[0].code, Some(20));
        assert_eq!(hydrator.fetch_calls.load(Ordering::SeqCst), 1);
    });
}
