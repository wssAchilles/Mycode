use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use dashmap::DashMap;

#[derive(Debug, Clone)]
pub struct RateLimiter {
    inner: Arc<DashMap<String, TokenBucket>>,
    capacity: f64,
    refill_per_sec: f64,
    idle_ttl: Duration,
    last_cleanup: Arc<Mutex<Instant>>,
}

#[derive(Debug, Clone)]
struct TokenBucket {
    tokens: f64,
    last_refill: Instant,
    last_seen: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RateLimitDecision {
    pub allowed: bool,
    pub remaining: u64,
    pub retry_after_secs: u64,
}

impl RateLimiter {
    pub fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self {
            inner: Arc::new(DashMap::new()),
            capacity,
            refill_per_sec,
            idle_ttl: Duration::from_secs(600),
            last_cleanup: Arc::new(Mutex::new(Instant::now())),
        }
    }

    pub fn check(&self, key: &str) -> RateLimitDecision {
        let now = Instant::now();

        // Throttle cleanup to once per 30 seconds
        if let Ok(mut last) = self.last_cleanup.try_lock() {
            if now.duration_since(*last) > Duration::from_secs(30) {
                self.inner.retain(|_, bucket| now.duration_since(bucket.last_seen) <= self.idle_ttl);
                *last = now;
            }
        }

        let mut bucket = self.inner.entry(key.to_string()).or_insert_with(|| TokenBucket {
            tokens: self.capacity,
            last_refill: now,
            last_seen: now,
        });

        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        if elapsed > 0.0 {
            bucket.tokens = (bucket.tokens + elapsed * self.refill_per_sec).min(self.capacity);
            bucket.last_refill = now;
        }
        bucket.last_seen = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            return RateLimitDecision {
                allowed: true,
                remaining: bucket.tokens.floor() as u64,
                retry_after_secs: 0,
            };
        }

        let missing = (1.0 - bucket.tokens).max(0.0);
        let retry_after_secs = if self.refill_per_sec <= 0.0 {
            1
        } else {
            (missing / self.refill_per_sec).ceil() as u64
        };
        RateLimitDecision {
            allowed: false,
            remaining: 0,
            retry_after_secs: retry_after_secs.max(1),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{thread::sleep, time::Duration};

    use super::*;

    #[test]
    fn rate_limiter_blocks_and_recovers_after_refill() {
        let limiter = RateLimiter::new(2.0, 2.0);

        assert!(limiter.check("ip").allowed);
        assert!(limiter.check("ip").allowed);
        let blocked = limiter.check("ip");
        assert!(!blocked.allowed);
        assert!(blocked.retry_after_secs >= 1);

        sleep(Duration::from_millis(1100));
        assert!(limiter.check("ip").allowed);
    }
}
