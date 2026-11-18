//! 端到端请求级 Deadline 预算传播与单阶段回调超时上限计算模块。
//!
//! 消除“内层多阶段串并联回调静态 9000ms 超时 > 外层整管线 9000ms 总预算”的倒挂，
//! 并在剩余预算低于安全下限（`< 150ms`）时快速短路放弃后续低优/拆单回调，保护上游 Node 与 PG 连接池。

use std::future::Future;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::http::HeaderMap;

/// 推荐引擎端到端截止时间传递请求头（Unix epoch 毫秒）。
pub const RECOMMENDATION_DEADLINE_HEADER: &str = "x-recommendation-deadline-ms";

/// 单阶段内层回调超时默认硬上限（毫秒），禁止单次内层请求等满外层全额预算。
pub const DEFAULT_SINGLE_STAGE_CAP_MS: u64 = 2_500;

/// 每次子调用预留给网络收包与上游收尾序列化的安全余量（毫秒）。
pub const DEADLINE_SAFETY_RESERVE_MS: u64 = 200;

/// 触发快速短路拒绝后续回调的最低剩余预算阈值（毫秒）。
pub const MIN_REMAINING_BUDGET_MS: u64 = 150;

/// 请求级截止预算上下文。
#[derive(Debug, Clone, Copy)]
pub struct RequestDeadline {
    deadline_instant: Instant,
    deadline_epoch_ms: u64,
    single_stage_cap_ms: u64,
}

tokio::task_local! {
    static CURRENT_REQUEST_DEADLINE: RequestDeadline;
}

impl RequestDeadline {
    /// 从入站请求头 `x-recommendation-deadline-ms` 解析截止时间；若未携带或格式无效则按 `now + outer_timeout_ms` 计算。
    pub fn from_headers_or_timeout(headers: &HeaderMap, outer_timeout_ms: u64) -> Self {
        let now_epoch_ms = current_epoch_ms();
        let parsed_epoch_ms = headers
            .get(RECOMMENDATION_DEADLINE_HEADER)
            .or_else(|| headers.get("x-deadline-epoch-ms"))
            .and_then(|val| val.to_str().ok())
            .map(str::trim)
            .filter(|val| !val.is_empty())
            .and_then(|val| val.parse::<u64>().ok());

        match parsed_epoch_ms {
            Some(epoch_ms) => {
                let remaining_ms = epoch_ms.saturating_sub(now_epoch_ms);
                Self::from_remaining_with_epoch(remaining_ms, epoch_ms, outer_timeout_ms)
            }
            None => Self::from_remaining_ms(outer_timeout_ms, outer_timeout_ms),
        }
    }

    /// 基于指定剩余毫秒数与外层超时上限构造截止上下文。
    pub fn from_remaining_ms(remaining_ms: u64, outer_timeout_ms: u64) -> Self {
        let now_epoch_ms = current_epoch_ms();
        let deadline_epoch_ms = now_epoch_ms.saturating_add(remaining_ms);
        Self::from_remaining_with_epoch(remaining_ms, deadline_epoch_ms, outer_timeout_ms)
    }

    fn from_remaining_with_epoch(
        remaining_ms: u64,
        deadline_epoch_ms: u64,
        outer_timeout_ms: u64,
    ) -> Self {
        let cap_ms = resolve_single_stage_cap_ms(outer_timeout_ms);
        Self {
            deadline_instant: Instant::now() + Duration::from_millis(remaining_ms),
            deadline_epoch_ms,
            single_stage_cap_ms: cap_ms,
        }
    }

    /// 获取距离截止时刻的剩余毫秒数。
    pub fn remaining_ms(&self) -> u64 {
        self.deadline_instant
            .saturating_duration_since(Instant::now())
            .as_millis() as u64
    }

    /// 获取向下游透传的 Unix epoch 毫秒截止时间戳。
    pub fn deadline_epoch_ms(&self) -> u64 {
        self.deadline_epoch_ms
    }

