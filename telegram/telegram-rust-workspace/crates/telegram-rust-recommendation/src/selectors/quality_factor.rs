use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;

/// Exponential Moving Average for tracking system metrics.
#[derive(Debug, Clone)]
pub struct ExponentialMovingAverage {
    value: f64,
    alpha: f64,
    initialized: bool,
}

impl ExponentialMovingAverage {
    pub fn new(alpha: f64) -> Self {
        Self {
            value: 0.0,
            alpha,
            initialized: false,
        }
    }

    pub fn update(&mut self, sample: f64) {
        if !self.initialized {
            self.value = sample;
            self.initialized = true;
        } else {
            self.value = self.alpha * sample + (1.0 - self.alpha) * self.value;
        }
    }

    pub fn value(&self) -> f64 {
        self.value
    }
}

/// Configuration for quality factor backpressure.
#[derive(Debug, Clone)]
pub struct QualityFactorConfig {
    /// Base number of candidates to select.
    pub base_k: usize,
    /// Minimum number of candidates (floor under load).
    pub min_k: usize,
    /// CPU usage threshold (0.0-1.0) above which k is reduced.
    pub cpu_threshold: f64,
    /// Memory usage threshold (0.0-1.0) above which k is reduced.
    pub memory_threshold: f64,
    /// Latency threshold in ms above which k is reduced.
    pub latency_threshold_ms: f64,
    /// EMA smoothing factor (0.0-1.0). Higher = more responsive.
    pub ema_alpha: f64,
}

impl Default for QualityFactorConfig {
    fn default() -> Self {
        Self {
            base_k: 50,
            min_k: 10,
            cpu_threshold: 0.8,
            memory_threshold: 0.85,
            latency_threshold_ms: 200.0,
            ema_alpha: 0.3,
        }
    }
}

/// System load tracker that dynamically adjusts candidate selection count.
///
/// Uses exponential moving averages of CPU, memory, and latency to
/// reduce the TopK selection count under high load (backpressure).
pub struct QualityFactor {
    cpu_ema: ExponentialMovingAverage,
    memory_ema: ExponentialMovingAverage,
    latency_ema: ExponentialMovingAverage,
    config: QualityFactorConfig,
    last_adjustment: Arc<Mutex<Instant>>,
}

impl QualityFactor {
    pub fn new(config: QualityFactorConfig) -> Self {
        Self {
            cpu_ema: ExponentialMovingAverage::new(config.ema_alpha),
            memory_ema: ExponentialMovingAverage::new(config.ema_alpha),
            latency_ema: ExponentialMovingAverage::new(config.ema_alpha),
            config,
            last_adjustment: Arc::new(Mutex::new(Instant::now())),
        }
    }

    pub fn with_defaults() -> Self {
        Self::new(QualityFactorConfig::default())
    }

    /// Update system metrics. Call this periodically or on each request.
    pub fn update_metrics(&mut self, cpu: f64, memory: f64, latency_ms: f64) {
        self.cpu_ema.update(cpu);
        self.memory_ema.update(memory);
        self.latency_ema.update(latency_ms);
    }

    /// Compute the effective k value based on current system load.
    ///
    /// Returns `base_k` when system is healthy, reduced k under load.
    pub fn effective_k(&self) -> usize {
        let cpu = self.cpu_ema.value();
        let memory = self.memory_ema.value();
        let latency = self.latency_ema.value();

        let mut load_factor: f64 = 1.0;

        // Reduce k proportionally to how much each metric exceeds its threshold.
        if cpu > self.config.cpu_threshold {
            let overshoot = (cpu - self.config.cpu_threshold) / (1.0 - self.config.cpu_threshold);
            load_factor = load_factor.min(1.0 - overshoot * 0.5);
        }

        if memory > self.config.memory_threshold {
            let overshoot =
                (memory - self.config.memory_threshold) / (1.0 - self.config.memory_threshold);
            load_factor = load_factor.min(1.0 - overshoot * 0.5);
        }

        if latency > self.config.latency_threshold_ms {
            let overshoot =
                (latency - self.config.latency_threshold_ms) / self.config.latency_threshold_ms;
            load_factor = load_factor.min(1.0 - overshoot.min(1.0) * 0.5);
        }

        load_factor = load_factor.max(0.0);

        let k = (self.config.base_k as f64 * load_factor).round() as usize;
        k.max(self.config.min_k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ema_tracks_values() {
        let mut ema = ExponentialMovingAverage::new(0.5);
        ema.update(10.0);
        assert!((ema.value() - 10.0).abs() < 0.001);
        ema.update(20.0);
        assert!((ema.value() - 15.0).abs() < 0.001);
    }

    #[test]
    fn healthy_system_returns_base_k() {
        let mut qf = QualityFactor::with_defaults();
        qf.update_metrics(0.5, 0.5, 100.0);
        assert_eq!(qf.effective_k(), 50);
    }

    #[test]
    fn high_cpu_reduces_k() {
        let mut qf = QualityFactor::with_defaults();
        qf.update_metrics(0.95, 0.5, 100.0);
        let k = qf.effective_k();
        assert!(k < 50);
        assert!(k >= 10);
    }

    #[test]
    fn high_memory_reduces_k() {
        let mut qf = QualityFactor::with_defaults();
        qf.update_metrics(0.5, 0.95, 100.0);
        let k = qf.effective_k();
        assert!(k < 50);
        assert!(k >= 10);
    }

    #[test]
    fn high_latency_reduces_k() {
        let mut qf = QualityFactor::with_defaults();
        qf.update_metrics(0.5, 0.5, 500.0);
        let k = qf.effective_k();
        assert!(k < 50);
        assert!(k >= 10);
    }

    #[test]
    fn k_never_below_minimum() {
        let mut qf = QualityFactor::new(QualityFactorConfig {
            base_k: 50,
            min_k: 10,
            cpu_threshold: 0.1,
            memory_threshold: 0.1,
            latency_threshold_ms: 10.0,
            ema_alpha: 1.0,
        });
        qf.update_metrics(1.0, 1.0, 10000.0);
        assert!(qf.effective_k() >= 10);
    }
}
