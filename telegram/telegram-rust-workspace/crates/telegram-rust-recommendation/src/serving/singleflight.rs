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
    cancelled: std::sync::atomic::AtomicBool,
}

struct FlightCleanupGuard {
    key: Option<String>,
    in_flight: Arc<Mutex<HashMap<String, Arc<FlightState>>>>,
    flight: Arc<FlightState>,
}

impl FlightCleanupGuard {
    fn new(
        key: String,
        in_flight: Arc<Mutex<HashMap<String, Arc<FlightState>>>>,
        flight: Arc<FlightState>,
    ) -> Self {
        Self {
            key: Some(key),
            in_flight,
            flight,
        }
    }

    fn complete(&mut self) {
        self.key = None;
    }
}

impl Drop for FlightCleanupGuard {
    fn drop(&mut self) {
        let Some(key) = self.key.take() else {
            return;
        };

        self.flight
            .cancelled
            .store(true, std::sync::atomic::Ordering::Release);
        self.flight.notify.notify_waiters();

        let in_flight = Arc::clone(&self.in_flight);
        let flight = Arc::clone(&self.flight);
        tokio::spawn(async move {
            publish_flight_result(
                &in_flight,
                &key,
                &flight,
                Err("singleflight owner cancelled".to_string()),
            )
            .await;
        });
    }
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
                if existing
                    .cancelled
                    .load(std::sync::atomic::Ordering::Acquire)
                {
                    let flight = Arc::new(FlightState::default());
                    in_flight.insert(key.clone(), Arc::clone(&flight));
                    (flight, true)
                } else {
                    self.collapsed_count.fetch_add(1, Ordering::Relaxed);
                    (Arc::clone(existing), false)
                }
            } else {
                let flight = Arc::new(FlightState::default());
                in_flight.insert(key.clone(), Arc::clone(&flight));
                (flight, true)
            }
        };

        if !owner {
            return wait_for_result(&flight).await;
        }

        let mut cleanup = FlightCleanupGuard::new(
            key.clone(),
            Arc::clone(&self.in_flight),
            Arc::clone(&flight),
        );
        let result = fetch().await;
        publish_flight_result(
            &self.in_flight,
            &key,
            &flight,
            result
                .as_ref()
                .map(Clone::clone)
                .map_err(ToString::to_string),
        )
        .await;
        cleanup.complete();

        result
    }
}

async fn publish_flight_result(
    in_flight: &Mutex<HashMap<String, Arc<FlightState>>>,
    key: &str,
    flight: &FlightState,
    result: FlightResult,
) {
    {
        let mut slot = flight.result.lock().await;
        if slot.is_none() {
            *slot = Some(result);
        }
    }
    {
        let mut in_flight = in_flight.lock().await;
        if in_flight
            .get(key)
            .is_some_and(|current| std::ptr::eq(Arc::as_ptr(current), flight))
        {
            in_flight.remove(key);
        }
    }
    flight.notify.notify_waiters();
}

async fn wait_for_result(flight: &FlightState) -> Result<RecommendationResultPayload> {
    loop {
        let notified = flight.notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if let Some(result) = flight.result.lock().await.clone() {
            return result.map_err(|error| anyhow!(error));
        }
        if flight.cancelled.load(std::sync::atomic::Ordering::Acquire) {
            return Err(anyhow!("singleflight owner cancelled"));
        }
        notified.await;
    }
}

#[cfg(test)]
mod tests {
    use std::future::pending;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::contracts::RecommendationResultPayload;
    use crate::serving::cache::tests::test_result;
    use anyhow::Result;
    use tokio::sync::Notify;
    use tokio::time::{Duration, timeout};

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

    #[tokio::test]
    async fn cancelled_owner_releases_waiters_for_same_key() {
        let singleflight = CacheSingleflight::new(true);
        let started = Arc::new(Notify::new());
        let owner_singleflight = singleflight.clone();
        let owner_started = Arc::clone(&started);
        let owner = tokio::spawn(async move {
            owner_singleflight
                .run("same-key".to_string(), move || {
                    owner_started.notify_one();
                    async { pending::<Result<RecommendationResultPayload>>().await }
                })
                .await
        });

        started.notified().await;
        owner.abort();
        assert!(
            owner
                .await
                .expect_err("owner should be cancelled")
                .is_cancelled()
        );

        let retry = timeout(
            Duration::from_secs(1),
            singleflight.run("same-key".to_string(), || async {
                Ok(test_result("retry"))
            }),
        )
        .await
        .expect("retry should not wait on cancelled owner")
        .expect("retry should succeed");

        assert_eq!(retry.stable_order_key, "retry");
    }
}
