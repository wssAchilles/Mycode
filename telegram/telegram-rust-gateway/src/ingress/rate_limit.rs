use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use dashmap::DashMap;

/// 限制内存中最大活跃限流桶数量，防止恶意键轮换导致无界内存增长
const MAX_RATE_LIMIT_BUCKETS: usize = 65_536;

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

    /// 供周期后台任务调用的主动过期清理接口
    pub fn evict_expired(&self) {
        let now = Instant::now();
        self.evict_expired_at(now);
    }

    fn evict_expired_at(&self, now: Instant) {
        self.inner
            .retain(|_, bucket| now.duration_since(bucket.last_seen) <= self.idle_ttl);
        // 若仍在 TTL 内发生异常键暴涨，按较短窗口裁剪以保护网关进程内存边界
        if self.inner.len() >= MAX_RATE_LIMIT_BUCKETS {
            let emergency_ttl = Duration::from_secs(30);
            self.inner
                .retain(|_, bucket| now.duration_since(bucket.last_seen) <= emergency_ttl);
        }
        if self.inner.len() >= MAX_RATE_LIMIT_BUCKETS {
            let target_remove = self.inner.len() / 4;
            let keys_to_remove = self
                .inner
                .iter()
                .take(target_remove.max(1))
                .map(|entry| entry.key().clone())
                .collect::<Vec<_>>();
            for key in keys_to_remove {
                self.inner.remove(&key);
            }
        }
    }

    pub fn check(&self, key: &str) -> RateLimitDecision {
        self.check_with_limits(key, self.capacity, self.refill_per_sec)
    }

    /// 支持按路由类别指定独立容量与恢复速率的令牌桶检查
    pub fn check_with_limits(
        &self,
        key: &str,
        capacity: f64,
        refill_per_sec: f64,
    ) -> RateLimitDecision {
        let now = Instant::now();

        // 每 30 秒或达到容量阈值时触发惰性过期清理
        if self.inner.len() >= MAX_RATE_LIMIT_BUCKETS {
            self.evict_expired_at(now);
        } else if let Ok(mut last) = self.last_cleanup.try_lock()
            && now.duration_since(*last) > Duration::from_secs(30)
        {
            self.evict_expired_at(now);
            *last = now;
        }

        let mut bucket = self
            .inner
            .entry(key.to_string())
            .or_insert_with(|| TokenBucket {
                tokens: capacity,
                last_refill: now,
                last_seen: now,
            });

        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        if elapsed > 0.0 {
            bucket.tokens = (bucket.tokens + elapsed * refill_per_sec).min(capacity);
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
        let retry_after_secs = if refill_per_sec <= 0.0 {
            1
        } else {
            (missing / refill_per_sec).ceil() as u64
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
