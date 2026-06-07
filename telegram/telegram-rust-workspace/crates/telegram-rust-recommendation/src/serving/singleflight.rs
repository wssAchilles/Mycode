use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Result, anyhow};
use tokio::sync::{Mutex, Notify};

use crate::contracts::RecommendationResultPayload;

#[derive(Debug, Clone, Default)]
pub struct CacheSingleflight {
    enabled: bool,
    in_flight: Arc<Mutex<HashMap<String, Arc<FlightState>>>>,
    collapsed_count: Arc<AtomicU64>,
}

#[derive(Debug, Default)]
struct FlightState {
    notify: Notify,
    result: Mutex<Option<FlightResult>>,
}

type FlightResult = std::result::Result<RecommendationResultPayload, String>;

#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSingleflightSnapshot {
    pub enabled: bool,
    pub collapsed_count: u64,
}

impl CacheSingleflight {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            in_flight: Arc::new(Mutex::new(HashMap::new())),
            collapsed_count: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn snapshot(&self) -> CacheSingleflightSnapshot {
        CacheSingleflightSnapshot {
            enabled: self.enabled,
            collapsed_count: self.collapsed_count.load(Ordering::Relaxed),
        }
    }

    pub async fn run<F, Fut>(&self, key: String, fetch: F) -> Result<RecommendationResultPayload>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<RecommendationResultPayload>>,
    {
        if !self.enabled {
            return fetch().await;
        }

        let (flight, owner) = {
            let mut in_flight = self.in_flight.lock().await;
            if let Some(existing) = in_flight.get(&key) {
                self.collapsed_count.fetch_add(1, Ordering::Relaxed);
                (Arc::clone(existing), false)
            } else {
                let flight = Arc::new(FlightState::default());
                in_flight.insert(key.clone(), Arc::clone(&flight));
                (flight, true)
            }
        };

        if !owner {
            return wait_for_result(&flight).await;
        }

        let result = fetch().await;
        {
            let mut slot = flight.result.lock().await;
            *slot = Some(
                result
                    .as_ref()
                    .map(Clone::clone)
                    .map_err(ToString::to_string),
            );
        }
        {
            let mut in_flight = self.in_flight.lock().await;
            in_flight.remove(&key);
        }
        flight.notify.notify_waiters();

        result
    }
}

async fn wait_for_result(flight: &FlightState) -> Result<RecommendationResultPayload> {
    loop {
        if let Some(result) = flight.result.lock().await.clone() {
            return result.map_err(|error| anyhow!(error));
        }
        flight.notify.notified().await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::serving::cache::tests::test_result;

    use super::CacheSingleflight;

    #[tokio::test]
    async fn collapses_concurrent_requests_for_same_key() {
        let singleflight = CacheSingleflight::new(true);
        let calls = Arc::new(AtomicUsize::new(0));

        let left_calls = Arc::clone(&calls);
        let left = singleflight.run("same-key".to_string(), move || async move {
            left_calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            Ok(test_result("stable-a"))
        });

        let right_calls = Arc::clone(&calls);
        let right = singleflight.run("same-key".to_string(), move || async move {
            right_calls.fetch_add(1, Ordering::SeqCst);
            Ok(test_result("stable-b"))
        });

        let (left, right) = tokio::join!(left, right);
        assert_eq!(left.expect("left result").stable_order_key, "stable-a");
        assert_eq!(right.expect("right result").stable_order_key, "stable-a");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(singleflight.snapshot().collapsed_count, 1);
    }
}