    /// 判断剩余预算是否已低于快速短路下限（`< 150ms`）。
    pub fn is_exhausted(&self) -> bool {
        self.remaining_ms() < MIN_REMAINING_BUDGET_MS
    }

    /// 动态计算本次回调超时毫秒数：`min(remaining_ms.saturating_sub(200), single_stage_cap_ms)`；
    /// 若剩余预算 `< 150ms` 则返回 `None` 触发快速短路。
    pub fn per_call_timeout_ms(&self) -> Option<u64> {
        let remaining = self.remaining_ms();
        if remaining < MIN_REMAINING_BUDGET_MS {
            return None;
        }
        let deducted = remaining.saturating_sub(DEADLINE_SAFETY_RESERVE_MS).max(1);
        Some(deducted.min(self.single_stage_cap_ms))
    }
}

/// 解析单阶段回调超时上限（允许环境变量 `RUST_RECOMMENDATION_STAGE_TIMEOUT_MS` 覆盖，且不超过外层 `outer_timeout_ms`）。
pub fn resolve_single_stage_cap_ms(outer_timeout_ms: u64) -> u64 {
    let configured_cap = std::env::var("RUST_RECOMMENDATION_STAGE_TIMEOUT_MS")
        .ok()
        .map(|val| val.trim().to_string())
        .filter(|val| !val.is_empty())
        .and_then(|val| val.parse::<u64>().ok())
        .unwrap_or(DEFAULT_SINGLE_STAGE_CAP_MS);
    configured_cap.min(outer_timeout_ms).max(1)
}

/// 在当前异步任务作用域内绑定请求级 `RequestDeadline`。
pub async fn with_request_deadline<F>(deadline: RequestDeadline, future: F) -> F::Output
where
    F: Future,
{
    CURRENT_REQUEST_DEADLINE.scope(deadline, future).await
}

/// 读取当前异步任务绑定的 `RequestDeadline`（若存在）。
pub fn current_request_deadline() -> Option<RequestDeadline> {
    CURRENT_REQUEST_DEADLINE.try_with(|deadline| *deadline).ok()
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue};

    use super::{
        DEFAULT_SINGLE_STAGE_CAP_MS, RECOMMENDATION_DEADLINE_HEADER, RequestDeadline,
        current_epoch_ms,
    };

    #[test]
    fn deadline_caps_single_stage_timeout_below_outer_budget() {
        let deadline = RequestDeadline::from_remaining_ms(9_000, 9_000);
        let timeout = deadline.per_call_timeout_ms().expect("budget available");
        assert_eq!(timeout, DEFAULT_SINGLE_STAGE_CAP_MS);
    }

    #[test]
    fn deadline_deducts_safety_reserve_when_budget_is_tight() {
        let deadline = RequestDeadline::from_remaining_ms(1_200, 9_000);
        let timeout = deadline.per_call_timeout_ms().expect("budget available");
        assert!((950..=1_000).contains(&timeout));
    }

    #[test]
    fn deadline_short_circuits_when_remaining_below_threshold() {
        let deadline = RequestDeadline::from_remaining_ms(120, 9_000);
        assert!(deadline.is_exhausted());
        assert!(deadline.per_call_timeout_ms().is_none());
    }

    #[test]
    fn deadline_parses_epoch_ms_header_and_falls_back_cleanly() {
        let mut headers = HeaderMap::new();
        let target_epoch = current_epoch_ms() + 1_500;
        headers.insert(
            RECOMMENDATION_DEADLINE_HEADER,
            HeaderValue::from_str(&target_epoch.to_string()).unwrap(),
        );
        let parsed = RequestDeadline::from_headers_or_timeout(&headers, 9_000);
        assert_eq!(parsed.deadline_epoch_ms(), target_epoch);
        assert!(parsed.per_call_timeout_ms().unwrap() <= 1_300);
    }
}
