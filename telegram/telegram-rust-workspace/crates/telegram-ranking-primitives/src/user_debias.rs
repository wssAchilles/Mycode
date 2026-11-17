//! 轻量级 Point-In-Time (PIT) 用户消偏存储与 Logit 空间重中心化模块。
//!
//! 对标 `x-algorithm/vm-ranker/{user_debias_store.rs, scoring/debias.rs}`，
//! 提供：
//! 1. 按请求时间戳 `retain_until(req_ms)` 严守 PIT 因果截断，杜绝时间穿越泄漏；
//! 2. 按产物过期阈值 `max_artifact_age_secs` 自动跳过回退（Fail-Open）；
//! 3. Logit 空间重中心化 `apply_logit_debias(prob, bias, clip)` 消除用户基线打分偏好漂移。

pub mod logit;
pub mod store;

#[cfg(test)]
mod tests;

pub use logit::*;
pub use store::*;
