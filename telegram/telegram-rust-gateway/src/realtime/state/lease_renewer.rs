use std::time::Duration;

use tokio::time::interval;

use crate::{realtime::socket::contracts::RUST_SOCKET_IO_COMPAT_SOURCE, state::AppState};

/// 计算周期续租间隔（默认 100s TTL 下每 30s 续期一次，兼容更小测试 TTL）
pub fn compute_lease_renewal_interval(lease_ttl_secs: u64) -> Duration {
    let third = (lease_ttl_secs / 3).max(1);
    Duration::from_secs(third.min(30))
}

/// 启动后台活跃 Socket 会话与房间订阅周期续租循环，根除 100s 静默掉线
pub fn spawn_session_lease_renewer(state: AppState) {
    let period = compute_lease_renewal_interval(state.config.realtime_session_lease_ttl_secs);
    tokio::spawn(async move {
        let mut ticker = interval(period);
        // 跳过首次 0ms 立即触发，从第一个完整周期开始续租
        ticker.tick().await;
        loop {
            ticker.tick().await;
            renew_local_active_sessions(&state).await;
        }
    });
}

/// 对当前网关实例持有的所有活跃 Socket 会话执行一次租约与房间 TTL 刷新
pub async fn renew_local_active_sessions(state: &AppState) {
    let active_sessions = {
        let store = state
            .realtime_socket_state
            .lock()
            .expect("rust socket session mutex poisoned");
        store.active_sessions_snapshot()
    };

    for (session_id, user_id, joined_rooms) in active_sessions {
        state
            .session_registry
            .renew_session_lease(
                &session_id,
                user_id.as_deref(),
                &joined_rooms,
                RUST_SOCKET_IO_COMPAT_SOURCE,
            )
            .await;
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::compute_lease_renewal_interval;

    #[test]
    fn renewal_interval_defaults_to_thirty_seconds_for_standard_ttl() {
        assert_eq!(compute_lease_renewal_interval(100), Duration::from_secs(30));
        assert_eq!(compute_lease_renewal_interval(15), Duration::from_secs(5));
        assert_eq!(compute_lease_renewal_interval(2), Duration::from_secs(1));
    }
}
